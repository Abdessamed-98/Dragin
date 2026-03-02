
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ScanText, FileText, Upload, Loader2, Download, Trash2, AlertCircle, File as FileIcon, Copy, Check, X, Ban, ClipboardPaste } from 'lucide-react';
import { extractText } from '../../services/api';

type OcrState = 'idle' | 'processing' | 'done' | 'error';

interface OcrToolProps {
    onClose: () => void;
    droppedFiles?: File[];
    dropGeneration?: number;
}

export const OcrTool: React.FC<OcrToolProps> = ({ onClose, droppedFiles = [], dropGeneration = 0 }) => {
    const [state, setState] = useState<OcrState>('idle');
    const [extractedText, setExtractedText] = useState('');
    const [pages, setPages] = useState(1);
    const [fileName, setFileName] = useState('');
    const [errorMsg, setErrorMsg] = useState('');
    const [isDragOver, setIsDragOver] = useState(false);
    const [copied, setCopied] = useState(false);
    const [cancelHover, setCancelHover] = useState(false);
    const lastDropGen = useRef(0);

    const processFile = useCallback(async (file: File) => {
        const isImage = file.type.startsWith('image/');
        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        if (!isImage && !isPdf) {
            setErrorMsg('الملفات المدعومة: صور (JPG, PNG, WEBP…) أو PDF فقط');
            setState('error');
            return;
        }

        setFileName(file.name);
        setState('processing');
        setExtractedText('');
        setErrorMsg('');

        try {
            const result = await extractText(file);
            setExtractedText(result.text);
            setPages(result.pages);
            setState('done');
        } catch (err: any) {
            setErrorMsg(err?.message || 'فشل استخراج النص');
            setState('error');
        }
    }, []);

    // Handle files forwarded from DockApp drop handler
    useEffect(() => {
        if (dropGeneration > 0 && dropGeneration !== lastDropGen.current && droppedFiles.length > 0) {
            lastDropGen.current = dropGeneration;
            processFile(droppedFiles[0]);
        }
    }, [dropGeneration, droppedFiles, processFile]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        if (state === 'processing') return;
        const files = Array.from(e.dataTransfer.files);
        if (files.length === 0) return;
        processFile(files[0]);
    }, [state, processFile]);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        if (state !== 'processing') setIsDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
            setIsDragOver(false);
        }
    };

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) processFile(files[0]);
        e.target.value = '';
    };

    const handleDownload = () => {
        if (!extractedText) return;
        const blob = new Blob([extractedText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const base = fileName.replace(/\.[^.]+$/, '') || 'extracted';
        a.href = url;
        a.download = `${base}-OCR.txt`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const handleCopy = () => {
        if (!extractedText) return;
        navigator.clipboard.writeText(extractedText).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const handlePaste = async () => {
        if (state === 'processing') return;
        try {
            if ((window as any).electron?.clipboardRead) {
                const clipItems = await (window as any).electron.clipboardRead();
                if (clipItems.length > 0) {
                    const { dataUrl, name } = clipItems[0];
                    const res = await fetch(dataUrl);
                    const blob = await res.blob();
                    processFile(new File([blob], name, { type: blob.type || 'image/png' }));
                    return;
                }
            } else {
                const clipItems = await navigator.clipboard.read();
                for (const clipItem of clipItems) {
                    const imageType = clipItem.types.find((t: string) => t.startsWith('image/'));
                    if (imageType) {
                        const blob = await clipItem.getType(imageType);
                        const ext = imageType.split('/')[1] || 'png';
                        processFile(new File([blob], `pasted.${ext}`, { type: imageType }));
                        return;
                    }
                }
            }
        } catch (err) {
            console.warn('Clipboard read failed:', err);
        }
    };

    const handleClear = () => {
        setState('idle');
        setExtractedText('');
        setFileName('');
        setErrorMsg('');
        onClose();
    };

    const hasResult = state === 'done' && extractedText.trim();

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
                    <ScanText className="w-4 h-4 text-fuchsia-400" />
                    <span className="text-sm font-bold text-white">استخراج النص</span>
                    {state === 'done' && pages > 1 && (
                        <span className="text-xs bg-slate-700 px-2 py-0.5 rounded-full text-slate-300">{pages} صفحات</span>
                    )}
                </div>
                <div className="flex-1" />
                <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1">
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* Body */}
            <div className="flex-1 flex flex-col min-h-0 p-3 gap-3">
                <AnimatePresence mode="wait">

                    {/* IDLE: Drop zone */}
                    {state === 'idle' && (
                        <motion.label
                            key="idle"
                            htmlFor="ocr-file-input"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className={`
                                flex-1 flex flex-col items-center justify-center gap-4 rounded-xl
                                border-2 border-dashed transition-all duration-200 cursor-pointer
                                ${isDragOver
                                    ? 'border-fuchsia-400 bg-fuchsia-500/10 scale-[0.99]'
                                    : 'border-slate-700 bg-slate-800/30 hover:border-slate-500 hover:bg-slate-800/50'
                                }
                            `}
                        >
                            <div className={`p-4 rounded-2xl transition-colors ${isDragOver ? 'bg-fuchsia-500/20' : 'bg-slate-800'}`}>
                                {isDragOver
                                    ? <Upload className="w-8 h-8 text-fuchsia-400" />
                                    : <ScanText className="w-8 h-8 text-slate-500" />
                                }
                            </div>
                            <div className="text-center px-4">
                                <p className="text-sm font-semibold text-slate-300">
                                    {isDragOver ? 'أفلت الملف هنا' : 'اسحب صورة أو PDF هنا'}
                                </p>
                                <p className="text-xs text-slate-500 mt-1">أو اضغط للاختيار يدويًا</p>
                                <p className="text-[10px] text-slate-600 mt-2">JPG · PNG · WEBP · PDF</p>
                            </div>
                            <input
                                id="ocr-file-input"
                                type="file"
                                accept="image/*,.pdf"
                                className="sr-only"
                                onChange={handleFileInput}
                            />
                        </motion.label>
                    )}

                    {/* PROCESSING */}
                    {state === 'processing' && (
                        <motion.div
                            key="processing"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex-1 flex flex-col items-center justify-center gap-4"
                        >
                            <div className="relative">
                                <div className="absolute inset-0 bg-fuchsia-500 blur-2xl opacity-20 animate-pulse rounded-full" />
                                <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-fuchsia-500/20 flex items-center justify-center relative">
                                    <Loader2 className="w-8 h-8 text-fuchsia-400 animate-spin" />
                                </div>
                            </div>
                            <div className="text-center">
                                <p className="text-sm font-semibold text-slate-200">جاري استخراج النص…</p>
                                <p className="text-xs text-slate-500 mt-1 max-w-[180px] mx-auto truncate" title={fileName}>
                                    {fileName}
                                </p>
                                <p className="text-[10px] text-slate-600 mt-1">يستغرق بضع ثوانٍ</p>
                            </div>
                        </motion.div>
                    )}

                    {/* DONE: Text result */}
                    {state === 'done' && (
                        <motion.div
                            key="done"
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className="flex-1 flex flex-col gap-2 min-h-0"
                        >
                            {/* File badge */}
                            <div className="flex items-center gap-2 px-2 py-1 bg-slate-800/60 rounded-lg border border-white/5 shrink-0">
                                <FileIcon className="w-3 h-3 text-fuchsia-400 shrink-0" />
                                <span className="text-[11px] text-slate-400 truncate">{fileName}</span>
                            </div>

                            {/* Text area */}
                            <div className="flex-1 relative rounded-xl bg-black/30 border border-white/5 overflow-hidden min-h-0">
                                {extractedText.trim() ? (
                                    <textarea
                                        value={extractedText}
                                        onChange={e => setExtractedText(e.target.value)}
                                        className="absolute inset-0 w-full h-full bg-transparent text-slate-200 text-xs leading-relaxed resize-none p-3 focus:outline-none font-mono"
                                        dir="auto"
                                        spellCheck={false}
                                    />
                                ) : (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-4">
                                        <FileText className="w-8 h-8 text-slate-600 mb-2" />
                                        <p className="text-xs text-slate-500">لم يُعثر على نص في هذا الملف</p>
                                    </div>
                                )}
                            </div>
                        </motion.div>
                    )}

                    {/* ERROR */}
                    {state === 'error' && (
                        <motion.div
                            key="error"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex-1 flex flex-col items-center justify-center gap-4 text-center"
                        >
                            <div className="w-14 h-14 rounded-2xl bg-red-900/30 border border-red-500/20 flex items-center justify-center">
                                <AlertCircle className="w-7 h-7 text-red-400" />
                            </div>
                            <div>
                                <p className="text-sm font-semibold text-red-300">فشل الاستخراج</p>
                                <p className="text-xs text-slate-500 mt-1 max-w-[200px]">{errorMsg}</p>
                            </div>
                            <button
                                onClick={() => { setState('idle'); setErrorMsg(''); }}
                                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg transition-colors border border-white/5"
                            >
                                حاول مجددًا
                            </button>
                        </motion.div>
                    )}

                </AnimatePresence>
            </div>

            {/* Footer */}
            <div className="flex items-center gap-1.5 px-3 pb-3 shrink-0">
                {/* Primary action button */}
                {state === 'processing' ? (
                    <button
                        onMouseEnter={() => setCancelHover(true)}
                        onMouseLeave={() => setCancelHover(false)}
                        className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all ${
                            cancelHover
                                ? 'bg-red-600 hover:bg-red-500 text-white cursor-pointer'
                                : 'bg-fuchsia-600/50 text-white/60'
                        }`}
                    >
                        {cancelHover
                            ? <><Ban className="w-4 h-4" />إلغاء</>
                            : <><Loader2 className="w-4 h-4 animate-spin" />جاري الاستخراج...</>
                        }
                    </button>
                ) : (
                    <button
                        onClick={handleDownload}
                        disabled={!hasResult}
                        className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all ${
                            !hasResult
                                ? 'bg-slate-800/50 text-slate-600 cursor-not-allowed'
                                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        }`}
                    >
                        <Download className="w-4 h-4" />
                        تحميل
                    </button>
                )}

                {/* Secondary buttons: Copy | Paste | Clear */}
                <div className="flex-1 flex items-center gap-1">
                    <button
                        onClick={handleCopy}
                        disabled={!hasResult}
                        className={`flex-1 flex items-center justify-center h-10 rounded-xl transition-colors ${
                            !hasResult
                                ? 'bg-slate-800/50 text-slate-600 cursor-not-allowed'
                                : 'bg-white/[0.04] hover:bg-white/[0.1] text-slate-400 hover:text-white'
                        }`}
                        title="نسخ النص"
                    >
                        {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
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
                        disabled={state === 'idle' || state === 'processing'}
                        className={`flex-1 flex items-center justify-center h-10 rounded-xl transition-colors ${
                            state === 'idle' || state === 'processing'
                                ? 'bg-slate-800/50 text-slate-600 cursor-not-allowed'
                                : 'bg-red-900/20 hover:bg-red-900/40 text-red-400 hover:text-red-300'
                        }`}
                        title="مسح"
                    >
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Drag-over overlay when processing (block drop) */}
            {state === 'processing' && isDragOver && (
                <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center rounded-2xl pointer-events-none">
                    <p className="text-sm text-slate-400">يُرجى الانتظار حتى اكتمال المعالجة</p>
                </div>
            )}
        </div>
    );
};
