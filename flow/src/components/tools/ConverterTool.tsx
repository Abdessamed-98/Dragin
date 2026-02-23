
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ArrowRightLeft, Upload, Loader2, Download, Trash2, AlertCircle,
    X, Check, Image as ImageIcon, Film, ChevronDown, ClipboardPaste
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

type FileType = 'image' | 'video' | 'gif';

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
const VIDEO_FORMATS: ConvertFormat[] = ['mp4', 'webm', 'mov', 'avi', 'mkv'];
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
    // Check extension as fallback
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (['gif'].includes(ext)) return 'gif';
    if (['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'psd', 'ai'].includes(ext)) return 'image';
    if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'flv', 'wmv'].includes(ext)) return 'video';
    return null;
};

const getCurrentFormat = (name: string): string => {
    const ext = name.split('.').pop()?.toLowerCase() || '';
    if (ext === 'jpeg') return 'jpg';
    if (ext === 'tif') return 'tiff';
    return ext;
};

const getDefaultTarget = (type: FileType, currentFormat: string): ConvertFormat => {
    if (type === 'image') {
        const options = IMAGE_FORMATS.filter(f => f !== currentFormat);
        return options[0] || 'png';
    }
    if (type === 'gif') return 'mp4';
    // video
    const options = VIDEO_FORMATS.filter(f => f !== currentFormat);
    return options[0] || 'mp4';
};

const getAvailableFormats = (type: FileType, currentFormat: string, ffmpegAvailable: boolean): ConvertFormat[] => {
    if (type === 'image') {
        return IMAGE_FORMATS.filter(f => f !== currentFormat);
    }
    if (type === 'gif') {
        return ffmpegAvailable ? GIF_OUTPUT_FORMATS : [];
    }
    // video
    const formats = [...VIDEO_FORMATS, 'gif' as ConvertFormat, ...AUDIO_FORMATS].filter(f => f !== currentFormat);
    return ffmpegAvailable ? formats : [];
};

const FORMAT_LABELS: Record<string, string> = {
    jpg: 'JPG', png: 'PNG', webp: 'WebP', bmp: 'BMP', tiff: 'TIFF',
    mp4: 'MP4', webm: 'WebM', mov: 'MOV', avi: 'AVI', mkv: 'MKV',
    mp3: 'MP3', wav: 'WAV', ogg: 'OGG', gif: 'GIF',
};

export const ConverterTool: React.FC<ConverterToolProps> = ({ onClose, droppedFiles, dropGeneration, onItemCountChange, clearGen = 0 }) => {
    const [files, setFiles] = useState<ConvertFileItem[]>([]);
    const [ffmpegAvailable, setFfmpegAvailable] = useState<boolean | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const pollTimers = useRef<Record<string, NodeJS.Timeout>>({});

    // Report item count to parent (for collapsed badge)
    useEffect(() => { onItemCountChange?.(files.length); }, [files.length, onItemCountChange]);

    // Check FFmpeg on mount
    useEffect(() => {
        getConvertStatus()
            .then(r => setFfmpegAvailable(r.ffmpeg))
            .catch(() => setFfmpegAvailable(false));
    }, []);

    // Handle files dropped from DockApp (skip stale props on remount)
    const lastDropGen = useRef(dropGeneration);
    useEffect(() => {
        if (dropGeneration === 0) return;
        if (dropGeneration === lastDropGen.current) return;
        lastDropGen.current = dropGeneration;
        if (droppedFiles.length === 0) return;
        addFiles(droppedFiles);
    }, [dropGeneration]); // eslint-disable-line react-hooks/exhaustive-deps

    // Clear all files when global clear is triggered
    const lastClearGen = useRef(clearGen);
    useEffect(() => {
        if (clearGen === 0 || clearGen === lastClearGen.current) return;
        lastClearGen.current = clearGen;
        Object.values(pollTimers.current).forEach(clearInterval);
        pollTimers.current = {};
        setFiles([]);
    }, [clearGen]);

    // Cleanup poll timers + preview blob URLs on unmount
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
            let previewUrl: string | undefined;
            let previewNeedsRevoke = false;
            try {
                const result = await getFileThumbnail(file, 64);
                if (result) { previewUrl = result.url; previewNeedsRevoke = result.needsRevoke; }
            } catch { /* preview failed — proceed without */ }
            items.push({
                id: genId(),
                file,
                name: file.name,
                sizeBytes: file.size,
                type,
                status: 'idle',
                targetFormat: getDefaultTarget(type, currentFormat),
                previewUrl,
                previewNeedsRevoke,
            });
        }
        if (items.length > 0) {
            setFiles(prev => [...prev, ...items]);
        }
    }, []);

    const removeFile = (fileId: string) => {
        // Stop any active poll for this file
        if (pollTimers.current[fileId]) {
            clearInterval(pollTimers.current[fileId]);
            delete pollTimers.current[fileId];
        }
        setFiles(prev => {
            const removed = prev.find(f => f.id === fileId);
            if (removed?.previewUrl && removed.previewNeedsRevoke) {
                URL.revokeObjectURL(removed.previewUrl);
            }
            return prev.filter(f => f.id !== fileId);
        });
    };

    const updateFile = (fileId: string, updates: Partial<ConvertFileItem>) => {
        setFiles(prev => prev.map(f => f.id === fileId ? { ...f, ...updates } : f));
    };

    const setTargetFormat = (fileId: string, format: ConvertFormat) => {
        setFiles(prev => prev.map(f => f.id === fileId ? { ...f, targetFormat: format, status: 'idle', resultDataUrl: undefined, resultSize: undefined, error: undefined } : f));
    };

    const convertSingleFile = useCallback(async (item: ConvertFileItem) => {
        updateFile(item.id, { status: 'converting', progress: 0, error: undefined });

        try {
            if (item.type === 'image') {
                // Instant image conversion
                const result = await convertImage(item.file, item.targetFormat as ImageFormat);
                updateFile(item.id, {
                    status: 'done',
                    resultDataUrl: result.dataUrl,
                    resultSize: result.size,
                });
            } else {
                // Video/GIF → FFmpeg async
                const { jobId } = await startVideoConversion(item.file, item.targetFormat);
                updateFile(item.id, { jobId });

                // Poll for progress
                const timer = setInterval(async () => {
                    try {
                        const prog = await getVideoProgress(jobId);
                        if (prog.status === 'done') {
                            clearInterval(timer);
                            delete pollTimers.current[item.id];
                            updateFile(item.id, {
                                status: 'done',
                                progress: 100,
                                resultDataUrl: prog.dataUrl,
                                resultSize: prog.size,
                            });
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
        const idleFiles = files.filter(f => f.status === 'idle');
        for (const item of idleFiles) {
            convertSingleFile(item);
        }
    };

    const handleDownload = async () => {
        const completed = files.filter(f => f.status === 'done' && f.resultDataUrl);
        if (completed.length === 0) return;

        if (completed.length === 1) {
            const item = completed[0];
            const link = document.createElement('a');
            link.href = item.resultDataUrl!;
            const base = item.name.replace(/\.[^.]+$/, '');
            link.download = `${base}-converted.${item.targetFormat}`;
            link.click();
            return;
        }

        // Multiple files → zip
        setIsDownloading(true);
        try {
            const zip = new JSZip();
            await Promise.all(completed.map(async (item) => {
                const res = await fetch(item.resultDataUrl!);
                const blob = await res.blob();
                const base = item.name.replace(/\.[^.]+$/, '');
                zip.file(`${base}-converted.${item.targetFormat}`, blob);
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
        files.forEach(f => {
            if (f.previewUrl && f.previewNeedsRevoke) URL.revokeObjectURL(f.previewUrl);
        });
        setFiles([]);
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
                        const file = new File([blob], `pasted.${ext}`, { type: imageType });
                        addFiles([file]);
                        return;
                    }
                }
            }
        } catch (err) {
            console.warn('Clipboard read failed:', err);
        }
    };

    // Drag handlers
    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        const droppedFiles = Array.from(e.dataTransfer.files);
        if (droppedFiles.length > 0) addFiles(droppedFiles);
    }, [addFiles]);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
            setIsDragOver(false);
        }
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
    const getTypeIcon = (type: FileType) => {
        switch (type) {
            case 'image': return <ImageIcon className="w-3.5 h-3.5 text-blue-400" />;
            case 'video': return <Film className="w-3.5 h-3.5 text-purple-400" />;
            case 'gif': return <Film className="w-3.5 h-3.5 text-amber-400" />;
        }
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
                    {/* Empty state */}
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
                                <p className="text-[10px] text-slate-600 mt-2">
                                    صور: JPG · PNG · WEBP · BMP · TIFF · PSD · AI
                                </p>
                                <p className="text-[10px] text-slate-600">
                                    فيديو: MP4 · WEBM · MOV · AVI · MKV · GIF
                                </p>
                            </div>
                            <input
                                id="converter-file-input"
                                type="file"
                                accept="image/*,video/*,.gif,.mp4,.webm,.mov,.avi,.mkv,.psd,.ai,.tiff,.tif"
                                multiple
                                className="sr-only"
                                onChange={handleFileInput}
                            />
                        </motion.label>
                    )}

                    {/* File list */}
                    {hasFiles && (
                        <motion.div
                            key="list"
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className="flex-1 flex flex-col gap-1.5 min-h-0 overflow-y-auto"
                        >
                            {files.map(item => (
                                <div
                                    key={item.id}
                                    className="flex items-center gap-2 px-2.5 py-2 bg-slate-800/60 rounded-lg border border-white/5 shrink-0 group"
                                >
                                    {/* Thumbnail or type icon */}
                                    {item.previewUrl ? (
                                        <div className="w-8 h-8 rounded overflow-hidden bg-slate-900 shrink-0">
                                            <img src={item.previewUrl} className="w-full h-full object-cover" alt="" />
                                        </div>
                                    ) : (
                                        <div className="shrink-0">{getTypeIcon(item.type)}</div>
                                    )}

                                    {/* Name + size */}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[11px] text-slate-300 truncate">{item.name}</p>
                                        <p className="text-[10px] text-slate-600">{formatSize(item.sizeBytes)}</p>
                                    </div>

                                    {/* Arrow */}
                                    <ArrowRightLeft className="w-3 h-3 text-slate-600 shrink-0" />

                                    {/* Format selector */}
                                    <div className="relative shrink-0">
                                        <select
                                            value={item.targetFormat}
                                            onChange={e => setTargetFormat(item.id, e.target.value as ConvertFormat)}
                                            disabled={item.status === 'converting'}
                                            className="appearance-none bg-slate-700/80 border border-white/10 rounded-md text-[11px] text-slate-200 pl-2 pr-5 py-1 cursor-pointer focus:outline-none focus:border-blue-500/50 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {getAvailableFormats(item.type, getCurrentFormat(item.name), ffmpegAvailable ?? false).map(fmt => (
                                                <option key={fmt} value={fmt}>{FORMAT_LABELS[fmt] || fmt.toUpperCase()}</option>
                                            ))}
                                        </select>
                                        <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
                                    </div>

                                    {/* Status indicator */}
                                    <div className="w-14 text-right shrink-0">
                                        {item.status === 'idle' && (
                                            <span className="text-[10px] text-slate-600">—</span>
                                        )}
                                        {item.status === 'converting' && (
                                            <div className="flex items-center gap-1 justify-end">
                                                <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
                                                {item.type !== 'image' && item.progress !== undefined && (
                                                    <span className="text-[10px] text-blue-300">{item.progress}%</span>
                                                )}
                                            </div>
                                        )}
                                        {item.status === 'done' && (
                                            <div className="flex items-center gap-1 justify-end">
                                                <Check className="w-3 h-3 text-green-400" />
                                                {item.resultSize && (
                                                    <span className="text-[10px] text-green-300">{formatSize(item.resultSize)}</span>
                                                )}
                                            </div>
                                        )}
                                        {item.status === 'error' && (
                                            <div className="flex items-center gap-1 justify-end" title={item.error}>
                                                <AlertCircle className="w-3 h-3 text-red-400" />
                                            </div>
                                        )}
                                    </div>

                                    {/* Remove button */}
                                    <button
                                        onClick={() => removeFile(item.id)}
                                        disabled={item.status === 'converting'}
                                        className="shrink-0 text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-30"
                                        title="إزالة"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))}

                            {/* Add more files zone */}
                            <label
                                htmlFor="converter-add-input"
                                className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed cursor-pointer transition-colors shrink-0 ${
                                    isDragOver
                                        ? 'border-blue-400 bg-blue-500/10'
                                        : 'border-slate-700 hover:border-slate-500 bg-slate-800/20'
                                }`}
                            >
                                <Upload className="w-3.5 h-3.5 text-slate-500" />
                                <span className="text-[11px] text-slate-500">إضافة ملفات</span>
                                <input
                                    id="converter-add-input"
                                    type="file"
                                    accept="image/*,video/*,.gif,.mp4,.webm,.mov,.avi,.mkv,.psd,.ai,.tiff,.tif"
                                    multiple
                                    className="sr-only"
                                    onChange={handleFileInput}
                                />
                            </label>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Footer: [Main button] | [Paste][Clear] */}
            <div className="flex items-center gap-1.5 px-3 pb-3 shrink-0">
                {/* Left half: Main action / download */}
                {isConverting ? (
                    <button
                        disabled
                        className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold bg-blue-600/50 text-white/60 cursor-not-allowed"
                    >
                        <Loader2 className="w-4 h-4 animate-spin" />
                        جاري التحويل...
                    </button>
                ) : allCompleted ? (
                    <button
                        onClick={handleDownload}
                        disabled={isDownloading}
                        className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
                    >
                        {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        تحميل
                    </button>
                ) : hasIdle ? (
                    <button
                        onClick={convertAll}
                        className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all bg-blue-600 hover:bg-blue-500 text-white"
                    >
                        <ArrowRightLeft className="w-4 h-4" />
                        تحويل
                    </button>
                ) : (
                    <button
                        disabled
                        className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold bg-slate-800/50 text-slate-600 cursor-not-allowed"
                    >
                        <ArrowRightLeft className="w-4 h-4" />
                        تحويل الصيغة
                    </button>
                )}

                {/* Right half: Paste | Clear */}
                <div className="flex-1 flex items-center gap-1">
                    <button
                        onClick={handlePaste}
                        className="flex-1 flex items-center justify-center h-10 rounded-xl transition-colors bg-white/[0.04] hover:bg-white/[0.1] text-slate-400 hover:text-white"
                        title="لصق"
                    >
                        <ClipboardPaste className="w-4 h-4" />
                    </button>
                    <button
                        onClick={handleClear}
                        disabled={!hasFiles || isConverting}
                        className={`flex-1 flex items-center justify-center h-10 rounded-xl transition-colors ${
                            !hasFiles || isConverting
                                ? 'bg-slate-800/50 text-slate-600 cursor-not-allowed'
                                : 'bg-red-900/20 hover:bg-red-900/40 text-red-400 hover:text-red-300'
                        }`}
                        title="مسح الكل"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
};
