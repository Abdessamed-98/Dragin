
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ShieldAlert, Upload, Loader2, Download, Trash2, AlertCircle,
    X, Check, ClipboardPaste, ChevronDown, ChevronUp, Ban, Copy
} from 'lucide-react';
import { scrubMetadata, getFileThumbnail } from '../../services/api';
import type { ScrubResult } from '../../services/api';
import { saveOutputs } from '../../services/saveOutput';
import { useI18n } from '../../i18n/I18nContext';
import { ToolHeader } from '../ToolHeader';
import { ToolIconButton } from '../ToolIconButton';
import { sessionStore, useSessionIngest } from '../../state/sessionStore';
import { toolAccepts } from '../../state/toolCompat';

interface MetadataToolProps {
    onClose: () => void;
    /** True while this tool is the expanded panel — session ingestion runs only then. */
    active: boolean;
    onItemCountChange?: (count: number) => void;
    clearGen?: number;
}

interface MetaFileItem {
    id: string;
    file: File;
    name: string;
    sizeBytes: number;
    status: 'idle' | 'processing' | 'done' | 'error';
    previewUrl?: string;
    previewNeedsRevoke?: boolean;
    resultUrl?: string;
    resultSize?: number;
    removedFields?: Record<string, string>;
    error?: string;
    showDetails?: boolean;
}

const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
};

const ACCEPTED_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'gif', 'pdf']);

const isAccepted = (file: File): boolean => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    return ACCEPTED_EXTS.has(ext) || file.type.startsWith('image/');
};

export const MetadataTool: React.FC<MetadataToolProps> = ({ onClose, active, onItemCountChange, clearGen = 0 }) => {
    const { t } = useI18n();
    const [files, setFiles] = useState<MetaFileItem[]>([]);
    const [isDragOver, setIsDragOver] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [cancelHover, setCancelHover] = useState(false);
    const [isCopying, setIsCopying] = useState(false);
    const [showCopySuccess, setShowCopySuccess] = useState(false);

    // Report item count to parent
    useEffect(() => { onItemCountChange?.(files.length); }, [files.length, onItemCountChange]);

    // Clear all files when global clear is triggered
    const lastClearGen = useRef(clearGen);
    useEffect(() => {
        if (clearGen === 0 || clearGen === lastClearGen.current) return;
        lastClearGen.current = clearGen;
        setFiles(prev => {
            prev.forEach(f => { if (f.previewUrl && f.previewNeedsRevoke) URL.revokeObjectURL(f.previewUrl); });
            return [];
        });
    }, [clearGen]);

    // Cleanup on unmount
    const filesRef = useRef<MetaFileItem[]>([]);
    useEffect(() => { filesRef.current = files; }, [files]);
    useEffect(() => {
        return () => {
            filesRef.current.forEach(f => {
                if (f.previewUrl && f.previewNeedsRevoke) URL.revokeObjectURL(f.previewUrl);
            });
        };
    }, []);

    const updateFile = (fileId: string, updates: Partial<MetaFileItem>) => {
        setFiles(prev => prev.map(f => f.id === fileId ? { ...f, ...updates } : f));
    };

    const processSingle = useCallback(async (item: MetaFileItem) => {
        updateFile(item.id, { status: 'processing', error: undefined });
        try {
            const result: ScrubResult = await scrubMetadata(item.file);
            updateFile(item.id, {
                status: 'done',
                resultUrl: result.url,
                resultSize: result.newSize,
                removedFields: result.removedFields,
            });
            // Session write-back: the scrubbed file becomes the file's current
            // state, so switching tools carries the RESULT forward.
            const ext = item.name.split('.').pop() || 'bin';
            const base = item.name.replace(/\.[^.]+$/, '');
            sessionStore.applyResult(item.id, result.url, `${base}_clean.${ext}`, 'metadata');
        } catch (err) {
            updateFile(item.id, { status: 'error', error: String(err) });
        }
    }, []);

    // Ingest session files (keyed by session id) — replaces same-id items on re-ingest.
    // Direct drops auto-scrub; carried items (rail switch) wait for the Scrub button.
    const ingestBatch = useCallback(async (batch: { id: string; file: File; direct: boolean }[]) => {
        const items: MetaFileItem[] = [];
        const directIds = new Set(batch.filter(b => b.direct).map(b => b.id));
        for (const { id, file } of batch) {
            let previewUrl: string | undefined;
            let previewNeedsRevoke = false;
            try {
                const result = await getFileThumbnail(file, 64);
                if (result) { previewUrl = result.url; previewNeedsRevoke = result.needsRevoke; }
            } catch { /* proceed without preview */ }
            items.push({
                id, file, name: file.name, sizeBytes: file.size,
                status: 'idle', previewUrl, previewNeedsRevoke,
            });
        }
        if (!items.length) return;
        setFiles(prev => {
            const kept = prev.filter(p => !items.some(n => n.id === p.id));
            prev.filter(p => items.some(n => n.id === p.id)).forEach(p => { if (p.previewUrl && p.previewNeedsRevoke) URL.revokeObjectURL(p.previewUrl); });
            return [...kept, ...items];
        });
        items.filter(it => directIds.has(it.id)).forEach(it => processSingle(it));
    }, [processSingle]);

    // Manual run for carried (idle) items.
    const processIdle = useCallback(() => {
        files.filter(f => f.status === 'idle').forEach(f => processSingle(f));
    }, [files, processSingle]);

    const removeLocal = useCallback((ids: string[]) => {
        setFiles(prev => {
            prev.filter(p => ids.includes(p.id)).forEach(p => { if (p.previewUrl && p.previewNeedsRevoke) URL.revokeObjectURL(p.previewUrl); });
            return prev.filter(p => !ids.includes(p.id));
        });
    }, []);

    useSessionIngest(active, 'metadata', f => (toolAccepts('metadata', f) || f.kind === 'pdf') && isAccepted(f.currentFile), ingestBatch, removeLocal);

    // UI adds (drop on panel / file input / paste) go through the session store —
    // the ingest above brings them into local state.
    const addFiles = useCallback((incoming: File[]) => {
        const accepted = incoming.filter(isAccepted);
        if (accepted.length) sessionStore.addFiles(accepted, 'metadata');
    }, []);

    const removeFile = (fileId: string) => {
        sessionStore.remove([fileId]);
    };

    const handleDownload = useCallback(async () => {
        const done = files.filter(f => f.status === 'done' && f.resultUrl);
        if (done.length === 0) return;
        setIsDownloading(true);
        try {
            await saveOutputs(done.map(item => {
                const ext = item.name.split('.').pop() || 'bin';
                const base = item.name.replace(/\.[^.]+$/, '');
                return {
                    name: `${base}_clean.${ext}`,
                    url: item.resultUrl!,
                    originalPath: ((item as any).file)?.path ?? null,
                };
            }), 'cleaned');
        } catch (e) {
            console.error('Save failed', e);
        } finally {
            setIsDownloading(false);
        }
    }, [files]);

    const handleClear = () => {
        sessionStore.remove(files.map(f => f.id));
        onClose();
    };

    const cancelAll = () => {
        setFiles(prev => prev.map(f => f.status === 'processing' ? { ...f, status: 'idle' as const } : f));
        setCancelHover(false);
    };

    const handleCopy = async () => {
        const completed = files.filter(f => f.status === 'done' && f.resultUrl);
        if (completed.length === 0 || isCopying) return;
        setIsCopying(true);
        try {
            const clipItems = await Promise.all(completed.map(async (item) => {
                const res = await fetch(item.resultUrl!);
                const blob = await res.blob();
                const dataUrl = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
                return { dataUrl, name: item.name };
            }));
            if ((window as any).electron?.clipboardWrite) await (window as any).electron.clipboardWrite(clipItems);
            setShowCopySuccess(true);
            setTimeout(() => setShowCopySuccess(false), 1500);
        } catch (err) { console.error('Copy failed:', err); }
        finally { setIsCopying(false); }
    };

    const handlePaste = async () => {
        try {
            const items = await navigator.clipboard.read();
            const pastedFiles: File[] = [];
            for (const item of items) {
                for (const type of item.types) {
                    if (type.startsWith('image/')) {
                        const blob = await item.getType(type);
                        const ext = type.split('/')[1] || 'png';
                        pastedFiles.push(new File([blob], `pasted.${ext}`, { type }));
                    }
                }
            }
            if (pastedFiles.length > 0) addFiles(pastedFiles);
        } catch { /* clipboard not available */ }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        const f = Array.from(e.dataTransfer.files);
        if (f.length > 0) addFiles(f);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
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
    const isProcessing = files.some(f => f.status === 'processing');
    const allDone = files.length > 0 && files.every(f => f.status === 'done');
    const totalRemoved = files.filter(f => f.status === 'done').reduce((sum, f) => sum + Object.keys(f.removedFields || {}).length, 0);

    return (
        <div
            className="absolute inset-0 flex flex-col rounded-2xl overflow-hidden"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
        >
            {/* Header */}
            <ToolHeader icon={<ShieldAlert className="w-4 h-4 text-red-400" />} title={t('metadata.headerTitle')} count={files.length} onClose={onClose} />

            {/* Body */}
            <div className="flex-1 flex flex-col min-h-0 p-3 gap-2">
                <AnimatePresence mode="wait">
                    {/* Empty state */}
                    {!hasFiles && (
                        <motion.label
                            key="empty"
                            htmlFor="metadata-file-input"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className={`
                                flex-1 flex flex-col items-center justify-center gap-4 rounded-xl
                                border-2 border-dashed transition-all duration-200 cursor-pointer
                                ${isDragOver
                                    ? 'border-red-400 bg-red-500/10 scale-[0.99]'
                                    : 'border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--border)] hover:bg-[var(--surface)]'
                                }
                            `}
                        >
                            <div className={`p-4 rounded-2xl transition-colors ${isDragOver ? 'bg-red-500/20' : 'bg-[var(--surface)]'}`}>
                                {isDragOver
                                    ? <Upload className="w-8 h-8 text-red-400" />
                                    : <ShieldAlert className="w-8 h-8 text-[var(--text-3)]" />
                                }
                            </div>
                            <div className="text-center px-4">
                                <p className="text-sm font-semibold text-[var(--text-2)]">
                                    {isDragOver ? t('metadata.dropFiles') : t('metadata.dragFiles')}
                                </p>
                                <p className="text-xs text-[var(--text-3)] mt-1">{t('metadata.subHint')}</p>
                                <p className="text-[10px] text-[var(--text-3)] mt-2">
                                    {t('metadata.formatImages')}
                                </p>
                                <p className="text-[10px] text-[var(--text-3)]">
                                    {t('metadata.formatDocs')}
                                </p>
                            </div>
                            <input
                                id="metadata-file-input"
                                type="file"
                                accept="image/*,.pdf"
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
                                <div key={item.id} className="shrink-0">
                                    <div className="flex items-center gap-2 px-2.5 py-2 bg-[var(--surface)] rounded-lg border border-[var(--separator)] group">
                                        {/* Thumbnail */}
                                        {item.previewUrl ? (
                                            <div className="w-8 h-8 rounded overflow-hidden bg-[var(--surface)] shrink-0">
                                                <img src={item.previewUrl} className="w-full h-full object-cover" alt="" />
                                            </div>
                                        ) : (
                                            <ShieldAlert className="w-3.5 h-3.5 text-red-400 shrink-0" />
                                        )}

                                        {/* Name + size */}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[11px] text-[var(--text-2)] truncate">{item.name}</p>
                                            <p className="text-[10px] text-[var(--text-3)]">{formatSize(item.sizeBytes)}</p>
                                        </div>

                                        {/* Status */}
                                        <div className="w-16 text-right shrink-0">
                                            {item.status === 'idle' && (
                                                <span className="text-[10px] text-[var(--text-3)]">—</span>
                                            )}
                                            {item.status === 'processing' && (
                                                <Loader2 className="w-3.5 h-3.5 text-red-400 animate-spin inline-block" />
                                            )}
                                            {item.status === 'done' && (
                                                <button
                                                    onClick={() => updateFile(item.id, { showDetails: !item.showDetails })}
                                                    className="flex items-center gap-0.5 text-green-400 hover:text-green-300 transition-colors"
                                                >
                                                    <Check className="w-3 h-3" />
                                                    <span className="text-[10px]">{Object.keys(item.removedFields || {}).length} {t('metadata.field')}</span>
                                                    {item.showDetails ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                                                </button>
                                            )}
                                            {item.status === 'error' && (
                                                <AlertCircle className="w-3.5 h-3.5 text-red-400 inline-block" />
                                            )}
                                        </div>

                                        {/* Remove */}
                                        <button
                                            onClick={() => removeFile(item.id)}
                                            disabled={item.status === 'processing'}
                                            className="shrink-0 text-[var(--text-3)] hover:text-[var(--red)] transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-30"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    </div>

                                    {/* Expanded metadata details */}
                                    {item.showDetails && item.removedFields && Object.keys(item.removedFields).length > 0 && (
                                        <div className="mx-2 mt-1 mb-1 p-2 bg-[var(--surface)] rounded-md border border-[var(--separator)]">
                                            <div className="space-y-0.5 max-h-24 overflow-y-auto">
                                                {Object.entries(item.removedFields).map(([key, value]) => (
                                                    <div key={key} className="flex items-start gap-2 text-[10px]">
                                                        <span className="text-red-400/70 shrink-0">{key}</span>
                                                        <span className="text-[var(--text-3)] truncate">{value}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}

                            {/* Add more */}
                            <label
                                htmlFor="metadata-add-input"
                                className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed cursor-pointer transition-colors shrink-0 ${
                                    isDragOver
                                        ? 'border-red-400 bg-red-500/10'
                                        : 'border-[var(--border)] hover:border-[var(--border)] bg-[var(--surface-2)]'
                                }`}
                            >
                                <Upload className="w-3.5 h-3.5 text-[var(--text-3)]" />
                                <span className="text-[11px] text-[var(--text-3)]">{t('metadata.addFiles')}</span>
                                <input
                                    id="metadata-add-input"
                                    type="file"
                                    accept="image/*,.pdf"
                                    multiple
                                    className="sr-only"
                                    onChange={handleFileInput}
                                />
                            </label>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Footer */}
            <div className="flex items-center gap-1.5 px-3 pb-3 shrink-0">
                {isProcessing ? (
                    <button
                        onMouseEnter={() => setCancelHover(true)}
                        onMouseLeave={() => setCancelHover(false)}
                        onClick={cancelHover ? cancelAll : undefined}
                        className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all ${
                            cancelHover
                                ? 'bg-red-600 hover:bg-red-500 text-white cursor-pointer'
                                : 'bg-red-600/50 text-white/60'
                        }`}
                    >
                        {cancelHover ? (
                            <><Ban className="w-4 h-4" />{t('metadata.cancel')}</>
                        ) : (
                            <><Loader2 className="w-4 h-4 animate-spin" />{t('metadata.processing')}</>
                        )}
                    </button>
                ) : allDone ? (
                    <button
                        onClick={handleDownload}
                        disabled={isDownloading}
                        className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white disabled:opacity-50"
                    >
                        {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        {totalRemoved > 0 ? t('metadata.downloadWithCount', { count: totalRemoved }) : t('metadata.download')}
                    </button>
                ) : files.some(f => f.status === 'idle') ? (
                    <button
                        onClick={processIdle}
                        className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all bg-red-600 hover:bg-red-500 text-white"
                    >
                        <ShieldAlert className="w-4 h-4" />
                        {t('metadata.defaultBtn')}
                    </button>
                ) : (
                    <button
                        disabled
                        className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold bg-[var(--surface-2)] text-[var(--text-3)] cursor-not-allowed"
                    >
                        <ShieldAlert className="w-4 h-4" />
                        {t('metadata.defaultBtn')}
                    </button>
                )}

                <div className="flex-1 flex items-center gap-1">
                    <ToolIconButton
                        onClick={handleCopy}
                        disabled={!files.some(f => f.status === 'done' && f.resultUrl) || isCopying}
                        title={t('metadata.copy')}
                    >
                        {isCopying ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : showCopySuccess ? (
                            <Check className="w-4 h-4 text-green-400" />
                        ) : (
                            <Copy className="w-4 h-4" />
                        )}
                    </ToolIconButton>
                    <ToolIconButton
                        onClick={handlePaste}
                        title={t('metadata.paste')}
                    >
                        <ClipboardPaste className="w-4 h-4" />
                    </ToolIconButton>
                    <ToolIconButton
                        onClick={handleClear}
                        disabled={!hasFiles || isProcessing}
                        danger
                        title={t('metadata.clearAll')}
                    >
                        <Trash2 className="w-4 h-4" />
                    </ToolIconButton>
                </div>
            </div>
        </div>
    );
};
