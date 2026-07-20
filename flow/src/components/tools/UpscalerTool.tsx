
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Maximize2, Upload, Loader2, Download, Trash2, AlertCircle,
    X, Check, ClipboardPaste, Ban, Copy
} from 'lucide-react';
import {
    getUpscaleStatus, startUpscale, getUpscaleProgress,
    fetchUpscaleResultBlob, cleanupUpscaleJob
} from '../../services/api';
import type { UpscaleScale, UpscaleModel } from '../../services/api';
import { useI18n } from '../../i18n/I18nContext';
import { saveOutputs } from '../../services/saveOutput';
import { ToolHeader } from '../ToolHeader';
import { ToolIconButton } from '../ToolIconButton';
import { sessionStore, useSessionIngest } from '../../state/sessionStore';
import { toolAccepts } from '../../state/toolCompat';

interface UpscalerToolProps {
    onClose: () => void;
    /** True while this tool is the expanded panel — session ingestion runs only then. */
    active: boolean;
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

const isImageFile = (file: File): boolean => {
    if (file.type.startsWith('image/') && file.type !== 'image/gif') return true;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    return ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif'].includes(ext);
};

const SCALE_OPTIONS: UpscaleScale[] = [2, 4];

const MODEL_OPTIONS: { value: UpscaleModel; labelKey: 'upscaler.modelGeneral' | 'upscaler.modelAnime' }[] = [
    { value: 'realesrgan-x4plus', labelKey: 'upscaler.modelGeneral' },
    { value: 'realesrgan-x4plus-anime', labelKey: 'upscaler.modelAnime' },
];

export const UpscalerTool: React.FC<UpscalerToolProps> = ({ onClose, active, onItemCountChange, clearGen = 0 }) => {
    const { t } = useI18n();
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

    // Refs so session ingestion picks up the CURRENT scale/model settings.
    const scaleRef = useRef(globalScale); useEffect(() => { scaleRef.current = globalScale; }, [globalScale]);
    const modelRef = useRef(globalModel); useEffect(() => { modelRef.current = globalModel; }, [globalModel]);

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

    // Ingest session files (keyed by session id) — replaces same-id items on re-ingest.
    const ingestBatch = useCallback((batch: { id: string; file: File }[]) => {
        const items: UpscaleFileItem[] = batch.map(({ id, file }) => ({
            id,
            file,
            name: file.name,
            sizeBytes: file.size,
            previewUrl: URL.createObjectURL(file),
            status: 'idle' as const,
            scale: scaleRef.current,
            model: modelRef.current,
        }));
        if (!items.length) return;
        setFiles(prev => {
            prev.filter(p => items.some(n => n.id === p.id)).forEach(p => {
                URL.revokeObjectURL(p.previewUrl);
                if (pollTimers.current[p.id]) {
                    clearInterval(pollTimers.current[p.id]);
                    delete pollTimers.current[p.id];
                }
                if (p.jobId) cleanupUpscaleJob(p.jobId);
            });
            const kept = prev.filter(p => !items.some(n => n.id === p.id));
            return [...kept, ...items];
        });
    }, []);

    const removeLocal = useCallback((ids: string[]) => {
        ids.forEach(id => {
            if (pollTimers.current[id]) {
                clearInterval(pollTimers.current[id]);
                delete pollTimers.current[id];
            }
        });
        setFiles(prev => {
            prev.filter(p => ids.includes(p.id)).forEach(p => {
                URL.revokeObjectURL(p.previewUrl);
                if (p.jobId) cleanupUpscaleJob(p.jobId);
            });
            return prev.filter(p => !ids.includes(p.id));
        });
    }, []);

    useSessionIngest(active, 'upscaler', f => toolAccepts('upscaler', f) && isImageFile(f.currentFile), ingestBatch, removeLocal);

    // UI adds (drop on panel / file input / paste) go through the session store —
    // the ingest above brings them into local state.
    const addFiles = useCallback((newFiles: File[]) => {
        const imgs = newFiles.filter(isImageFile);
        if (imgs.length) sessionStore.addFiles(imgs);
    }, []);

    const removeFile = (fileId: string) => {
        sessionStore.remove([fileId]); // local cleanup (URL revoke, timers, backend job) happens via removeLocal
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
                        // Session write-back: the upscaled image becomes the file's
                        // current state, so switching tools carries the RESULT forward.
                        fetchUpscaleResultBlob(jobId)
                            .then(blob => sessionStore.applyResult(item.id, blob, `${item.name.replace(/\.[^.]+$/, '')}-${item.scale}x.png`, 'upscaler'))
                            .catch(() => {});
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
        const urls: string[] = [];
        try {
            const saveItems = await Promise.all(completed.map(async (item) => {
                const blob = await fetchUpscaleResultBlob(item.jobId!);
                const url = URL.createObjectURL(blob);
                urls.push(url);
                return {
                    name: `${item.name.replace(/\.[^.]+$/, '')}-${item.scale}x.png`,
                    url,
                    originalPath: (item.file as any).path ?? null,
                };
            }));
            await saveOutputs(saveItems, 'upscaled');
        } catch (err) {
            console.error('Save failed', err);
        } finally {
            urls.forEach(u => URL.revokeObjectURL(u));
            setIsDownloading(false);
        }
    };

    const handleClear = () => {
        sessionStore.remove(files.map(f => f.id)); // local cleanup happens via removeLocal
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
            <ToolHeader
                icon={<Maximize2 className="w-4 h-4 text-pink-400" />}
                title={t('upscaler.headerTitle')}
                count={files.length}
                onClose={onClose}
            />

            {/* Global settings bar */}
            {hasFiles && (
                <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--separator)] shrink-0">
                    {/* Scale selector */}
                    <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-[var(--text-3)]">{t('upscaler.scaleLabel')}</span>
                        <div className="flex gap-0.5">
                            {SCALE_OPTIONS.map(s => (
                                <button
                                    key={s}
                                    onClick={() => handleGlobalScaleChange(s)}
                                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                                        globalScale === s
                                            ? 'bg-pink-600 text-white'
                                            : 'bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--surface-3)]'
                                    }`}
                                >
                                    {s}x
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="w-px h-4 bg-[var(--border)]" />

                    {/* Model selector */}
                    <div className="flex items-center gap-1.5">
                        <span className="text-[10px] text-[var(--text-3)]">{t('upscaler.modelLabel')}</span>
                        <div className="flex gap-0.5">
                            {MODEL_OPTIONS.map(m => (
                                <button
                                    key={m.value}
                                    onClick={() => handleGlobalModelChange(m.value)}
                                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                                        globalModel === m.value
                                            ? 'bg-pink-600 text-white'
                                            : 'bg-[var(--surface)] text-[var(--text-2)] hover:bg-[var(--surface-3)]'
                                    }`}
                                >
                                    {t(m.labelKey)}
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
                                    : 'border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--border)] hover:bg-[var(--surface)]'
                                }
                            `}
                        >
                            <div className={`p-4 rounded-2xl transition-colors ${isDragOver ? 'bg-pink-500/20' : 'bg-[var(--surface)]'}`}>
                                {isDragOver
                                    ? <Upload className="w-8 h-8 text-pink-400" />
                                    : <Maximize2 className="w-8 h-8 text-[var(--text-3)]" />
                                }
                            </div>
                            <div className="text-center px-4">
                                <p className="text-sm font-semibold text-[var(--text-2)]">
                                    {isDragOver ? t('upscaler.dropImages') : t('upscaler.dragImages')}
                                </p>
                                <p className="text-xs text-[var(--text-3)] mt-1">{t('upscaler.orClickToSelect')}</p>
                                <p className="text-[10px] text-[var(--text-3)] mt-2">
                                    Images: JPG · PNG · WEBP · BMP · TIFF
                                </p>
                                <p className="text-[10px] text-[var(--text-3)] mt-1">
                                    {t('upscaler.aiHint')}
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
                                    className="flex items-center gap-2 px-2.5 py-2 bg-[var(--surface)] rounded-lg border border-[var(--separator)] shrink-0 group"
                                >
                                    {/* Thumbnail — always shows the small ORIGINAL preview */}
                                    <div className="w-8 h-8 rounded overflow-hidden bg-[var(--surface)] shrink-0 flex items-center justify-center">
                                        <img
                                            src={item.previewUrl}
                                            className={`w-full h-full object-cover ${item.status === 'done' ? '' : 'opacity-60'}`}
                                            alt=""
                                        />
                                    </div>

                                    {/* Name + size */}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[11px] text-[var(--text-2)] truncate">{item.name}</p>
                                        <p className="text-[10px] text-[var(--text-3)]">{formatSize(item.sizeBytes)}</p>
                                    </div>

                                    {/* Scale badge */}
                                    <span className="text-[10px] font-medium text-pink-300 bg-pink-500/10 px-1.5 py-0.5 rounded shrink-0">
                                        {item.scale}x
                                    </span>

                                    {/* Status indicator */}
                                    <div className="w-14 text-right shrink-0">
                                        {item.status === 'idle' && (
                                            <span className="text-[10px] text-[var(--text-3)]">—</span>
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
                                        className="shrink-0 text-[var(--text-3)] hover:text-[var(--red)] transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-30"
                                        title={t('upscaler.remove')}
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
                                        : 'border-[var(--border)] hover:border-[var(--border)] bg-[var(--surface-2)]'
                                }`}
                            >
                                <Upload className="w-3.5 h-3.5 text-[var(--text-3)]" />
                                <span className="text-[11px] text-[var(--text-3)]">{t('upscaler.addImages')}</span>
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
                    <span className="text-[11px] text-red-300">{t('upscaler.unavailable')}</span>
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
                            <><Ban className="w-4 h-4" />{t('upscaler.cancel')}</>
                        ) : (
                            <><Loader2 className="w-4 h-4 animate-spin" />{t('upscaler.upscaling')}</>
                        )}
                    </button>
                ) : allCompleted ? (
                    <button
                        onClick={handleDownload}
                        disabled={isDownloading}
                        className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white disabled:opacity-50"
                    >
                        {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        {t('upscaler.download')}
                    </button>
                ) : hasIdle ? (
                    <button
                        onClick={upscaleAll}
                        disabled={available === false}
                        className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all ${
                            available === false
                                ? 'bg-[var(--surface-2)] text-[var(--text-3)] cursor-not-allowed'
                                : 'bg-pink-600 hover:bg-pink-500 text-white'
                        }`}
                    >
                        <Maximize2 className="w-4 h-4" />
                        {t('upscaler.upscale')}
                    </button>
                ) : (
                    <button
                        disabled
                        className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold bg-[var(--surface-2)] text-[var(--text-3)] cursor-not-allowed"
                    >
                        <Maximize2 className="w-4 h-4" />
                        {t('upscaler.defaultBtn')}
                    </button>
                )}

                {/* Right half: Copy | Paste | Clear */}
                <div className="flex-1 flex items-center gap-1">
                    <ToolIconButton onClick={handleCopy} disabled={!files.some(f => f.status === 'done' && f.jobId) || isCopying} title={t('upscaler.copy')}>
                        {isCopying ? <Loader2 className="w-4 h-4 animate-spin" /> : showCopySuccess ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    </ToolIconButton>
                    <ToolIconButton onClick={handlePaste} title={t('upscaler.paste')}>
                        <ClipboardPaste className="w-4 h-4" />
                    </ToolIconButton>
                    <ToolIconButton onClick={handleClear} disabled={!hasFiles || isProcessing} danger title={t('upscaler.clearAll')}>
                        <Trash2 className="w-4 h-4" />
                    </ToolIconButton>
                </div>
            </div>
        </div>
    );
};
