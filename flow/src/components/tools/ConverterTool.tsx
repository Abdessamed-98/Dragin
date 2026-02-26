
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowRight, Upload, Loader2, Download, Trash2, AlertCircle,
    X, Check, Image as ImageIcon, Film, Music, ClipboardPaste, ArrowRightLeft, Copy, Ban
} from 'lucide-react';
import {
    getConvertStatus, convertImage, startVideoConversion, getVideoProgress, getFileThumbnail
} from '../../services/api';
import type { ConvertFormat, ImageFormat } from '../../services/api';
import JSZip from 'jszip';

interface ConverterToolProps {
    onClose: () => void;
    droppedFiles: File[];
    dropGeneration: number;
    onItemCountChange?: (count: number) => void;
    clearGen?: number;
}

type FileType = 'image' | 'video' | 'gif' | 'audio';
type GroupId = 'image' | 'video' | 'audio';

interface ConvertFileItem {
    id: string;
    file: File;
    name: string;
    sizeBytes: number;
    type: FileType;
    status: 'idle' | 'converting' | 'done' | 'error';
    targetFormat: ConvertFormat;
    previewUrl?: string;
    previewNeedsRevoke?: boolean;
    jobId?: string;
    progress?: number;
    resultDataUrl?: string;
    resultSize?: number;
    error?: string;
}

const IMAGE_FORMATS: ConvertFormat[] = ['jpg', 'png', 'webp', 'bmp', 'tiff'];
const VIDEO_FORMATS: ConvertFormat[] = ['mp4', 'webm', 'mov', 'avi', 'mkv', 'gif'];
const AUDIO_FORMATS: ConvertFormat[] = ['mp3', 'wav', 'ogg'];
const GIF_OUTPUT_FORMATS: ConvertFormat[] = ['mp4', 'webm'];

const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
};

const genId = () => Math.random().toString(36).substring(2, 11);

const detectFileType = (file: File): FileType | null => {
    if (file.type === 'image/gif') return 'gif';
    if (file.type.startsWith('image/')) return 'image';
    if (file.type.startsWith('video/')) return 'video';
    if (file.type.startsWith('audio/')) return 'audio';
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (['gif'].includes(ext)) return 'gif';
    if (['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'psd', 'ai'].includes(ext)) return 'image';
    if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'wmv'].includes(ext)) return 'video';
    if (['mp3', 'wav', 'ogg', 'flac', 'aac', 'wma', 'm4a'].includes(ext)) return 'audio';
    return null;
};

const getGroupForType = (type: FileType): GroupId => {
    if (type === 'image') return 'image';
    if (type === 'video' || type === 'gif') return 'video';
    return 'audio';
};

const getCurrentFormat = (name: string): string => {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    if (ext === 'jpeg') return 'jpg';
    if (ext === 'tif') return 'tiff';
    return ext;
};

const getAvailableFormats = (type: FileType, currentFormat: string, ffmpegAvailable: boolean): ConvertFormat[] => {
    if (type === 'image') return IMAGE_FORMATS.filter(f => f !== currentFormat);
    if (type === 'gif') return ffmpegAvailable ? GIF_OUTPUT_FORMATS : [];
    if (type === 'audio') return ffmpegAvailable ? AUDIO_FORMATS.filter(f => f !== currentFormat) : [];
    // video
    const formats = [...VIDEO_FORMATS, ...AUDIO_FORMATS].filter(f => f !== currentFormat);
    return ffmpegAvailable ? formats : [];
};

const FORMAT_LABELS: Record<string, string> = {
    jpg: 'JPG', png: 'PNG', webp: 'WebP', bmp: 'BMP', tiff: 'TIFF',
    mp4: 'MP4', webm: 'WebM', mov: 'MOV', avi: 'AVI', mkv: 'MKV',
    mp3: 'MP3', wav: 'WAV', ogg: 'OGG', gif: 'GIF',
};

const GROUP_FORMATS: Record<GroupId, ConvertFormat[]> = {
    image: IMAGE_FORMATS,
    video: VIDEO_FORMATS,
    audio: AUDIO_FORMATS,
};

const GROUP_ICON: Record<GroupId, React.ReactNode> = {
    image: <ImageIcon className="w-3.5 h-3.5 text-blue-400" />,
    video: <Film className="w-3.5 h-3.5 text-purple-400" />,
    audio: <Music className="w-3.5 h-3.5 text-emerald-400" />,
};

const FILE_ACCEPT = 'image/*,video/*,audio/*,.gif,.mp4,.webm,.mov,.avi,.mkv,.psd,.ai,.tiff,.tif,.mp3,.wav,.ogg,.flac,.aac,.wma,.m4a';

export const ConverterTool: React.FC<ConverterToolProps> = ({ onClose, droppedFiles, dropGeneration, onItemCountChange, clearGen = 0 }) => {
    const [files, setFiles] = useState<ConvertFileItem[]>([]);
    const [ffmpegAvailable, setFfmpegAvailable] = useState<boolean | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [cancelHover, setCancelHover] = useState(false);
    const [isCopying, setIsCopying] = useState(false);
    const [showCopySuccess, setShowCopySuccess] = useState(false);
    const pollTimers = useRef<Record<string, NodeJS.Timeout>>({});

    // Per-group selected target format
    const [groupTarget, setGroupTarget] = useState<Record<GroupId, ConvertFormat>>({
        image: 'jpg',
        video: 'mp4',
        audio: 'mp3',
    });
    const groupTargetRef = useRef(groupTarget);
    groupTargetRef.current = groupTarget;

    useEffect(() => { onItemCountChange?.(files.length); }, [files.length, onItemCountChange]);

    useEffect(() => {
        getConvertStatus()
            .then(r => setFfmpegAvailable(r.ffmpeg))
            .catch(() => setFfmpegAvailable(false));
    }, []);

    const lastDropGen = useRef(dropGeneration);
    useEffect(() => {
        if (dropGeneration === 0) return;
        if (dropGeneration === lastDropGen.current) return;
        lastDropGen.current = dropGeneration;
        if (droppedFiles.length === 0) return;
        addFiles(droppedFiles);
    }, [dropGeneration]); // eslint-disable-line react-hooks/exhaustive-deps

    const lastClearGen = useRef(clearGen);
    useEffect(() => {
        if (clearGen === 0 || clearGen === lastClearGen.current) return;
        lastClearGen.current = clearGen;
        Object.values(pollTimers.current).forEach(clearInterval);
        pollTimers.current = {};
        setFiles([]);
    }, [clearGen]);

    const filesRef = useRef<ConvertFileItem[]>([]);
    useEffect(() => { filesRef.current = files; }, [files]);
    useEffect(() => {
        return () => {
            Object.values(pollTimers.current).forEach(clearInterval);
            filesRef.current.forEach(f => {
                if (f.previewUrl && f.previewNeedsRevoke) URL.revokeObjectURL(f.previewUrl);
            });
        };
    }, []);

    const addFiles = useCallback(async (newFiles: File[]) => {
        const items: ConvertFileItem[] = [];
        for (const file of newFiles) {
            const type = detectFileType(file);
            if (!type) continue;
            const currentFormat = getCurrentFormat(file.name);
            const group = getGroupForType(type);
            // Use current group toggle as default target; fall back if same as source
            const preferred = groupTargetRef.current[group];
            const available = getAvailableFormats(type, currentFormat, true);
            const targetFormat = available.includes(preferred) ? preferred : (available[0] || preferred);

            let previewUrl: string | undefined;
            let previewNeedsRevoke = false;
            if (type === 'image' || type === 'gif') {
                try {
                    const result = await getFileThumbnail(file, 80);
                    if (result) { previewUrl = result.url; previewNeedsRevoke = result.needsRevoke; }
                } catch { /* no preview */ }
            } else if (type === 'video') {
                previewUrl = URL.createObjectURL(file);
                previewNeedsRevoke = true;
            }
            items.push({
                id: genId(), file, name: file.name, sizeBytes: file.size, type,
                status: 'idle', targetFormat, previewUrl, previewNeedsRevoke,
            });
        }
        if (items.length > 0) setFiles(prev => [...prev, ...items]);
    }, []);

    const removeFile = (fileId: string) => {
        if (pollTimers.current[fileId]) {
            clearInterval(pollTimers.current[fileId]);
            delete pollTimers.current[fileId];
        }
        setFiles(prev => {
            const removed = prev.find(f => f.id === fileId);
            if (removed?.previewUrl && removed.previewNeedsRevoke) URL.revokeObjectURL(removed.previewUrl);
            return prev.filter(f => f.id !== fileId);
        });
    };

    const updateFile = (fileId: string, updates: Partial<ConvertFileItem>) => {
        setFiles(prev => prev.map(f => f.id === fileId ? { ...f, ...updates } : f));
    };

    // Change group toggle → update all files in that group
    const handleGroupChange = (group: GroupId, format: ConvertFormat) => {
        setGroupTarget(prev => ({ ...prev, [group]: format }));
        setFiles(prev => prev.map(f => {
            if (getGroupForType(f.type) !== group || f.status === 'converting') return f;
            const available = getAvailableFormats(f.type, getCurrentFormat(f.name), ffmpegAvailable ?? false);
            if (available.includes(format)) {
                return { ...f, targetFormat: format, status: 'idle', resultDataUrl: undefined, resultSize: undefined, error: undefined };
            }
            return f;
        }));
    };

    const convertSingleFile = useCallback(async (item: ConvertFileItem) => {
        updateFile(item.id, { status: 'converting', progress: 0, error: undefined });
        try {
            if (item.type === 'image') {
                const result = await convertImage(item.file, item.targetFormat as ImageFormat);
                updateFile(item.id, { status: 'done', resultDataUrl: result.dataUrl, resultSize: result.size });
            } else {
                const { jobId } = await startVideoConversion(item.file, item.targetFormat);
                updateFile(item.id, { jobId });
                const timer = setInterval(async () => {
                    try {
                        const prog = await getVideoProgress(jobId);
                        if (prog.status === 'done') {
                            clearInterval(timer);
                            delete pollTimers.current[item.id];
                            updateFile(item.id, { status: 'done', progress: 100, resultDataUrl: prog.dataUrl, resultSize: prog.size });
                        } else if (prog.status === 'error') {
                            clearInterval(timer);
                            delete pollTimers.current[item.id];
                            updateFile(item.id, { status: 'error', error: prog.error || 'Conversion failed' });
                        } else {
                            updateFile(item.id, { progress: prog.progress });
                        }
                    } catch {
                        clearInterval(timer);
                        delete pollTimers.current[item.id];
                        updateFile(item.id, { status: 'error', error: 'Lost connection to server' });
                    }
                }, 1000);
                pollTimers.current[item.id] = timer;
            }
        } catch (err: any) {
            updateFile(item.id, { status: 'error', error: err?.message || 'Conversion failed' });
        }
    }, []);

    const convertAll = () => {
        for (const item of files.filter(f => f.status === 'idle')) convertSingleFile(item);
    };

    const handleDownload = async () => {
        const completed = files.filter(f => f.status === 'done' && f.resultDataUrl);
        if (completed.length === 0) return;
        if (completed.length === 1) {
            const item = completed[0];
            const link = document.createElement('a');
            link.href = item.resultDataUrl!;
            link.download = `${item.name.replace(/\.[^.]+$/, '')}.${item.targetFormat}`;
            link.click();
            return;
        }
        setIsDownloading(true);
        try {
            const zip = new JSZip();
            await Promise.all(completed.map(async (item) => {
                const res = await fetch(item.resultDataUrl!);
                const blob = await res.blob();
                zip.file(`${item.name.replace(/\.[^.]+$/, '')}.${item.targetFormat}`, blob);
            }));
            const content = await zip.generateAsync({ type: 'blob' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = `converted-${Date.now()}.zip`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        } catch (err) {
            console.error('Failed to zip converted files', err);
        } finally {
            setIsDownloading(false);
        }
    };

    const handleClear = () => {
        Object.values(pollTimers.current).forEach(clearInterval);
        pollTimers.current = {};
        files.forEach(f => { if (f.previewUrl && f.previewNeedsRevoke) URL.revokeObjectURL(f.previewUrl); });
        setFiles([]);
        onClose();
    };

    const cancelAll = () => {
        Object.values(pollTimers.current).forEach(clearInterval);
        pollTimers.current = {};
        setFiles(prev => prev.map(f =>
            f.status === 'converting' ? { ...f, status: 'idle', progress: undefined, jobId: undefined } : f
        ));
        setCancelHover(false);
    };

    const handleCopy = async () => {
        const completed = files.filter(f => f.status === 'done' && f.resultDataUrl);
        if (completed.length === 0 || isCopying) return;
        setIsCopying(true);
        try {
            const clipItems = await Promise.all(completed.map(async (item) => {
                const res = await fetch(item.resultDataUrl!);
                const blob = await res.blob();
                const dataUrl = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
                const base = item.name.replace(/\.[^.]+$/, '');
                return { dataUrl, name: `${base}.${item.targetFormat}` };
            }));
            if ((window as any).electron?.clipboardWrite) {
                await (window as any).electron.clipboardWrite(clipItems);
            } else {
                const first = clipItems[0];
                const res = await fetch(first.dataUrl);
                const blob = await res.blob();
                if (blob.type.startsWith('image/')) {
                    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
                }
            }
            setShowCopySuccess(true);
            setTimeout(() => setShowCopySuccess(false), 1500);
        } catch (err) {
            console.error('Copy failed:', err);
        } finally {
            setIsCopying(false);
        }
    };

    const handlePaste = async () => {
        try {
            if ((window as any).electron?.clipboardRead) {
                const clipItems = await (window as any).electron.clipboardRead();
                if (clipItems.length > 0) {
                    const files = await Promise.all(clipItems.map(async ({ dataUrl, name }: { dataUrl: string; name: string }) => {
                        const res = await fetch(dataUrl);
                        const blob = await res.blob();
                        return new File([blob], name, { type: blob.type || 'application/octet-stream' });
                    }));
                    addFiles(files);
                    return;
                }
            } else {
                const clipItems = await navigator.clipboard.read();
                for (const clipItem of clipItems) {
                    const imageType = clipItem.types.find((t: string) => t.startsWith('image/'));
                    if (imageType) {
                        const blob = await clipItem.getType(imageType);
                        const ext = imageType.split('/')[1] || 'png';
                        addFiles([new File([blob], `pasted.${ext}`, { type: imageType })]);
                        return;
                    }
                }
            }
        } catch (err) {
            console.warn('Clipboard read failed:', err);
        }
    };

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        const dropped = Array.from(e.dataTransfer.files);
        if (dropped.length > 0) addFiles(dropped);
    }, [addFiles]);

    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); };
    const handleDragLeave = (e: React.DragEvent) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setIsDragOver(false);
    };
    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files;
        if (f && f.length > 0) addFiles(Array.from(f));
        e.target.value = '';
    };

    const hasFiles = files.length > 0;
    const isConverting = files.some(f => f.status === 'converting');
    const hasIdle = files.some(f => f.status === 'idle');
    const allCompleted = files.length > 0 && files.every(f => f.status === 'done');

    // Group files
    const imageFiles = files.filter(f => f.type === 'image');
    const videoFiles = files.filter(f => f.type === 'video' || f.type === 'gif');
    const audioFiles = files.filter(f => f.type === 'audio');

    const getTypeIcon = (type: FileType) => {
        switch (type) {
            case 'image': return <ImageIcon className="w-4 h-4 text-blue-400" />;
            case 'video': return <Film className="w-4 h-4 text-purple-400" />;
            case 'gif': return <Film className="w-4 h-4 text-amber-400" />;
            case 'audio': return <Music className="w-4 h-4 text-emerald-400" />;
        }
    };

    // Shared file row renderer
    const renderFileRow = (item: ConvertFileItem) => {
        const originalFormat = getCurrentFormat(item.name).toUpperCase();
        const nameWithoutExt = item.name.replace(/\.[^.]+$/, '');

        return (
            <div
                key={item.id}
                className="flex items-center gap-2.5 px-3 py-2.5 bg-slate-800/40 rounded-lg border border-white/5 shrink-0 group"
            >
                {/* Thumbnail */}
                {item.previewUrl && item.type === 'video' ? (
                    <div className="w-10 h-10 rounded-lg overflow-hidden bg-slate-900 shrink-0 flex items-center justify-center">
                        <video src={`${item.previewUrl}#t=0.1`} className="max-w-full max-h-full" muted preload="metadata" />
                    </div>
                ) : item.previewUrl && (item.type === 'image' || item.type === 'gif') ? (
                    <div className="w-10 h-10 rounded-lg overflow-hidden bg-slate-900 shrink-0 flex items-center justify-center">
                        <img src={item.previewUrl} className="max-w-full max-h-full object-contain" alt="" />
                    </div>
                ) : (
                    <div className="w-10 h-10 rounded-lg bg-slate-900/60 flex items-center justify-center shrink-0">
                        {getTypeIcon(item.type)}
                    </div>
                )}

                {/* Name + size */}
                <div className="flex-1 min-w-0">
                    <p className="text-xs text-slate-200 truncate font-medium">{nameWithoutExt}</p>
                    <p className="text-[11px] text-slate-500">{formatSize(item.sizeBytes)}</p>
                </div>

                {/* Original format → Target format */}
                <span className="text-[11px] font-bold text-slate-400 bg-slate-700/50 px-2 py-0.5 rounded shrink-0">
                    {originalFormat}
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-blue-400/50 shrink-0" />
                <span className="text-[11px] font-bold text-blue-300 bg-blue-500/20 px-2 py-0.5 rounded shrink-0">
                    {FORMAT_LABELS[item.targetFormat] || item.targetFormat.toUpperCase()}
                </span>

                {/* Status */}
                <div className="w-10 shrink-0 flex justify-end">
                    {item.status === 'converting' && (
                        <div className="flex items-center gap-1">
                            <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
                            {item.progress !== undefined && item.progress > 0 && (
                                <span className="text-[10px] text-blue-300">{item.progress}%</span>
                            )}
                        </div>
                    )}
                    {item.status === 'done' && <Check className="w-3.5 h-3.5 text-green-400" />}
                    {item.status === 'error' && <AlertCircle className="w-3 h-3 text-red-400" title={item.error} />}
                </div>

                {/* Remove */}
                <button
                    onClick={() => removeFile(item.id)}
                    disabled={item.status === 'converting'}
                    className="shrink-0 text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-30"
                >
                    <X className="w-3.5 h-3.5" />
                </button>
            </div>
        );
    };

    // Shared group section renderer
    const renderGroup = (group: GroupId, groupFiles: ConvertFileItem[]) => {
        if (groupFiles.length === 0) return null;
        const formats = GROUP_FORMATS[group];
        const active = groupTarget[group];

        return (
            <div key={group} className="flex flex-col gap-1">
                {/* Group toggle bar */}
                <div className="flex items-center gap-2 mb-0.5">
                    {GROUP_ICON[group]}
                    <div className="flex flex-wrap gap-0.5 rounded-lg bg-slate-800/80 border border-white/5 p-0.5">
                        {formats.map(fmt => (
                            <button
                                key={fmt}
                                onClick={() => handleGroupChange(group, fmt)}
                                className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${
                                    active === fmt
                                        ? 'bg-blue-600 text-white shadow-sm'
                                        : 'text-slate-500 hover:text-slate-300'
                                }`}
                            >
                                {FORMAT_LABELS[fmt]}
                            </button>
                        ))}
                    </div>
                </div>
                {/* Files */}
                {groupFiles.map(renderFileRow)}
            </div>
        );
    };

    return (
        <div
            className="absolute inset-0 flex flex-col rounded-2xl overflow-hidden"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
        >
            {/* Header */}
            <div className="flex items-center px-4 py-3 border-b border-white/5 shrink-0">
                <div className="flex items-center gap-2">
                    <ArrowRightLeft className="w-4 h-4 text-blue-400" />
                    <span className="text-sm font-bold text-white">تحويل الصيغة</span>
                    {hasFiles && (
                        <span className="text-xs bg-slate-700 px-2 py-0.5 rounded-full text-slate-300">{files.length}</span>
                    )}
                </div>
                <div className="flex-1" />
                <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1">
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Body */}
            <div className="flex-1 flex flex-col min-h-0 p-3 gap-2">
                <AnimatePresence mode="wait">
                    {!hasFiles && (
                        <motion.label
                            key="empty"
                            htmlFor="converter-file-input"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className={`
                                flex-1 flex flex-col items-center justify-center gap-4 rounded-xl
                                border-2 border-dashed transition-all duration-200 cursor-pointer
                                ${isDragOver
                                    ? 'border-blue-400 bg-blue-500/10 scale-[0.99]'
                                    : 'border-slate-700 bg-slate-800/30 hover:border-slate-500 hover:bg-slate-800/50'
                                }
                            `}
                        >
                            <div className={`p-4 rounded-2xl transition-colors ${isDragOver ? 'bg-blue-500/20' : 'bg-slate-800'}`}>
                                {isDragOver
                                    ? <Upload className="w-8 h-8 text-blue-400" />
                                    : <ArrowRightLeft className="w-8 h-8 text-slate-500" />
                                }
                            </div>
                            <div className="text-center px-4">
                                <p className="text-sm font-semibold text-slate-300">
                                    {isDragOver ? 'أفلت الملفات هنا' : 'اسحب ملفات هنا للتحويل'}
                                </p>
                                <p className="text-xs text-slate-500 mt-1">أو اضغط للاختيار يدويًا</p>
                                <p className="text-[10px] text-slate-600 mt-2">صور: JPG · PNG · WEBP · BMP · TIFF · PSD · AI</p>
                                <p className="text-[10px] text-slate-600">فيديو: MP4 · WEBM · MOV · AVI · MKV · GIF</p>
                                <p className="text-[10px] text-slate-600">صوت: MP3 · WAV · OGG</p>
                            </div>
                            <input id="converter-file-input" type="file" accept={FILE_ACCEPT} multiple className="sr-only" onChange={handleFileInput} />
                        </motion.label>
                    )}

                    {hasFiles && (
                        <motion.div
                            key="list"
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className="flex-1 flex flex-col gap-3 min-h-0 overflow-y-auto"
                        >
                            {renderGroup('image', imageFiles)}
                            {renderGroup('video', videoFiles)}
                            {renderGroup('audio', audioFiles)}

                            {/* Add more */}
                            <label
                                htmlFor="converter-add-input"
                                className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed cursor-pointer transition-colors shrink-0 ${
                                    isDragOver ? 'border-blue-400 bg-blue-500/10' : 'border-slate-700 hover:border-slate-500 bg-slate-800/20'
                                }`}
                            >
                                <Upload className="w-3.5 h-3.5 text-slate-500" />
                                <span className="text-[11px] text-slate-500">إضافة ملفات</span>
                                <input id="converter-add-input" type="file" accept={FILE_ACCEPT} multiple className="sr-only" onChange={handleFileInput} />
                            </label>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Footer */}
            <div className="flex items-center gap-1.5 px-3 pb-3 shrink-0">
                {isConverting ? (
                    <button
                        onMouseEnter={() => setCancelHover(true)}
                        onMouseLeave={() => setCancelHover(false)}
                        onClick={cancelHover ? cancelAll : undefined}
                        className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all ${
                            cancelHover
                                ? 'bg-red-600 hover:bg-red-500 text-white cursor-pointer'
                                : 'bg-blue-600/50 text-white/60'
                        }`}
                    >
                        {cancelHover ? <><Ban className="w-4 h-4" />إلغاء</> : <><Loader2 className="w-4 h-4 animate-spin" />جاري التحويل...</>}
                    </button>
                ) : allCompleted ? (
                    <button onClick={handleDownload} disabled={isDownloading} className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50">
                        {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        تحميل
                    </button>
                ) : hasIdle ? (
                    <button onClick={convertAll} className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all bg-blue-600 hover:bg-blue-500 text-white">
                        <ArrowRightLeft className="w-4 h-4" />
                        تحويل
                    </button>
                ) : (
                    <button disabled className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold bg-slate-800/50 text-slate-600 cursor-not-allowed">
                        <ArrowRightLeft className="w-4 h-4" />
                        تحويل الصيغة
                    </button>
                )}
                <div className="flex-1 flex items-center gap-1">
                    <button onClick={handleCopy} disabled={isCopying || !files.some(f => f.status === 'done')} className="flex-1 flex items-center justify-center h-10 rounded-xl transition-colors bg-white/[0.04] hover:bg-white/[0.1] text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed" title="نسخ">
                        {isCopying ? <Loader2 className="w-4 h-4 animate-spin" /> : showCopySuccess ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                    <button onClick={handlePaste} className="flex-1 flex items-center justify-center h-10 rounded-xl transition-colors bg-white/[0.04] hover:bg-white/[0.1] text-slate-400 hover:text-white" title="لصق">
                        <ClipboardPaste className="w-4 h-4" />
                    </button>
                    <button onClick={handleClear} disabled={!hasFiles || isConverting} className={`flex-1 flex items-center justify-center h-10 rounded-xl transition-colors ${!hasFiles || isConverting ? 'bg-slate-800/50 text-slate-600 cursor-not-allowed' : 'bg-red-900/20 hover:bg-red-900/40 text-red-400 hover:text-red-300'}`} title="مسح الكل">
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
};
