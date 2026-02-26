
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Palette, Upload, Loader2, Trash2, X, Copy, Check, ClipboardPaste
} from 'lucide-react';
import { extractPalette, getFileThumbnail } from '../../services/api';
import type { PaletteColor } from '../../services/api';

interface PaletteToolProps {
    onClose: () => void;
    droppedFiles: File[];
    dropGeneration: number;
    onItemCountChange?: (count: number) => void;
    clearGen?: number;
}

type PaletteState = 'idle' | 'processing' | 'done' | 'error';

const isImageFile = (file: File): boolean => {
    if (file.type.startsWith('image/')) return true;
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    return ['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif', 'gif'].includes(ext);
};

const FILE_ACCEPT = 'image/*,.jpg,.jpeg,.png,.webp,.bmp,.tiff,.tif,.gif';

const isLightColor = (rgb: [number, number, number]): boolean => {
    const [r, g, b] = rgb;
    return (r * 299 + g * 587 + b * 114) / 1000 > 150;
};

export const PaletteTool: React.FC<PaletteToolProps> = ({
    onClose, droppedFiles, dropGeneration, onItemCountChange, clearGen = 0,
}) => {
    const [state, setState] = useState<PaletteState>('idle');
    const [colors, setColors] = useState<PaletteColor[]>([]);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [previewNeedsRevoke, setPreviewNeedsRevoke] = useState(false);
    const [fileName, setFileName] = useState('');
    const [errorMsg, setErrorMsg] = useState('');
    const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
    const [isCopyingAll, setIsCopyingAll] = useState(false);
    const [showCopyAllSuccess, setShowCopyAllSuccess] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const fileRef = useRef<File | null>(null);

    useEffect(() => {
        onItemCountChange?.(state === 'idle' ? 0 : 1);
    }, [state, onItemCountChange]);

    // Consume dropped files from DockApp
    const lastDropGen = useRef(dropGeneration);
    useEffect(() => {
        if (dropGeneration === 0) return;
        if (dropGeneration === lastDropGen.current) return;
        lastDropGen.current = dropGeneration;
        if (droppedFiles.length === 0) return;
        const img = droppedFiles.find(isImageFile);
        if (img) processFile(img);
    }, [dropGeneration]); // eslint-disable-line react-hooks/exhaustive-deps

    // Clear signal
    const lastClearGen = useRef(clearGen);
    useEffect(() => {
        if (clearGen === 0 || clearGen === lastClearGen.current) return;
        lastClearGen.current = clearGen;
        resetState();
    }, [clearGen]);

    const resetState = () => {
        if (previewUrl && previewNeedsRevoke) URL.revokeObjectURL(previewUrl);
        setState('idle');
        setColors([]);
        setPreviewUrl(null);
        setPreviewNeedsRevoke(false);
        setFileName('');
        setErrorMsg('');
        fileRef.current = null;
    };

    const processFile = useCallback(async (file: File) => {
        // Clean up previous preview
        if (previewUrl && previewNeedsRevoke) URL.revokeObjectURL(previewUrl);

        fileRef.current = file;
        setFileName(file.name);
        setState('processing');
        setColors([]);
        setErrorMsg('');

        // Generate preview
        try {
            const result = await getFileThumbnail(file, 200);
            if (result) {
                setPreviewUrl(result.url);
                setPreviewNeedsRevoke(result.needsRevoke);
            } else {
                setPreviewUrl(URL.createObjectURL(file));
                setPreviewNeedsRevoke(true);
            }
        } catch {
            setPreviewUrl(URL.createObjectURL(file));
            setPreviewNeedsRevoke(true);
        }

        // Extract palette
        try {
            const result = await extractPalette(file, 8);
            setColors(result);
            setState('done');
        } catch (err: any) {
            setErrorMsg(err?.message || 'فشل استخراج الألوان');
            setState('error');
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const handleCopySingle = async (hex: string, idx: number) => {
        try {
            await navigator.clipboard.writeText(hex);
            setCopiedIdx(idx);
            setTimeout(() => setCopiedIdx(null), 1200);
        } catch { /* ignore */ }
    };

    const handleCopyAll = async () => {
        if (colors.length === 0 || isCopyingAll) return;
        setIsCopyingAll(true);
        try {
            const text = colors.map(c => c.hex).join('\n');
            await navigator.clipboard.writeText(text);
            setShowCopyAllSuccess(true);
            setTimeout(() => setShowCopyAllSuccess(false), 1500);
        } catch { /* ignore */ }
        setIsCopyingAll(false);
    };

    const handlePaste = async () => {
        try {
            if ((window as any).electron?.clipboardRead) {
                const clipItems = await (window as any).electron.clipboardRead();
                if (clipItems.length > 0) {
                    const { dataUrl, name } = clipItems[0];
                    const res = await fetch(dataUrl);
                    const blob = await res.blob();
                    const file = new File([blob], name, { type: blob.type || 'image/png' });
                    if (isImageFile(file)) processFile(file);
                    return;
                }
            }
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
        } catch { /* ignore */ }
    };

    const handleClear = () => {
        resetState();
        onClose();
    };

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        const files = Array.from(e.dataTransfer.files);
        const img = files.find(isImageFile);
        if (img) processFile(img);
    }, [processFile]);

    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); };
    const handleDragLeave = (e: React.DragEvent) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setIsDragOver(false);
    };
    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (f && isImageFile(f)) processFile(f);
        e.target.value = '';
    };

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (previewUrl && previewNeedsRevoke) URL.revokeObjectURL(previewUrl);
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <div
            className="absolute inset-0 flex flex-col rounded-2xl overflow-hidden bg-slate-950"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
        >
            {/* Header */}
            <div className="flex items-center px-4 py-3 border-b border-white/5 shrink-0">
                <div className="flex items-center gap-2">
                    <Palette className="w-4 h-4 text-violet-400" />
                    <span className="text-sm font-bold text-white">استخراج الألوان</span>
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
                    {state === 'idle' && (
                        <motion.label
                            key="empty"
                            htmlFor="palette-file-input"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className={`
                                flex-1 flex flex-col items-center justify-center gap-4 rounded-xl
                                border-2 border-dashed transition-all duration-200 cursor-pointer
                                ${isDragOver
                                    ? 'border-violet-400 bg-violet-500/10 scale-[0.99]'
                                    : 'border-slate-700 bg-slate-800/30 hover:border-slate-500 hover:bg-slate-800/50'
                                }
                            `}
                        >
                            <div className={`p-4 rounded-2xl transition-colors ${isDragOver ? 'bg-violet-500/20' : 'bg-slate-800'}`}>
                                {isDragOver
                                    ? <Upload className="w-8 h-8 text-violet-400" />
                                    : <Palette className="w-8 h-8 text-slate-500" />
                                }
                            </div>
                            <div className="text-center px-4">
                                <p className="text-sm font-semibold text-slate-300">
                                    {isDragOver ? 'أفلت الصورة هنا' : 'اسحب صورة هنا لاستخراج الألوان'}
                                </p>
                                <p className="text-xs text-slate-500 mt-1">استخراج الألوان السائدة مع أكواد HEX</p>
                                <p className="text-[10px] text-slate-600 mt-2">صور: JPG · PNG · WEBP · BMP · TIFF · GIF</p>
                            </div>
                            <input id="palette-file-input" type="file" accept={FILE_ACCEPT} className="sr-only" onChange={handleFileInput} />
                        </motion.label>
                    )}

                    {/* Processing state */}
                    {state === 'processing' && (
                        <motion.div
                            key="processing"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex-1 flex flex-col items-center justify-center gap-3"
                        >
                            <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
                            <p className="text-xs text-slate-400">جاري استخراج الألوان...</p>
                        </motion.div>
                    )}

                    {/* Error state */}
                    {state === 'error' && (
                        <motion.div
                            key="error"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex-1 flex flex-col items-center justify-center gap-3"
                        >
                            <p className="text-xs text-red-400">{errorMsg}</p>
                            <button
                                onClick={resetState}
                                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded-lg transition-colors border border-white/5"
                            >
                                حاول مجددًا
                            </button>
                        </motion.div>
                    )}

                    {/* Done state — preview + colors */}
                    {state === 'done' && (
                        <motion.div
                            key="done"
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0 }}
                            className="flex-1 flex flex-col gap-2 min-h-0"
                        >
                            {/* Image preview — fills remaining space */}
                            {previewUrl && (
                                <div className="flex-1 min-h-0 rounded-xl overflow-hidden bg-slate-900/60 border border-white/5 flex items-center justify-center p-2">
                                    <img src={previewUrl} alt={fileName} className="max-w-full max-h-full object-contain rounded-lg" />
                                </div>
                            )}

                            {/* Color swatches grid */}
                            <div className="grid grid-cols-4 gap-1.5 shrink-0">
                                {colors.map((color, i) => (
                                    <button
                                        key={i}
                                        onClick={() => handleCopySingle(color.hex, i)}
                                        className="relative overflow-hidden rounded-lg border border-white/5 hover:border-white/20 transition-all group cursor-pointer h-10"
                                        title={color.hex}
                                        style={{ backgroundColor: color.hex }}
                                    >
                                        <span className="absolute inset-0 flex items-center justify-center text-[9px] font-mono font-bold opacity-0 group-hover:opacity-100 transition-opacity"
                                            style={{ color: isLightColor(color.rgb) ? '#000' : '#fff', textShadow: isLightColor(color.rgb) ? 'none' : '0 1px 3px rgba(0,0,0,0.5)' }}>
                                            {copiedIdx === i ? '✓ تم' : color.hex}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>
            </div>

            {/* Footer */}
            <div className="flex items-center gap-1.5 px-3 pb-3 shrink-0">
                {state === 'processing' ? (
                    <button disabled className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold bg-violet-600/50 text-white/60">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        جاري الاستخراج...
                    </button>
                ) : state === 'done' ? (
                    <button onClick={handleCopyAll} disabled={isCopyingAll} className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50">
                        {isCopyingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : showCopyAllSuccess ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                        {showCopyAllSuccess ? 'تم النسخ' : 'نسخ الكل'}
                    </button>
                ) : (
                    <button disabled className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold bg-slate-800/50 text-slate-600 cursor-not-allowed">
                        <Palette className="w-4 h-4" />
                        استخراج الألوان
                    </button>
                )}
                <div className="flex-1 flex items-center gap-1">
                    <button onClick={handleCopyAll} disabled={isCopyingAll || state !== 'done'} className="flex-1 flex items-center justify-center h-10 rounded-xl transition-colors bg-white/[0.04] hover:bg-white/[0.1] text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed" title="نسخ">
                        {isCopyingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : showCopyAllSuccess ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                    </button>
                    <button onClick={handlePaste} className="flex-1 flex items-center justify-center h-10 rounded-xl transition-colors bg-white/[0.04] hover:bg-white/[0.1] text-slate-400 hover:text-white" title="لصق">
                        <ClipboardPaste className="w-4 h-4" />
                    </button>
                    <button onClick={handleClear} disabled={state === 'processing'} className={`flex-1 flex items-center justify-center h-10 rounded-xl transition-colors ${state === 'processing' ? 'bg-slate-800/50 text-slate-600 cursor-not-allowed' : 'bg-red-900/20 hover:bg-red-900/40 text-red-400 hover:text-red-300'}`} title="مسح">
                        <Trash2 className="w-4 h-4" />
                    </button>
                </div>
            </div>
        </div>
    );
};
