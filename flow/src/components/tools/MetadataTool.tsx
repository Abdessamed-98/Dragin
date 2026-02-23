
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    ShieldAlert, Upload, Loader2, Download, Trash2, AlertCircle,
    X, Check, ClipboardPaste, ChevronDown, ChevronUp
} from 'lucide-react';
import { scrubMetadata, getFileThumbnail } from '../../services/api';
import type { ScrubResult } from '../../services/api';
import JSZip from 'jszip';

interface MetadataToolProps {
    onClose: () => void;
    droppedFiles: File[];
    dropGeneration: number;
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

const genId = () => Math.random().toString(36).substring(2, 11);

const ACCEPTED_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'gif', 'pdf']);

const isAccepted = (file: File): boolean => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    return ACCEPTED_EXTS.has(ext) || file.type.startsWith('image/');
};

export const MetadataTool: React.FC<MetadataToolProps> = ({ onClose, droppedFiles, dropGeneration, onItemCountChange, clearGen = 0 }) => {
    const [files, setFiles] = useState<MetaFileItem[]>([]);
    const [isDragOver, setIsDragOver] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);

    // Report item count to parent
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

    const addFiles = useCallback(async (newFiles: File[]) => {
        const items: MetaFileItem[] = [];
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
        } catch (err) {
            updateFile(item.id, { status: 'error', error: String(err) });
        }
    }, []);

    // Auto-process files when added
    useEffect(() => {
        const idle = files.filter(f => f.status === 'idle');
        if (idle.length > 0) {
            idle.forEach(f => processSingle(f));
        }
    }, [files.length]); // eslint-disable-line react-hooks/exhaustive-deps

    const handleDownload = useCallback(async () => {
        const done = files.filter(f => f.status === 'done' && f.resultUrl);
        if (done.length === 0) return;
        setIsDownloading(true);
        try {
            if (done.length === 1) {
                const item = done[0];
                const a = document.createElement('a');
                a.href = item.resultUrl!;
                const ext = item.name.split('.').pop() || 'bin';
                const base = item.name.replace(/\.[^.]+$/, '');
                a.download = `${base}_clean.${ext}`;
                a.click();
            } else {
                const zip = new JSZip();
                for (const item of done) {
                    const res = await fetch(item.resultUrl!);
                    const blob = await res.blob();
                    const ext = item.name.split('.').pop() || 'bin';
                    const base = item.name.replace(/\.[^.]+$/, '');
                    zip.file(`${base}_clean.${ext}`, blob);
                }
                const content = await zip.generateAsync({ type: 'blob' });
                const url = URL.createObjectURL(content);
                const a = document.createElement('a');
                a.href = url;
                a.download = 'cleaned_files.zip';
                a.click();
                URL.revokeObjectURL(url);
            }
        } finally {
            setIsDownloading(false);
        }
    }, [files]);

    const handleClear = () => {
        files.forEach(f => { if (f.previewUrl && f.previewNeedsRevoke) URL.revokeObjectURL(f.previewUrl); });
        setFiles([]);
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
            <div className="flex items-center px-4 py-3 border-b border-white/5 shrink-0">
                <div className="flex items-center gap-2">
                    <ShieldAlert className="w-4 h-4 text-red-400" />
                    <span className="text-sm font-bold text-white">حذف البيانات</span>
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
                            htmlFor="metadata-file-input"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className={`
                                flex-1 flex flex-col items-center justify-center gap-4 rounded-xl
                                border-2 border-dashed transition-all duration-200 cursor-pointer
                                ${isDragOver
                                    ? 'border-red-400 bg-red-500/10 scale-[0.99]'
                                    : 'border-slate-700 bg-slate-800/30 hover:border-slate-500 hover:bg-slate-800/50'
                                }
                            `}
                        >
                            <div className={`p-4 rounded-2xl transition-colors ${isDragOver ? 'bg-red-500/20' : 'bg-slate-800'}`}>
                                {isDragOver
                                    ? <Upload className="w-8 h-8 text-red-400" />
                                    : <ShieldAlert className="w-8 h-8 text-slate-500" />
                                }
                            </div>
                            <div className="text-center px-4">
                                <p className="text-sm font-semibold text-slate-300">
                                    {isDragOver ? 'أفلت الملفات هنا' : 'اسحب ملفات هنا لحذف البيانات'}
                                </p>
                                <p className="text-xs text-slate-500 mt-1">إزالة EXIF والموقع ومعلومات الكاميرا</p>
                                <p className="text-[10px] text-slate-600 mt-2">
                                    صور: JPG · PNG · WEBP · BMP · TIFF · GIF
                                </p>
                                <p className="text-[10px] text-slate-600">
                                    مستندات: PDF
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
                                    <div className="flex items-center gap-2 px-2.5 py-2 bg-slate-800/60 rounded-lg border border-white/5 group">
                                        {/* Thumbnail */}
                                        {item.previewUrl ? (
                                            <div className="w-8 h-8 rounded overflow-hidden bg-slate-900 shrink-0">
                                                <img src={item.previewUrl} className="w-full h-full object-cover" alt="" />
                                            </div>
                                        ) : (
                                            <ShieldAlert className="w-3.5 h-3.5 text-red-400 shrink-0" />
                                        )}

                                        {/* Name + size */}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[11px] text-slate-300 truncate">{item.name}</p>
                                            <p className="text-[10px] text-slate-600">{formatSize(item.sizeBytes)}</p>
                                        </div>

                                        {/* Status */}
                                        <div className="w-16 text-right shrink-0">
                                            {item.status === 'idle' && (
                                                <span className="text-[10px] text-slate-600">—</span>
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
                                                    <span className="text-[10px]">{Object.keys(item.removedFields || {}).length} حقل</span>
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
                                            className="shrink-0 text-slate-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-30"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    </div>

                                    {/* Expanded metadata details */}
                                    {item.showDetails && item.removedFields && Object.keys(item.removedFields).length > 0 && (
                                        <div className="mx-2 mt-1 mb-1 p-2 bg-slate-900/60 rounded-md border border-white/5">
                                            <div className="space-y-0.5 max-h-24 overflow-y-auto">
                                                {Object.entries(item.removedFields).map(([key, value]) => (
                                                    <div key={key} className="flex items-start gap-2 text-[10px]">
                                                        <span className="text-red-400/70 shrink-0">{key}</span>
                                                        <span className="text-slate-500 truncate">{value}</span>
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
                                        : 'border-slate-700 hover:border-slate-500 bg-slate-800/20'
                                }`}
                            >
                                <Upload className="w-3.5 h-3.5 text-slate-500" />
                                <span className="text-[11px] text-slate-500">إضافة ملفات</span>
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
                        disabled
                        className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold bg-red-600/50 text-white/60 cursor-not-allowed"
                    >
                        <Loader2 className="w-4 h-4 animate-spin" />
                        جاري المعالجة...
                    </button>
                ) : allDone ? (
                    <button
                        onClick={handleDownload}
                        disabled={isDownloading}
                        className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
                    >
                        {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        {totalRemoved > 0 ? `تحميل (${totalRemoved} حقل محذوف)` : 'تحميل'}
                    </button>
                ) : (
                    <button
                        disabled
                        className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold bg-slate-800/50 text-slate-600 cursor-not-allowed"
                    >
                        <ShieldAlert className="w-4 h-4" />
                        حذف البيانات
                    </button>
                )}

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
