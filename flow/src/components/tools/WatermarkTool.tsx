
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Copyright, Upload, Loader2, Download, Trash2, AlertCircle,
    X, Check, ClipboardPaste, Type, Droplets, Maximize2, CornerRightDown,
    Ban, Copy
} from 'lucide-react';
import { addWatermark, getFileThumbnail } from '../../services/api';
import type { WatermarkOptions } from '../../services/api';
import { saveOutputs } from '../../services/saveOutput';
import { useI18n } from '../../i18n/I18nContext';
import { ToolHeader } from '../ToolHeader';
import { ToolIconButton } from '../ToolIconButton';

interface WatermarkToolProps {
    onClose: () => void;
    droppedFiles: File[];
    dropGeneration: number;
    onItemCountChange?: (count: number) => void;
    clearGen?: number;
}

interface WatermarkFileItem {
    id: string;
    file: File;
    name: string;
    sizeBytes: number;
    status: 'idle' | 'processing' | 'done' | 'error';
    previewUrl?: string;
    previewNeedsRevoke?: boolean;
    resultUrl?: string;
    resultSize?: number;
    error?: string;
}

const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
};

const genId = () => Math.random().toString(36).substring(2, 11);

const ACCEPTED_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'gif', 'pdf']);

const isAccepted = (file: File): boolean => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    return ACCEPTED_EXTS.has(ext) || file.type.startsWith('image/');
};

type WatermarkStyle = 'diagonal' | 'center' | 'corner';

const STYLE_OPTIONS: { id: WatermarkStyle; labelKey: 'watermark.styleDiagonal' | 'watermark.styleCenter' | 'watermark.styleCorner'; Icon: React.FC<{ className?: string }> }[] = [
    { id: 'diagonal', labelKey: 'watermark.styleDiagonal', Icon: Maximize2 },
    { id: 'center', labelKey: 'watermark.styleCenter', Icon: Type },
    { id: 'corner', labelKey: 'watermark.styleCorner', Icon: CornerRightDown },
];

export const WatermarkTool: React.FC<WatermarkToolProps> = ({ onClose, droppedFiles, dropGeneration, onItemCountChange, clearGen = 0 }) => {
    const { t } = useI18n();
    const [files, setFiles] = useState<WatermarkFileItem[]>([]);
    const [isDragOver, setIsDragOver] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [cancelHover, setCancelHover] = useState(false);
    const [isCopying, setIsCopying] = useState(false);
    const [showCopySuccess, setShowCopySuccess] = useState(false);

    // Watermark settings
    const [text, setText] = useState('');
    const [opacity, setOpacity] = useState(30);
    const [fontSize, setFontSize] = useState(36);
    const [style, setStyle] = useState<WatermarkStyle>('diagonal');
    const [color, setColor] = useState('#888888');

    // Report item count
    useEffect(() => { onItemCountChange?.(files.length); }, [files.length, onItemCountChange]);

    // Handle files dropped from DockApp
    const lastDropGen = useRef(dropGeneration);
    useEffect(() => {
        if (dropGeneration === 0) return;
        if (dropGeneration === lastDropGen.current) return;
        lastDropGen.current = dropGeneration;
        if (droppedFiles.length === 0) return;
        addFiles(droppedFiles);
    }, [dropGeneration]); // eslint-disable-line react-hooks/exhaustive-deps

    // Clear on global clear
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
    const filesRef = useRef<WatermarkFileItem[]>([]);
    useEffect(() => { filesRef.current = files; }, [files]);
    useEffect(() => {
        return () => {
            filesRef.current.forEach(f => {
                if (f.previewUrl && f.previewNeedsRevoke) URL.revokeObjectURL(f.previewUrl);
            });
        };
    }, []);

    const addFiles = useCallback(async (newFiles: File[]) => {
        const items: WatermarkFileItem[] = [];
        for (const file of newFiles) {
            if (!isAccepted(file)) continue;
            let previewUrl: string | undefined;
            let previewNeedsRevoke = false;
            try {
                const result = await getFileThumbnail(file, 64);
                if (result) { previewUrl = result.url; previewNeedsRevoke = result.needsRevoke; }
            } catch { /* proceed without preview */ }
            items.push({
                id: genId(), file, name: file.name, sizeBytes: file.size,
                status: 'idle', previewUrl, previewNeedsRevoke,
            });
        }
        if (items.length > 0) setFiles(prev => [...prev, ...items]);
    }, []);

    const removeFile = (fileId: string) => {
        setFiles(prev => {
            const removed = prev.find(f => f.id === fileId);
            if (removed?.previewUrl && removed.previewNeedsRevoke) URL.revokeObjectURL(removed.previewUrl);
            return prev.filter(f => f.id !== fileId);
        });
    };

    const updateFile = (fileId: string, updates: Partial<WatermarkFileItem>) => {
        setFiles(prev => prev.map(f => f.id === fileId ? { ...f, ...updates } : f));
    };

    const processSingle = useCallback(async (item: WatermarkFileItem, options: WatermarkOptions) => {
        updateFile(item.id, { status: 'processing', error: undefined });
        try {
            const result = await addWatermark(item.file, options);
            updateFile(item.id, { status: 'done', resultUrl: result.url, resultSize: result.size });
        } catch (err) {
            updateFile(item.id, { status: 'error', error: String(err) });
        }
    }, []);

    const processAll = useCallback(() => {
        if (!text.trim()) return;
        const options: WatermarkOptions = { text: text.trim(), opacity, fontSize, style, color };
        // Only process idle/error files — leave completed ones untouched
        const toProcess = files.filter(f => f.status === 'idle' || f.status === 'error');
        toProcess.forEach(f => processSingle(f, options));
    }, [text, opacity, fontSize, style, color, files, processSingle]);

    const handleDownload = useCallback(async () => {
        const done = files.filter(f => f.status === 'done' && f.resultUrl);
        if (done.length === 0) return;
        setIsDownloading(true);
        try {
            await saveOutputs(done.map(item => ({
                name: `${item.name.replace(/\.[^.]+$/, '')}_watermarked.png`,
                url: item.resultUrl!,
                originalPath: ((item as any).file)?.path ?? null,
            })), 'watermarked');
        } catch (e) {
            console.error('Save failed', e);
        } finally {
            setIsDownloading(false);
        }
    }, [files]);

    const handleClear = () => {
        files.forEach(f => { if (f.previewUrl && f.previewNeedsRevoke) URL.revokeObjectURL(f.previewUrl); });
        setFiles([]);
        onClose();
    };

    const cancelAll = () => {
        setFiles(prev => prev.map(f =>
            f.status === 'processing' ? { ...f, status: 'idle' as const, error: undefined } : f
        ));
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
                const base = item.name.replace(/\.[^.]+$/, '');
                return { dataUrl, name: `${base}_watermarked.png` };
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
    const canProcess = hasFiles && text.trim().length > 0 && !isProcessing;

    return (
        <div
            className="absolute inset-0 flex flex-col rounded-2xl overflow-hidden"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
        >
            {/* Header */}
            <ToolHeader icon={<Copyright className="w-4 h-4 text-cyan-400" />} title={t('watermark.title')} count={files.length} onClose={onClose} />

            {/* Body */}
            <div className="flex-1 flex flex-col min-h-0 p-3 gap-2">
                {/* Settings panel — always visible when there are files */}
                {hasFiles && (
                    <div className="shrink-0 space-y-2 p-2.5 bg-[var(--surface)] rounded-xl border border-[var(--separator)]">
                        {/* Text input */}
                        <input
                            type="text"
                            value={text}
                            onChange={e => setText(e.target.value)}
                            placeholder={t('watermark.textPlaceholder')}
                            className="w-full bg-[var(--surface-2)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus:outline-none focus:border-cyan-500/50"
                            dir="auto"
                        />

                        {/* Style selector */}
                        <div className="flex gap-1.5">
                            {STYLE_OPTIONS.map(s => (
                                <button
                                    key={s.id}
                                    onClick={() => setStyle(s.id)}
                                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                                        style === s.id
                                            ? 'bg-cyan-600/30 border border-cyan-500/50 text-cyan-300'
                                            : 'bg-[var(--surface-3)] border border-[var(--separator)] text-[var(--text-2)] hover:text-[var(--text)]'
                                    }`}
                                >
                                    <s.Icon className="w-3 h-3" />
                                    {t(s.labelKey)}
                                </button>
                            ))}
                        </div>

                        {/* Opacity + font size + color */}
                        <div className="flex items-center gap-2">
                            <div className="flex-1 flex items-center gap-1.5">
                                <Droplets className="w-3 h-3 text-[var(--text-3)] shrink-0" />
                                <input
                                    type="range"
                                    min={5}
                                    max={80}
                                    value={opacity}
                                    onChange={e => setOpacity(Number(e.target.value))}
                                    className="flex-1 h-1 accent-cyan-500"
                                />
                                <span className="text-[10px] text-[var(--text-3)] w-7 text-left">{opacity}%</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <Type className="w-3 h-3 text-[var(--text-3)] shrink-0" />
                                <select
                                    value={fontSize}
                                    onChange={e => setFontSize(Number(e.target.value))}
                                    className="bg-[var(--surface-3)] border border-[var(--border)] rounded text-[10px] text-[var(--text-2)] px-1.5 py-0.5 focus:outline-none"
                                >
                                    {[16, 24, 36, 48, 64, 80].map(s => (
                                        <option key={s} value={s}>{s}px</option>
                                    ))}
                                </select>
                            </div>
                            <input
                                type="color"
                                value={color}
                                onChange={e => setColor(e.target.value)}
                                className="w-6 h-6 rounded border border-[var(--border)] cursor-pointer bg-transparent"
                                title={t('watermark.colorLabel')}
                            />
                        </div>
                    </div>
                )}

                <AnimatePresence mode="wait">
                    {/* Empty state */}
                    {!hasFiles && (
                        <motion.label
                            key="empty"
                            htmlFor="watermark-file-input"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className={`
                                flex-1 flex flex-col items-center justify-center gap-4 rounded-xl
                                border-2 border-dashed transition-all duration-200 cursor-pointer
                                ${isDragOver
                                    ? 'border-cyan-400 bg-cyan-500/10 scale-[0.99]'
                                    : 'border-[var(--border)] bg-[var(--surface-2)] hover:border-[var(--border)] hover:bg-[var(--surface)]'
                                }
                            `}
                        >
                            <div className={`p-4 rounded-2xl transition-colors ${isDragOver ? 'bg-cyan-500/20' : 'bg-[var(--surface)]'}`}>
                                {isDragOver
                                    ? <Upload className="w-8 h-8 text-cyan-400" />
                                    : <Copyright className="w-8 h-8 text-[var(--text-3)]" />
                                }
                            </div>
                            <div className="text-center px-4">
                                <p className="text-sm font-semibold text-[var(--text-2)]">
                                    {isDragOver ? t('watermark.dropFiles') : t('watermark.dragFiles')}
                                </p>
                                <p className="text-xs text-[var(--text-3)] mt-1">{t('watermark.subHint')}</p>
                                <p className="text-[10px] text-[var(--text-3)] mt-2">
                                    {t('watermark.formatImages')}
                                </p>
                                <p className="text-[10px] text-[var(--text-3)]">
                                    {t('watermark.formatDocs')}
                                </p>
                            </div>
                            <input
                                id="watermark-file-input"
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
                                <div
                                    key={item.id}
                                    className="flex items-center gap-2 px-2.5 py-2 bg-[var(--surface)] rounded-lg border border-[var(--separator)] shrink-0 group"
                                >
                                    {/* Thumbnail */}
                                    {item.previewUrl ? (
                                        <div className="w-8 h-8 rounded overflow-hidden bg-[var(--surface)] shrink-0">
                                            <img src={item.previewUrl} className="w-full h-full object-cover" alt="" />
                                        </div>
                                    ) : (
                                        <Copyright className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                                    )}

                                    {/* Name + size */}
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[11px] text-[var(--text-2)] truncate">{item.name}</p>
                                        <p className="text-[10px] text-[var(--text-3)]">{formatSize(item.sizeBytes)}</p>
                                    </div>

                                    {/* Status */}
                                    <div className="w-14 text-right shrink-0">
                                        {item.status === 'idle' && (
                                            <span className="text-[10px] text-[var(--text-3)]">—</span>
                                        )}
                                        {item.status === 'processing' && (
                                            <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin inline-block" />
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
                            ))}

                            {/* Add more */}
                            <label
                                htmlFor="watermark-add-input"
                                className={`flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed cursor-pointer transition-colors shrink-0 ${
                                    isDragOver
                                        ? 'border-cyan-400 bg-cyan-500/10'
                                        : 'border-[var(--border)] hover:border-[var(--border)] bg-[var(--surface-2)]'
                                }`}
                            >
                                <Upload className="w-3.5 h-3.5 text-[var(--text-3)]" />
                                <span className="text-[11px] text-[var(--text-3)]">{t('watermark.addFiles')}</span>
                                <input
                                    id="watermark-add-input"
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
                                : 'bg-cyan-600/50 text-white/60'
                        }`}
                    >
                        {cancelHover ? <><Ban className="w-4 h-4" />{t('watermark.cancel')}</> : <><Loader2 className="w-4 h-4 animate-spin" />{t('watermark.processing')}</>}
                    </button>
                ) : allDone ? (
                    <button
                        onClick={handleDownload}
                        disabled={isDownloading}
                        className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white disabled:opacity-50"
                    >
                        {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        {t('watermark.download')}
                    </button>
                ) : canProcess ? (
                    <button
                        onClick={processAll}
                        className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all bg-cyan-600 hover:bg-cyan-500 text-white"
                    >
                        <Copyright className="w-4 h-4" />
                        {t('watermark.apply')}
                    </button>
                ) : (
                    <button
                        disabled
                        className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold bg-[var(--surface-2)] text-[var(--text-3)] cursor-not-allowed"
                    >
                        <Copyright className="w-4 h-4" />
                        {hasFiles && !text.trim() ? t('watermark.enterTextFirst') : t('watermark.apply')}
                    </button>
                )}

                <div className="flex-1 flex items-center gap-1">
                    <ToolIconButton
                        onClick={handleCopy}
                        disabled={isCopying || !files.some(f => f.status === 'done')}
                        title={t('watermark.copy')}
                    >
                        {isCopying ? <Loader2 className="w-4 h-4 animate-spin" /> : showCopySuccess ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    </ToolIconButton>
                    <ToolIconButton
                        onClick={handlePaste}
                        title={t('watermark.paste')}
                    >
                        <ClipboardPaste className="w-4 h-4" />
                    </ToolIconButton>
                    <ToolIconButton
                        onClick={handleClear}
                        disabled={!hasFiles || isProcessing}
                        danger
                        title={t('watermark.clearAll')}
                    >
                        <Trash2 className="w-4 h-4" />
                    </ToolIconButton>
                </div>
            </div>
        </div>
    );
};
