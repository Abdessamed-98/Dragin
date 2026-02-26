
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ImagePlus, Upload, Loader2, Download, Trash2, AlertCircle,
    X, Check, ClipboardPaste, Ban, Copy
} from 'lucide-react';
import {
    getUpscaleStatus, startUpscale, getUpscaleProgress,
    fetchUpscaleResultBlob, cleanupUpscaleJob
} from '../../services/api';
import type { UpscaleScale, UpscaleModel } from '../../services/api';
import JSZip from 'jszip';

interface UpscalerToolProps {
    onClose: () => void;
    droppedFiles: File[];
    dropGeneration: number;
    onItemCountChange?: (count: number) => void;
    clearGen?: number;
}

interface UpscaleFileItem {
    id: string;
    file: File;
    name: string;
    sizeBytes: number;
    previewUrl: string;        // blob URL for the original file thumbnail (created once)
    status: 'idle' | 'processing' | 'done' | 'error';
    scale: UpscaleScale;
    model: UpscaleModel;
    jobId?: string;            // backend job ID — used for progress, download & cleanup
    progress?: number;
    resultSize?: number;       // size reported by backend (no blob stored client-side)
    error?: string;
}

const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
};

const genId = () => Math.random().toString(36).substring(2, 11);

const isImageFile = (file: File): boolean => {
    if (file.type.startsWith('image/') && file.type !== 'image/gif') return true;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    return ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif'].includes(ext);
};

const SCALE_OPTIONS: UpscaleScale[] = [2, 4];

const MODEL_OPTIONS: { value: UpscaleModel; label: string }[] = [
    { value: 'realesrgan-x4plus', label: 'عام' },
    { value: 'realesrgan-x4plus-anime', label: 'رسوم' },
];

export const UpscalerTool: React.FC<UpscalerToolProps> = ({ onClose, droppedFiles, dropGeneration, onItemCountChange, clearGen = 0 }) => {
    const [files, setFiles] = useState<UpscaleFileItem[]>([]);
    const [available, setAvailable] = useState<boolean | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [cancelHover, setCancelHover] = useState(false);
    const [isCopying, setIsCopying] = useState(false);
    const [showCopySuccess, setShowCopySuccess] = useState(false);
    const [globalScale, setGlobalScale] = useState<UpscaleScale>(4);
    const [globalModel, setGlobalModel] = useState<UpscaleModel>('realesrgan-x4plus');
    const pollTimers = useRef<Record<string, NodeJS.Timeout>>({});
    const filesRef = useRef<UpscaleFileItem[]>([]);

    // Keep ref in sync so unmount cleanup can access current files
    useEffect(() => { filesRef.current = files; }, [files]);

    // Report item count to parent (for collapsed badge)
    useEffect(() => { onItemCountChange?.(files.length); }, [files.length, onItemCountChange]);

    // Check availability on mount
    useEffect(() => {
        getUpscaleStatus()
            .then(r => setAvailable(r.available))
            .catch(() => setAvailable(false));
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
        filesRef.current.forEach(f => {
            URL.revokeObjectURL(f.previewUrl);
            if (f.jobId) cleanupUpscaleJob(f.jobId);
        });
        setFiles([]);
    }, [clearGen]);

    // Cleanup on unmount: timers, preview blob URLs, backend temp files
    useEffect(() => {
        return () => {
            Object.values(pollTimers.current).forEach(clearInterval);
            filesRef.current.forEach(f => {
                URL.revokeObjectURL(f.previewUrl);
                if (f.jobId) cleanupUpscaleJob(f.jobId);
            });
        };
    }, []);

    const addFiles = useCallback((newFiles: File[]) => {
        const items: UpscaleFileItem[] = [];
        for (const file of newFiles) {
            if (!isImageFile(file)) continue;
            items.push({
                id: genId(),
                file,
                name: file.name,
                sizeBytes: file.size,
                previewUrl: URL.createObjectURL(file),
                status: 'idle',
                scale: globalScale,
                model: globalModel,
            });
        }
        if (items.length > 0) {
            setFiles(prev => [...prev, ...items]);
        }
    }, [globalScale, globalModel]);

    const removeFile = (fileId: string) => {
        if (pollTimers.current[fileId]) {
            clearInterval(pollTimers.current[fileId]);
            delete pollTimers.current[fileId];
        }
        setFiles(prev => {
            const removed = prev.find(f => f.id === fileId);
            if (removed) {
                URL.revokeObjectURL(removed.previewUrl);
                if (removed.jobId) cleanupUpscaleJob(removed.jobId);
            }
            return prev.filter(f => f.id !== fileId);
        });
    };

    const updateFile = (fileId: string, updates: Partial<UpscaleFileItem>) => {
        setFiles(prev => prev.map(f => f.id === fileId ? { ...f, ...updates } : f));
    };

    const upscaleSingleFile = useCallback(async (item: UpscaleFileItem) => {
        updateFile(item.id, { status: 'processing', progress: 0, error: undefined });

        try {
            const { jobId } = await startUpscale(item.file, item.scale, item.model);
            updateFile(item.id, { jobId });

            // Poll for progress — result stays on disk, NOT fetched into renderer
            const timer = setInterval(async () => {
                try {
                    const prog = await getUpscaleProgress(jobId);
                    if (prog.status === 'done') {
                        clearInterval(timer);
                        delete pollTimers.current[item.id];
                        updateFile(item.id, {
                            status: 'done',
                            progress: 100,
                            resultSize: prog.size,
                        });
                    } else if (prog.status === 'error') {
                        clearInterval(timer);
                        delete pollTimers.current[item.id];
                        updateFile(item.id, { status: 'error', error: prog.error || 'Upscale failed' });
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
        } catch (err: any) {
            updateFile(item.id, { status: 'error', error: err?.message || 'Upscale failed' });
        }
    }, []);

    const upscaleAll = () => {
        const idleFiles = files.filter(f => f.status === 'idle');
        for (const item of idleFiles) {
            upscaleSingleFile(item);
        }
    };

    const cancelAll = () => {
        Object.values(pollTimers.current).forEach(clearInterval);
        pollTimers.current = {};
        setFiles(prev => prev.map(f =>
            f.status === 'processing' ? { ...f, status: 'idle' as const, progress: undefined, jobId: undefined } : f
        ));
        setCancelHover(false);
    };

    const handleDownload = async () => {
        const completed = files.filter(f => f.status === 'done' && f.jobId);
        if (completed.length === 0) return;

        setIsDownloading(true);
        try {
            if (completed.length === 1) {
                // Single file — fetch blob, trigger download, release immediately
                const item = completed[0];
                const blob = await fetchUpscaleResultBlob(item.jobId!);
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                const base = item.name.replace(/\.[^.]+$/, '');
                link.download = `${base}-${item.scale}x.png`;
                link.click();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
                return;
            }

            // Multiple files → zip (blobs exist only during zip creation)
            const zip = new JSZip();
            for (const item of completed) {
                const blob = await fetchUpscaleResultBlob(item.jobId!);
                const base = item.name.replace(/\.[^.]+$/, '');
                zip.file(`${base}-${item.scale}x.png`, blob);
            }
            const content = await zip.generateAsync({ type: 'blob' });
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = `upscaled-${Date.now()}.zip`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        } catch (err) {
            console.error('Download failed', err);
        } finally {
            setIsDownloading(false);
        }
    };

    const handleClear = () => {
        Object.values(pollTimers.current).forEach(clearInterval);
        pollTimers.current = {};
        files.forEach(f => {
            URL.revokeObjectURL(f.previewUrl);
            if (f.jobId) cleanupUpscaleJob(f.jobId);
        });
        setFiles([]);
        onClose();
    };

    const handlePaste = async () => {
        try {
            if ((window as any).electron?.clipboardRead) {
                const clipItems = await (window as any).electron.clipboardRead();
                if (clipItems.length > 0) {
                    const pastedFiles = await Promise.all(clipItems.map(async ({ dataUrl, name }: { dataUrl: string; name: string }) => {
                        const res = await fetch(dataUrl);
                        const blob = await res.blob();
                        return new File([blob], name, { type: blob.type || 'application/octet-stream' });
                    }));
                    addFiles(pastedFiles);
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

    const handleCopy = async () => {
        const completed = files.filter(f => f.status === 'done' && f.jobId);
        if (completed.length === 0 || isCopying) return;
        setIsCopying(true);
        try {
            const clipItems = await Promise.all(completed.map(async (item) => {
                const blob = await fetchUpscaleResultBlob(item.jobId!);
                const dataUrl = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
                return { dataUrl, name: item.name };
            }));
            if ((window as any).electron?.clipboardWrite) {
                await (window as any).electron.clipboardWrite(clipItems);
            }
            setShowCopySuccess(true);
            setTimeout(() => setShowCopySuccess(false), 1500);
        } catch (err) { console.error('Copy failed:', err); }
        finally { setIsCopying(false); }
    };

    // Drag handlers
    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        const dropped = Array.from(e.dataTransfer.files);
        if (dropped.length > 0) addFiles(dropped);
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

    const handleGlobalScaleChange = (scale: UpscaleScale) => {
        setGlobalScale(scale);
        setFiles(prev => prev.map(f => f.status === 'idle' ? { ...f, scale } : f));
    };

    const handleGlobalModelChange = (model: UpscaleModel) => {
        setGlobalModel(model);
        setFiles(prev => prev.map(f => f.status === 'idle' ? { ...f, model } : f));
    };

    const hasFiles = files.length > 0;
    const isProcessing = files.some(f => f.status === 'processing');
    const hasIdle = files.some(f => f.status === 'idle');
    const allCompleted = files.length > 0 && files.every(f => f.status === 'done');

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
                    <ImagePlus className="w-4 h-4 text-pink-400" />
                    <span className="text-sm font-bold text-white">رفع الدقة</span>
                    {hasFiles && (
                        <span className="text-xs bg-slate-700 px-2 py-0.5 rounded-full text-slate-300">{files.length}</span>
                    )}
                </div>
                <div className="flex-1" />
                <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1">
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Global settings bar */}
            {hasFiles && (
                <div className="flex items-center gap-3 px-4 py-2 border-b border-white/5 shrink-0">
                    {/* Scale selector */}
                    <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-500">التكبير:</span>
                        <div className="flex gap-0.5">
                            {SCALE_OPTIONS.map(s => (
                                <button
                                    key={s}
                                    onClick={() => handleGlobalScaleChange(s)}
                                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                                        globalScale === s
                                            ? 'bg-pink-600 text-white'
                                            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                                    }`}
                                >
                                    {s}x
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="w-px h-4 bg-white/10" />

                    {/* Model selector */}
                    <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-slate-500">النموذج:</span>
                        <div className="flex gap-0.5">
                            {MODEL_OPTIONS.map(m => (
                                <button
                                    key={m.value}
                                    onClick={() => handleGlobalModelChange(m.value)}
                                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                                        globalModel === m.value
                                            ? 'bg-pink-600 text-white'
                                            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                                    }`}
                                >
                                    {m.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Body */}
            <div className="flex-1 flex flex-col min-h-0 p-3 gap-2">
                <AnimatePresence mode="wait">
                    {/* Empty state */}
                    {!hasFiles && (
                        <motion.label
                            key="empty"
                            htmlFor="upscaler-file-input"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className={`
                                flex-1 flex flex-col items-center justify-center gap-4 rounded-xl
                                border-2 border-dashed transition-all duration-200 cursor-pointer
                                ${isDragOver
                                    ? 'border-pink-400 bg-pink-500/10 scale-[0.99]'
                                    : 'border-slate-700 bg-slate-800/30 hover:border-slate-500 hover:bg-slate-800/50'
                                }
                            `}
                        >
                            <div className={`p-4 rounded-2xl transition-colors ${isDragOver ? 'bg-pink-500/20' : 'bg-slate-800'}`}>
                                {isDragOver
                                    ? <Upload className="w-8 h-8 text-pink-400" />
                                    : <ImagePlus className="w-8 h-8 text-slate-500" />
                                }
                            </div>
                            <div className="text-center px-4">
                                <p className="text-sm font-semibold text-slate-300">
                                    {isDragOver ? 'أفلت الصور هنا' : 'اسحب صور هنا لرفع الدقة'}
                                </p>
                                <p className="text-xs text-slate-500 mt-1">أو اضغط للاختيار يدويًا</p>
                                <p className="text-[10px] text-slate-600 mt-2">
                                    JPG · PNG · WEBP · BMP · TIFF
                                </p>
                                <p className="text-[10px] text-slate-600 mt-1">
                                    Real-ESRGAN AI · تكبير حتى 4x
                                </p>
                            </div>
                            <input
                                id="upscaler-file-input"
                                type="file"
                                accept="image/jpeg,image/png,image/webp,image/bmp,image/tiff,.jpg,.jpeg,.png,.webp,.bmp,.tiff,.tif"
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
                                    {/* Thumbnail — always shows the small ORIGINAL preview */}
                                    <div className="w-8 h-8 rounded overflow-hidden bg-slate-900 shrink-0 flex items-center justify-center">
                                        <img
                                            src={item.previewUrl}
                                            className={`w-full h-full object-cover ${item.status === 'done' ? '' : 'opacity-60'}`}
                                            alt=""
                                        />
                                    </div>

                                    {/* Name + size */}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[11px] text-slate-300 truncate">{item.name}</p>
                                        <p className="text-[10px] text-slate-600">{formatSize(item.sizeBytes)}</p>
                                    </div>

                                    {/* Scale badge */}
                                    <span className="text-[10px] font-medium text-pink-300 bg-pink-500/10 px-1.5 py-0.5 rounded shrink-0">
                                        {item.scale}x
                                    </span>

                                    {/* Status indicator */}
                                    <div className="w-14 text-right shrink-0">
                                        {item.status === 'idle' && (
                                            <span className="text-[10px] text-slate-600">—</span>
                                        )}
                                        {item.status === 'processing' && (
                                            <div className="flex items-center gap-1 justify-end">
                                                <Loader2 className="w-3 h-3 text-pink-400 animate-spin" />
                                                {item.progress !== undefined && item.progress > 0 && (
                                                    <span className="text-[10px] text-pink-300">{item.progress}%</span>
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
                                        disabled={item.status === 'processing'}
                                        className="shrink-0 text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-30"
                                        title="إزالة"
                                    >
                                        <X className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))}

                            {/* Add more files zone */}
                            <label
                                htmlFor="upscaler-add-input"
                                className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed cursor-pointer transition-colors shrink-0 ${
                                    isDragOver
                                        ? 'border-pink-400 bg-pink-500/10'
                                        : 'border-slate-700 hover:border-slate-500 bg-slate-800/20'
                                }`}
                            >
                                <Upload className="w-3.5 h-3.5 text-slate-500" />
                                <span className="text-[11px] text-slate-500">إضافة صور</span>
                                <input
                                    id="upscaler-add-input"
                                    type="file"
                                    accept="image/jpeg,image/png,image/webp,image/bmp,image/tiff,.jpg,.jpeg,.png,.webp,.bmp,.tiff,.tif"
                                    multiple
                                    className="sr-only"
                                    onChange={handleFileInput}
                                />
                            </label>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Unavailable warning */}
            {available === false && (
                <div className="flex items-center gap-2 px-3 py-2 bg-red-900/20 border-t border-red-500/20 shrink-0">
                    <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                    <span className="text-[11px] text-red-300">Real-ESRGAN غير متوفر</span>
                </div>
            )}

            {/* Footer: [Main button] | [Paste][Clear] */}
            <div className="flex items-center gap-1.5 px-3 pb-3 shrink-0">
                {/* Left half: Main action / download */}
                {isProcessing ? (
                    <button
                        onMouseEnter={() => setCancelHover(true)}
                        onMouseLeave={() => setCancelHover(false)}
                        onClick={cancelHover ? cancelAll : undefined}
                        className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all ${
                            cancelHover ? 'bg-red-600 hover:bg-red-500 text-white cursor-pointer' : 'bg-pink-600/50 text-white/60'
                        }`}
                    >
                        {cancelHover ? (
                            <><Ban className="w-4 h-4" />إلغاء</>
                        ) : (
                            <><Loader2 className="w-4 h-4 animate-spin" />جاري التكبير...</>
                        )}
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
                        onClick={upscaleAll}
                        disabled={available === false}
                        className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all ${
                            available === false
                                ? 'bg-slate-800/50 text-slate-600 cursor-not-allowed'
                                : 'bg-pink-600 hover:bg-pink-500 text-white'
                        }`}
                    >
                        <ImagePlus className="w-4 h-4" />
                        تكبير
                    </button>
                ) : (
                    <button
                        disabled
                        className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold bg-slate-800/50 text-slate-600 cursor-not-allowed"
                    >
                        <ImagePlus className="w-4 h-4" />
                        رفع الدقة
                    </button>
                )}

                {/* Right half: Copy | Paste | Clear */}
                <div className="flex-1 flex items-center gap-1">
                    <button
                        onClick={handleCopy}
                        disabled={!files.some(f => f.status === 'done' && f.jobId) || isCopying}
                        className={`flex-1 flex items-center justify-center h-10 rounded-xl transition-colors ${
                            !files.some(f => f.status === 'done' && f.jobId)
                                ? 'bg-slate-800/50 text-slate-600 cursor-not-allowed'
                                : 'bg-white/[0.04] hover:bg-white/[0.1] text-slate-400 hover:text-white'
                        }`}
                        title="نسخ"
                    >
                        {isCopying ? <Loader2 className="w-4 h-4 animate-spin" /> : showCopySuccess ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                    <button
                        onClick={handlePaste}
                        className="flex-1 flex items-center justify-center h-10 rounded-xl transition-colors bg-white/[0.04] hover:bg-white/[0.1] text-slate-400 hover:text-white"
                        title="لصق"
                    >
                        <ClipboardPaste className="w-4 h-4" />
                    </button>
                    <button
                        onClick={handleClear}
                        disabled={!hasFiles || isProcessing}
                        className={`flex-1 flex items-center justify-center h-10 rounded-xl transition-colors ${
                            !hasFiles || isProcessing
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
