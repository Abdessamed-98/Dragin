
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
    PenTool, Sliders, Palette, Upload, Loader2, Download,
    Trash2, Check, ClipboardPaste, Ban, AlertCircle, Copy, CheckCircle2,
    Image as ImageIcon, Shapes, PenLine, LayoutGrid,
} from 'lucide-react';
import { vectorizeImage, getFileThumbnail } from '../../services/api';
import type { VectorizeOptions } from '../../services/api';
import { saveOutputs } from '../../services/saveOutput';
import { useI18n } from '../../i18n/I18nContext';
import { ToolHeader } from '../ToolHeader';
import { ToolIconButton } from '../ToolIconButton';
import { sessionStore, useSessionIngest } from '../../state/sessionStore';
import { toolAccepts } from '../../state/toolCompat';

interface VectorizerToolProps {
    onClose: () => void;
    /** True while this tool is the expanded panel — session ingestion runs only then. */
    active: boolean;
    onItemCountChange?: (count: number) => void;
    clearGen?: number;
}

interface VecFileItem {
    id: string;
    file: File;
    status: 'idle' | 'processing' | 'done' | 'error';
    previewUrl?: string;
    previewNeedsRevoke?: boolean;
    resultUrl?: string;
    svgString?: string;
    pathCount?: number;
    svgSize?: number;
    error?: string;
}

// VTracer tuning presets per content type. Each sets the engine params that
// matter for that kind of image (curve mode, layering, color depth, noise floor).
type VecPreset = 'photo' | 'logo' | 'sketch' | 'pixel';
const PRESETS: Record<VecPreset, {
    colormode: 'color' | 'binary'; colorPrecision: number; smoothness: number;
    mode: 'spline' | 'polygon' | 'none'; hierarchical: 'stacked' | 'cutout';
    layer_difference: number; filter_speckle: number;
}> = {
    // Photo: many colors, detailed, smooth curves.
    photo:  { colormode: 'color',  colorPrecision: 7, smoothness: 50, mode: 'spline',  hierarchical: 'stacked', layer_difference: 16, filter_speckle: 4 },
    // Logo / flat art: few colors, aggressive layer merge, clean (denoise), smooth.
    logo:   { colormode: 'color',  colorPrecision: 4, smoothness: 75, mode: 'spline',  hierarchical: 'stacked', layer_difference: 32, filter_speckle: 12 },
    // Sketch / line art: black & white, smooth.
    sketch: { colormode: 'binary', colorPrecision: 1, smoothness: 55, mode: 'spline',  hierarchical: 'stacked', layer_difference: 16, filter_speckle: 6 },
    // Pixel art: crisp straight edges, keep every pixel, no smoothing.
    pixel:  { colormode: 'color',  colorPrecision: 8, smoothness: 0,  mode: 'polygon', hierarchical: 'cutout',  layer_difference: 0,  filter_speckle: 0 },
};


const ACCEPTED_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff', 'tif']);
const isAccepted = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    return ACCEPTED_EXTS.has(ext) || file.type.startsWith('image/');
};

export const VectorizerTool: React.FC<VectorizerToolProps> = ({
    onClose, active, onItemCountChange, clearGen = 0,
}) => {
    const { t } = useI18n();
    const [files, setFiles] = useState<VecFileItem[]>([]);
    const [smoothness, setSmoothness] = useState(0);
    const [colorMode, setColorMode] = useState<'color' | 'binary'>('binary');
    const [colorPrecision, setColorPrecision] = useState(3);
    const [preset, setPreset] = useState<VecPreset | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [cancelHover, setCancelHover] = useState(false);
    const [isCopying, setIsCopying] = useState(false);
    const [showCopySuccess, setShowCopySuccess] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

    const abortRef = useRef(false);
    const handleVectorizeRef = useRef<() => Promise<void>>(async () => {});

    // Report item count to parent
    useEffect(() => { onItemCountChange?.(files.length); }, [files.length, onItemCountChange]);

    // Clear on global clear signal
    const lastClearGen = useRef(clearGen);
    useEffect(() => {
        if (clearGen === 0 || clearGen === lastClearGen.current) return;
        lastClearGen.current = clearGen;
        setFiles(prev => {
            prev.forEach(f => { if (f.previewUrl && f.previewNeedsRevoke) URL.revokeObjectURL(f.previewUrl); });
            return [];
        });
    }, [clearGen]);

    // Cleanup preview URLs on unmount
    const filesRef = useRef<VecFileItem[]>([]);
    useEffect(() => { filesRef.current = files; }, [files]);
    useEffect(() => {
        return () => {
            abortRef.current = true;
            filesRef.current.forEach(f => {
                if (f.previewUrl && f.previewNeedsRevoke) URL.revokeObjectURL(f.previewUrl);
            });
        };
    }, []);

    const getVtracerOptions = useCallback((): Partial<VectorizeOptions> => {
        const t = smoothness / 100;
        const ex = preset ? PRESETS[preset] : null;
        return {
            colormode: colorMode,
            mode: ex?.mode ?? 'spline',
            hierarchical: ex?.hierarchical ?? 'stacked',
            layer_difference: ex?.layer_difference ?? 16,
            corner_threshold: Math.round(5 + t * 115),
            splice_threshold: Math.round(5 + t * 95),
            length_threshold: 1.0 + t * 5.0,
            // Presets pin the speckle (noise) floor; freehand mode derives it from smoothness.
            filter_speckle: ex ? ex.filter_speckle : Math.round(1 + t * 4),
            color_precision: colorMode === 'binary' ? 1 : colorPrecision,
            path_precision: 8,
        };
    }, [smoothness, colorMode, colorPrecision, preset]);

    // Apply a preset: set the visible sliders + the hidden engine params, then re-run.
    const applyPreset = useCallback((name: VecPreset) => {
        const p = PRESETS[name];
        setPreset(name);
        setColorMode(p.colormode);
        setColorPrecision(p.colorPrecision);
        setSmoothness(p.smoothness);
        setFiles(prev => prev.map(f => f.status === 'done' ? { ...f, status: 'idle' as const } : f));
        setTimeout(() => handleVectorizeRef.current(), 0);
    }, []);

    // Ingest session files (keyed by session id). Vectorizer is a SINGLE-image
    // tool: each ingest batch replaces the current image with the batch's last entry.
    const ingestBatch = useCallback(async (batch: { id: string; file: File; direct: boolean }[]) => {
        const last = batch[batch.length - 1];
        if (!last) return;
        let previewUrl: string | undefined;
        let previewNeedsRevoke = false;
        try {
            const result = await getFileThumbnail(last.file, 64);
            if (result) { previewUrl = result.url; previewNeedsRevoke = result.needsRevoke; }
        } catch { /* no preview */ }
        const item: VecFileItem = { id: last.id, file: last.file, status: 'idle', previewUrl, previewNeedsRevoke };
        setFiles(prev => {
            prev.forEach(p => { if (p.previewUrl && p.previewNeedsRevoke) URL.revokeObjectURL(p.previewUrl); });
            return [item];
        });
        setSelectedIds(new Set());
        // Direct drops auto-vectorize; carried items (rail switch) wait for the button.
        if (last.direct) setTimeout(() => handleVectorizeRef.current(), 0);
    }, []);

    const removeLocal = useCallback((ids: string[]) => {
        setFiles(prev => {
            prev.filter(p => ids.includes(p.id)).forEach(p => { if (p.previewUrl && p.previewNeedsRevoke) URL.revokeObjectURL(p.previewUrl); });
            return prev.filter(p => !ids.includes(p.id));
        });
        setSelectedIds(prev => {
            const next = new Set(prev);
            ids.forEach(id => next.delete(id));
            return next;
        });
    }, []);

    useSessionIngest(active, 'vectorizer', f => toolAccepts('vectorizer', f) && isAccepted(f.currentFile), ingestBatch, removeLocal);

    // UI adds (drop on panel / file input / paste) go through the session store —
    // the ingest above brings them into local state.
    const addFiles = useCallback((newFiles: File[]) => {
        const accepted = newFiles.filter(isAccepted);
        if (accepted.length) sessionStore.addFiles(accepted, 'vectorizer');
    }, []);

    const toggleSelection = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

const handleVectorize = useCallback(async () => {
        abortRef.current = false;
        const options = getVtracerOptions();

        // Atomically mark idle files as processing and capture them
        let idleItems: VecFileItem[] = [];
        setFiles(prev => {
            idleItems = prev.filter(f => f.status === 'idle');
            return prev.map(f => f.status === 'idle' ? { ...f, status: 'processing' as const } : f);
        });

        // Allow React to flush the state update
        await new Promise(r => setTimeout(r, 0));
        if (idleItems.length === 0) return;

        // Process all in parallel
        await Promise.all(idleItems.map(async (item) => {
            try {
                const result = await vectorizeImage(item.file, options);
                if (abortRef.current) return;
                setFiles(prev => prev.map(f => f.id === item.id ? {
                    ...f,
                    status: 'done' as const,
                    resultUrl: result.svgDataUrl,
                    svgString: result.svgString,
                    pathCount: result.pathCount,
                    svgSize: result.svgSize,
                } : f));
                // Session write-back: the SVG becomes the file's current state,
                // so switching tools carries the RESULT forward.
                sessionStore.applyResult(
                    item.id,
                    new Blob([result.svgString], { type: 'image/svg+xml' }),
                    `${item.file.name.replace(/\.[^.]+$/, '')}.svg`,
                    'vectorizer',
                );
            } catch (err: any) {
                if (!abortRef.current) {
                    setFiles(prev => prev.map(f => f.id === item.id ? {
                        ...f, status: 'error' as const, error: err.message || t('vectorizer.conversionFailed'),
                    } : f));
                }
            }
        }));
    }, [getVtracerOptions]);

    // Keep ref current so setTimeout callbacks always call the latest version
    useEffect(() => { handleVectorizeRef.current = handleVectorize; }, [handleVectorize]);

    const resetAndReprocess = () => {
        setFiles(prev => prev.map(f => f.status === 'done' ? { ...f, status: 'idle' as const } : f));
        setTimeout(() => handleVectorizeRef.current(), 0);
    };

    // onChange: update value only (live feedback while dragging)
    // onMouseUp: trigger re-vectorize when slider is released
    const handleSmoothnessChange = (val: number) => { setSmoothness(val); };
    const handleSmoothnessCommit = () => resetAndReprocess();
    const handleColorModeToggle = () => { setColorMode(prev => prev === 'color' ? 'binary' : 'color'); resetAndReprocess(); };
    const handleColorPrecisionChange = (val: number) => { setColorPrecision(val); };
    const handleColorPrecisionCommit = () => resetAndReprocess();

    const handleDownload = async () => {
        const done = files.filter(f => f.status === 'done' && f.svgString);
        if (done.length === 0) return;
        setIsDownloading(true);
        const urls: string[] = [];
        try {
            await saveOutputs(done.map(item => {
                const url = URL.createObjectURL(new Blob([item.svgString!], { type: 'image/svg+xml' }));
                urls.push(url);
                return {
                    name: `${item.file.name.replace(/\.[^.]+$/, '')}-vectorized.svg`,
                    url,
                    originalPath: (item.file as any).path ?? null,
                };
            }), 'vectorized');
        } catch (e) {
            console.error('Save failed', e);
        } finally {
            urls.forEach(u => URL.revokeObjectURL(u));
            setIsDownloading(false);
        }
    };

    const handleClear = () => {
        abortRef.current = true;
        files.forEach(f => { if (f.previewUrl && f.previewNeedsRevoke) URL.revokeObjectURL(f.previewUrl); });
        sessionStore.remove(files.map(f => f.id));
        setFiles([]);
        setSelectedIds(new Set());
        onClose();
    };

    const cancelAll = () => {
        abortRef.current = true;
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
                return { dataUrl, name: `${item.file.name.replace(/\.[^.]+$/, '')}-vectorized.svg` };
            }));
            if ((window as any).electron?.clipboardWrite) await (window as any).electron.clipboardWrite(clipItems);
            setShowCopySuccess(true);
            setTimeout(() => setShowCopySuccess(false), 1500);
        } catch (err) { console.error('Copy failed:', err); }
        finally { setIsCopying(false); }
    };

    const handlePaste = async () => {
        try {
            if ((window as any).electron?.clipboardRead) {
                const clipItems = await (window as any).electron.clipboardRead();
                if (clipItems.length > 0) {
                    const pastedFiles = await Promise.all(clipItems.map(async ({ dataUrl, name }: any) => {
                        const res = await fetch(dataUrl);
                        const blob = await res.blob();
                        return new File([blob], name, { type: blob.type });
                    }));
                    addFiles(pastedFiles);
                    return;
                }
            }
            const items = await navigator.clipboard.read();
            for (const item of items) {
                for (const type of item.types) {
                    if (type.startsWith('image/')) {
                        const blob = await item.getType(type);
                        const ext = type.split('/')[1] || 'png';
                        addFiles([new File([blob], `pasted.${ext}`, { type })]);
                        return;
                    }
                }
            }
        } catch { /* clipboard not available */ }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
        const f = Array.from(e.dataTransfer.files);
        if (f.length > 0) addFiles(f);
    };
    const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); };
    const handleDragLeave = (e: React.DragEvent) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setIsDragOver(false);
    };
    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files;
        if (f && f.length > 0) addFiles(Array.from(f));
        e.target.value = '';
    };

    // Derived state
    const hasFiles = files.length > 0;
    const anyProcessing = files.some(f => f.status === 'processing');
    const anyDone = files.some(f => f.status === 'done');

    const smoothnessLabel = smoothness <= 20 ? t('vectorizer.smoothSharp') : smoothness <= 40 ? t('vectorizer.smoothLight') :
        smoothness <= 60 ? t('vectorizer.smoothMedium') : smoothness <= 80 ? t('vectorizer.smoothSmooth') : t('vectorizer.smoothVerySmooth');
    const colorLabel = colorPrecision <= 3 ? t('vectorizer.colorFew') : colorPrecision <= 5 ? t('vectorizer.colorMedium') :
        colorPrecision <= 7 ? t('vectorizer.colorRich') : t('vectorizer.colorFull');
    const isColor = colorMode === 'color';

    return (
        <div
            className="absolute inset-0 flex flex-col rounded-2xl overflow-hidden"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
        >
            {/* Header */}
            <ToolHeader icon={<PenTool className="w-4 h-4 text-rose-400" />} title={t('vectorizer.headerTitle')} count={files.length} onClose={onClose} />

            {/* Settings panel — always visible */}
            <div className="px-4 py-3 border-b border-white/5 shrink-0 bg-slate-900/40">
                {/* Presets — tuned param sets per content type */}
                <div className="flex items-center gap-1.5 mb-3">
                    {([
                        { key: 'photo' as const, label: t('vectorizer.presetPhoto'), Icon: ImageIcon },
                        { key: 'logo' as const, label: t('vectorizer.presetLogo'), Icon: Shapes },
                        { key: 'sketch' as const, label: t('vectorizer.presetSketch'), Icon: PenLine },
                        { key: 'pixel' as const, label: t('vectorizer.presetPixel'), Icon: LayoutGrid },
                    ]).map(({ key, label, Icon }) => (
                        <button
                            key={key}
                            onClick={() => applyPreset(key)}
                            disabled={anyProcessing}
                            className={`flex-1 flex flex-col items-center gap-1 py-1.5 rounded-lg border text-[10px] font-semibold transition-colors disabled:opacity-50 ${
                                preset === key
                                    ? 'bg-rose-500/15 border-rose-500/60 text-rose-300'
                                    : 'bg-slate-800/40 border-white/5 text-slate-400 hover:text-white hover:bg-slate-700/50'
                            }`}
                            title={label}
                        >
                            <Icon className="w-3.5 h-3.5" />
                            {label}
                        </button>
                    ))}
                </div>
                <div className="flex gap-5">
                    {/* Smoothness */}
                    <div className="flex-1 space-y-1.5">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                                <Sliders className="w-3 h-3 text-slate-500" />
                                <span className="text-xs font-bold text-slate-400">{t('vectorizer.smoothness')}</span>
                            </div>
                            <span className="text-xs text-rose-400 font-medium">{smoothnessLabel}</span>
                        </div>
                        <input
                            type="range" min="0" max="100" value={smoothness}
                            onChange={e => handleSmoothnessChange(Number(e.target.value))}
                            onMouseUp={handleSmoothnessCommit}
                            className="w-full h-1.5 rounded-full appearance-none cursor-pointer
                                bg-gradient-to-r from-slate-700 via-rose-900/50 to-rose-500
                                [&::-webkit-slider-thumb]:appearance-none
                                [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
                                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
                                [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-rose-500
                                [&::-webkit-slider-thumb]:shadow-md
                                [&::-webkit-slider-thumb]:hover:scale-125
                                [&::-webkit-slider-thumb]:transition-transform"
                        />
                    </div>

                    {/* Color count */}
                    <div className="flex-1 space-y-1.5">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                                <Palette className="w-3 h-3 text-slate-500" />
                                <span className="text-xs font-bold text-slate-400">{t('vectorizer.colors')}</span>
                                <button
                                    onClick={handleColorModeToggle}
                                    className="relative w-7 h-3.5 rounded-full transition-colors duration-200 shrink-0"
                                    style={{ backgroundColor: isColor ? 'rgb(245 158 11 / 0.4)' : 'rgb(51 65 85 / 0.8)' }}
                                    title={isColor ? t('vectorizer.toBW') : t('vectorizer.toColor')}
                                >
                                    <div
                                        className="absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow-sm transition-all duration-200"
                                        style={{ left: isColor ? '14px' : '2px' }}
                                    />
                                </button>
                            </div>
                            <span className="text-xs text-amber-400 font-medium">{colorLabel}</span>
                        </div>
                        <input
                            type="range" min="2" max="8" value={colorPrecision}
                            onChange={e => handleColorPrecisionChange(Number(e.target.value))}
                            onMouseUp={handleColorPrecisionCommit}
                            disabled={!isColor}
                            className="w-full h-1.5 rounded-full appearance-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-40
                                bg-gradient-to-r from-slate-700 via-amber-900/50 to-amber-500
                                [&::-webkit-slider-thumb]:appearance-none
                                [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5
                                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
                                [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-amber-500
                                [&::-webkit-slider-thumb]:shadow-md
                                [&::-webkit-slider-thumb]:hover:scale-125
                                [&::-webkit-slider-thumb]:transition-transform"
                        />
                    </div>
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 flex flex-col min-h-0 p-3 gap-2">
                {/* Empty state */}
                {!hasFiles && (
                    <label
                        htmlFor="vectorizer-file-input"
                        className={`
                            flex-1 flex flex-col items-center justify-center gap-4 rounded-xl
                            border-2 border-dashed transition-all duration-200 cursor-pointer
                            ${isDragOver
                                ? 'border-rose-400 bg-rose-500/10 scale-[0.99]'
                                : 'border-slate-700 bg-slate-800/30 hover:border-slate-500 hover:bg-slate-800/50'
                            }
                        `}
                    >
                        <div className={`p-4 rounded-2xl transition-colors ${isDragOver ? 'bg-rose-500/20' : 'bg-slate-800'}`}>
                            {isDragOver
                                ? <Upload className="w-8 h-8 text-rose-400" />
                                : <PenTool className="w-8 h-8 text-slate-500" />
                            }
                        </div>
                        <div className="text-center px-4">
                            <p className="text-sm font-semibold text-slate-300">
                                {isDragOver ? t('vectorizer.dropImage') : t('vectorizer.dragImage')}
                            </p>
                            <p className="text-xs text-slate-500 mt-1">{t('vectorizer.subHint')}</p>
                            <p className="text-[10px] text-slate-600 mt-2">{t('vectorizer.formatHint')}</p>
                        </div>
                        <input
                            id="vectorizer-file-input" type="file" accept="image/*" multiple
                            className="sr-only" onChange={handleFileInput}
                        />
                    </label>
                )}

                {/* Single view */}
                {files.length === 1 && (
                    <div className="flex-1 relative min-h-0 rounded-xl overflow-hidden bg-black/20 border border-white/5">
                        {(files[0].resultUrl || files[0].previewUrl) ? (
                            <img
                                src={files[0].status === 'done' && files[0].resultUrl ? files[0].resultUrl : files[0].previewUrl}
                                className="w-full h-full object-contain"
                                alt="preview"
                                draggable={false}
                            />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center">
                                <PenTool className="w-8 h-8 text-rose-400/40" />
                            </div>
                        )}
                        {files[0].status === 'processing' && (
                            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center">
                                <Loader2 className="w-8 h-8 text-rose-400 animate-spin mb-2" />
                                <span className="text-xs text-slate-300">{t('vectorizer.converting')}</span>
                            </div>
                        )}
                        {files[0].status === 'error' && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-950/70 gap-2">
                                <AlertCircle className="w-8 h-8 text-red-400" />
                                <span className="text-xs text-red-300">{files[0].error || t('vectorizer.conversionFailed')}</span>
                            </div>
                        )}
                    </div>
                )}

                {/* Grid view */}
                {files.length > 1 && (
                    <div className="flex-1 min-h-0 overflow-y-auto">
                        <div className="grid grid-cols-2 gap-2">
                            {files.map(item => {
                                const isSelected = selectedIds.has(item.id);
                                const imgSrc = item.status === 'done' && item.resultUrl ? item.resultUrl : item.previewUrl;
                                return (
                                    <div
                                        key={item.id}
                                        onClick={() => toggleSelection(item.id)}
                                        className={`group relative aspect-square rounded-lg border overflow-hidden flex items-center justify-center p-2 transition-all duration-200 cursor-pointer select-none ${
                                            isSelected
                                                ? 'bg-rose-500/20 border-rose-500 ring-1 ring-rose-500'
                                                : 'bg-slate-800/50 border-white/5 hover:bg-slate-700/50'
                                        }`}
                                    >
                                        {imgSrc ? (
                                            <img
                                                src={imgSrc}
                                                className={`w-full h-full object-contain select-none pointer-events-none ${item.status === 'processing' ? 'opacity-50' : 'opacity-100'}`}
                                                alt=""
                                                draggable={false}
                                            />
                                        ) : (
                                            <PenTool className="w-5 h-5 text-rose-400/40" />
                                        )}
                                        {item.status === 'processing' && (
                                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                <Loader2 className="w-6 h-6 text-rose-400 animate-spin" />
                                            </div>
                                        )}
                                        {item.status === 'error' && (
                                            <div className="absolute inset-0 flex items-center justify-center bg-red-950/70">
                                                <AlertCircle className="w-5 h-5 text-red-400" />
                                            </div>
                                        )}
                                        {isSelected && (
                                            <div className="absolute top-1 right-1 bg-rose-500 text-white rounded-full p-0.5 shadow-sm">
                                                <CheckCircle2 className="w-3 h-3" />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            {/* Add more cell */}
                            <label
                                htmlFor="vectorizer-add-input"
                                className={`aspect-square rounded-lg border border-dashed cursor-pointer transition-colors flex items-center justify-center ${
                                    isDragOver
                                        ? 'border-rose-400 bg-rose-500/10'
                                        : 'border-slate-700 hover:border-slate-500 bg-slate-800/20'
                                }`}
                            >
                                <Upload className="w-4 h-4 text-slate-600" />
                                <input
                                    id="vectorizer-add-input" type="file" accept="image/*" multiple
                                    className="sr-only" onChange={handleFileInput}
                                />
                            </label>
                        </div>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-1.5 px-3 pb-3 shrink-0">
                {anyProcessing ? (
                    <button
                        onMouseEnter={() => setCancelHover(true)}
                        onMouseLeave={() => setCancelHover(false)}
                        onClick={cancelHover ? cancelAll : undefined}
                        className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all ${
                            cancelHover
                                ? 'bg-red-600 hover:bg-red-500 text-white cursor-pointer'
                                : 'bg-rose-600/50 text-white/60'
                        }`}
                    >
                        {cancelHover
                            ? <><Ban className="w-4 h-4" />{t('vectorizer.cancel')}</>
                            : <><Loader2 className="w-4 h-4 animate-spin" />{t('vectorizer.converting')}</>
                        }
                    </button>
                ) : files.some(f => f.status === 'idle') ? (
                    <button
                        onClick={() => handleVectorizeRef.current()}
                        className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all bg-rose-600 hover:bg-rose-500 text-white"
                    >
                        <PenTool className="w-4 h-4" />
                        {t('vectorizer.run')}
                    </button>
                ) : (
                    <button
                        onClick={handleDownload}
                        disabled={!anyDone || isDownloading}
                        className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all ${
                            !anyDone || isDownloading
                                ? 'bg-slate-800/50 text-slate-600 cursor-not-allowed'
                                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                        }`}
                    >
                        {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        {t('vectorizer.download')}
                    </button>
                )}

                <div className="flex-1 flex items-center gap-1">
                    <ToolIconButton
                        onClick={handleCopy}
                        disabled={!anyDone || isCopying}
                        title={t('vectorizer.copy')}
                    >
                        {isCopying ? <Loader2 className="w-4 h-4 animate-spin" /> :
                            showCopySuccess ? <Check className="w-4 h-4 text-green-400" /> :
                                <Copy className="w-4 h-4" />}
                    </ToolIconButton>
                    <ToolIconButton
                        onClick={handlePaste}
                        title={t('vectorizer.paste')}
                    >
                        <ClipboardPaste className="w-4 h-4" />
                    </ToolIconButton>
                    <ToolIconButton
                        onClick={handleClear}
                        disabled={!hasFiles || anyProcessing}
                        danger
                        title={t('vectorizer.clearAll')}
                    >
                        <Trash2 className="w-4 h-4" />
                    </ToolIconButton>
                </div>
            </div>
        </div>
    );
};
