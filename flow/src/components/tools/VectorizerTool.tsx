
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Check, X, Loader2, PenTool, Eye } from 'lucide-react';
import { VectorizeOptions, vectorizeImage } from '../../services/api';

interface VectorizerToolProps {
    file: File;
    originalUrl: string;
    onSave: (svgDataUrl: string, svgString: string) => void;
    onCancel: () => void;
}

type Preset = 'icon' | 'balanced' | 'simple';

const PRESETS: Record<Preset, { smoothness: number; colorPrecision: number; label: string }> = {
    icon: { smoothness: 10, colorPrecision: 8, label: 'أيقونة' },
    balanced: { smoothness: 40, colorPrecision: 6, label: 'متوازن' },
    simple: { smoothness: 80, colorPrecision: 3, label: 'بسيط' },
};

export const VectorizerTool: React.FC<VectorizerToolProps> = ({
    file,
    originalUrl,
    onSave,
    onCancel
}) => {
    // --- State ---
    const [smoothness, setSmoothness] = useState(10);
    const [colorMode, setColorMode] = useState<'color' | 'binary'>('color');
    const [colorPrecision, setColorPrecision] = useState(8); // 2-8
    const [activePreset, setActivePreset] = useState<Preset | null>('icon');
    const [isProcessing, setIsProcessing] = useState(false);
    const [svgPreview, setSvgPreview] = useState<string | null>(null);
    const [svgString, setSvgString] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [hasProcessed, setHasProcessed] = useState(false);
    const [showOriginal, setShowOriginal] = useState(false);
    const [pathCount, setPathCount] = useState(0);
    const [svgSize, setSvgSize] = useState(0);

    const abortRef = useRef(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const isFirstRender = useRef(true);

    // Map UI state to vtracer parameters — tuned for icons/logos/illustrations
    const getVtracerOptions = useCallback((): Partial<VectorizeOptions> => {
        const t = smoothness / 100;

        // corner_threshold: 5-120 (low = sharp corners preserved, high = rounded)
        const corner_threshold = Math.round(5 + t * 115);
        // splice_threshold: 5-100
        const splice_threshold = Math.round(5 + t * 95);
        // length_threshold: 1.0-6.0 (low = keep small segments, high = simplify)
        const length_threshold = 1.0 + t * 5.0;
        // filter_speckle: 1-5 (low = keep small features, important for icons)
        const filter_speckle = Math.round(1 + t * 4);

        const cp = colorMode === 'binary' ? 1 : colorPrecision;

        return {
            colormode: colorMode,
            corner_threshold,
            splice_threshold,
            length_threshold,
            filter_speckle,
            color_precision: cp,
            path_precision: 8,
        };
    }, [smoothness, colorMode, colorPrecision]);

    // --- Process ---
    const processImage = useCallback(async () => {
        setIsProcessing(true);
        setError(null);
        abortRef.current = false;

        try {
            const options = getVtracerOptions();
            const result = await vectorizeImage(file, options);

            if (abortRef.current) return;

            setSvgPreview(result.svgDataUrl);
            setSvgString(result.svgString);
            setPathCount(result.pathCount);
            setSvgSize(result.svgSize);
            setHasProcessed(true);
        } catch (err: any) {
            if (!abortRef.current) {
                setError(err.message || 'فشل التحويل');
            }
        } finally {
            if (!abortRef.current) {
                setIsProcessing(false);
            }
        }
    }, [file, getVtracerOptions]);

    // Keep a ref to latest processImage so debounce always calls the current version
    const processRef = useRef(processImage);
    processRef.current = processImage;

    // Auto-process on first load
    useEffect(() => {
        processImage();
        return () => { abortRef.current = true; };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Auto-apply with debounce when settings change (skip first render)
    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            processRef.current();
        }, 600);
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [smoothness, colorMode, colorPrecision]);

    // --- Handlers ---
    const handlePreset = (preset: Preset) => {
        const p = PRESETS[preset];
        setActivePreset(preset);
        setSmoothness(p.smoothness);
        setColorPrecision(p.colorPrecision);
    };

    const handleSmoothnessChange = (val: number) => {
        setSmoothness(val);
        setActivePreset(null);
    };

    const handleColorPrecisionChange = (val: number) => {
        setColorPrecision(val);
        setActivePreset(null);
    };

    const toggleColorMode = () => {
        setColorMode(prev => prev === 'color' ? 'binary' : 'color');
        setActivePreset(null);
    };

    const handleSave = () => {
        if (svgPreview && svgString) {
            onSave(svgPreview, svgString);
        }
    };

    const formatSize = (bytes: number): string => {
        if (bytes < 1024) return `${bytes} B`;
        const kb = bytes / 1024;
        if (kb < 1024) return `${kb.toFixed(0)} KB`;
        return `${(kb / 1024).toFixed(1)} MB`;
    };

    const smoothnessLabel = smoothness <= 20 ? 'حاد' :
        smoothness <= 40 ? 'خفيف' :
            smoothness <= 60 ? 'متوسط' :
                smoothness <= 80 ? 'ناعم' : 'سلس جداً';

    const colorLabel = colorPrecision <= 3 ? 'قليل' :
        colorPrecision <= 5 ? 'متوسط' :
            colorPrecision <= 7 ? 'غني' : 'كامل';

    const isColor = colorMode === 'color';

    return (
        <div className="absolute inset-0 flex flex-col z-[100] rounded-2xl overflow-hidden">
            {/* Top Bar */}
            <div className="h-10 bg-slate-900/90 border-b border-white/5 flex items-center justify-between px-3 shrink-0 z-20">
                <div className="flex items-center gap-2">
                    <PenTool className="w-3.5 h-3.5 text-rose-400" />
                    <span className="text-[11px] font-bold text-white">Vector</span>
                    {hasProcessed && svgSize > 0 && (
                        <span className="text-[9px] text-slate-500 font-medium">
                            {formatSize(svgSize)} · {pathCount.toLocaleString()} path{pathCount !== 1 ? 's' : ''}
                        </span>
                    )}
                </div>
                <div className="flex items-center gap-1.5">
                    <button
                        onClick={onCancel}
                        className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                        title="إلغاء"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!hasProcessed || isProcessing}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-rose-600 hover:bg-rose-500 disabled:opacity-40 disabled:hover:bg-rose-600 text-white text-[10px] font-bold shadow-sm transition-all active:scale-95"
                    >
                        <Check className="w-3 h-3" />
                        <span>حفظ</span>
                    </button>
                </div>
            </div>

            {/* Preview Area — hold to compare with original */}
            <div
                className="flex-1 relative overflow-hidden flex items-center justify-center min-h-0 bg-[#0c0c14]"
                onMouseDown={() => hasProcessed && setShowOriginal(true)}
                onMouseUp={() => setShowOriginal(false)}
                onMouseLeave={() => setShowOriginal(false)}
            >
                {/* Checkerboard background for transparency */}
                <div className="absolute inset-0 opacity-[0.03]"
                    style={{
                        backgroundImage: `
                            linear-gradient(45deg, #fff 25%, transparent 25%),
                            linear-gradient(-45deg, #fff 25%, transparent 25%),
                            linear-gradient(45deg, transparent 75%, #fff 75%),
                            linear-gradient(-45deg, transparent 75%, #fff 75%)
                        `,
                        backgroundSize: '20px 20px',
                        backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px'
                    }}
                />

                {/* Image display */}
                {svgPreview && !showOriginal ? (
                    <img
                        src={svgPreview}
                        className="max-w-full max-h-full object-contain block p-3 relative z-10"
                        alt="SVG preview"
                        draggable={false}
                    />
                ) : (
                    <img
                        src={originalUrl}
                        className={`max-w-full max-h-full object-contain block p-3 relative z-10 ${!svgPreview ? 'opacity-50' : ''}`}
                        alt="Original"
                        draggable={false}
                    />
                )}

                {/* Compare hint badge */}
                {hasProcessed && !isProcessing && (
                    <div className={`absolute bottom-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 px-2 py-0.5 rounded-full transition-all duration-150 select-none pointer-events-none ${showOriginal ? 'bg-rose-500/80 text-white' : 'bg-black/40 text-slate-400'}`}>
                        <Eye className="w-2.5 h-2.5" />
                        <span className="text-[8px] font-bold">{showOriginal ? 'الأصلية' : 'اضغط للمقارنة'}</span>
                    </div>
                )}

                {/* Processing overlay */}
                {isProcessing && (
                    <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center z-20">
                        <div className="relative">
                            <div className="absolute inset-0 animate-ping rounded-full bg-rose-500/20" style={{ animationDuration: '1.5s' }} />
                            <Loader2 className="w-8 h-8 text-rose-400 animate-spin relative z-10" />
                        </div>
                        <span className="text-xs text-slate-300 mt-3 font-medium">جاري التحويل...</span>
                    </div>
                )}

                {/* Error overlay */}
                {error && (
                    <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center z-20">
                        <span className="text-xs text-red-400 text-center px-4">{error}</span>
                        <button onClick={() => processRef.current()} className="mt-2 text-[10px] text-rose-300 underline hover:text-white">إعادة المحاولة</button>
                    </div>
                )}
            </div>

            {/* Controls Panel */}
            <div className="bg-slate-900/95 border-t border-white/5 px-3 py-2 shrink-0 space-y-2">
                {/* Presets Row */}
                <div className="flex items-center gap-1.5">
                    {(Object.entries(PRESETS) as [Preset, typeof PRESETS[Preset]][]).map(([key, p]) => (
                        <button
                            key={key}
                            onClick={() => handlePreset(key)}
                            className={`
                                flex-1 py-1 rounded-md text-[9px] font-bold transition-all
                                ${activePreset === key
                                    ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30'
                                    : 'bg-slate-800/60 text-slate-500 border border-white/5 hover:text-slate-300'
                                }
                            `}
                        >
                            {p.label}
                        </button>
                    ))}
                </div>

                {/* Smoothness Slider */}
                <div className="space-y-0.5">
                    <div className="flex items-center justify-between">
                        <span className="text-[9px] font-bold text-slate-500">النعومة</span>
                        <span className="text-[9px] text-rose-400 font-medium">{smoothnessLabel}</span>
                    </div>
                    <input
                        type="range" min="0" max="100" value={smoothness}
                        onChange={(e) => handleSmoothnessChange(Number(e.target.value))}
                        className="w-full h-1 rounded-full appearance-none cursor-pointer
                            bg-gradient-to-r from-slate-700 via-rose-900/50 to-rose-500
                            [&::-webkit-slider-thumb]:appearance-none
                            [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                            [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
                            [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-rose-500
                            [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:shadow-rose-500/30
                            [&::-webkit-slider-thumb]:transition-transform
                            [&::-webkit-slider-thumb]:hover:scale-125 [&::-webkit-slider-thumb]:active:scale-110
                        "
                    />
                </div>

                {/* Color row: label + inline switch + (slider if color mode) */}
                <div className="space-y-0.5">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-[9px] font-bold text-slate-500">
                                {isColor ? 'عدد الألوان' : 'أبيض/أسود'}
                            </span>
                            {/* Inline toggle switch */}
                            <button
                                onClick={toggleColorMode}
                                className="relative w-6 h-3 rounded-full transition-colors duration-200 shrink-0"
                                style={{ backgroundColor: isColor ? 'rgb(245 158 11 / 0.4)' : 'rgb(51 65 85 / 0.8)' }}
                                title={isColor ? 'تحويل لأبيض/أسود' : 'تحويل لألوان'}
                            >
                                <div
                                    className="absolute top-0.5 w-2 h-2 rounded-full bg-white shadow-sm transition-all duration-200"
                                    style={{ left: isColor ? '14px' : '2px' }}
                                />
                            </button>
                        </div>
                        {isColor && (
                            <span className="text-[9px] text-amber-400 font-medium">{colorLabel}</span>
                        )}
                    </div>
                    {isColor && (
                        <input
                            type="range" min="2" max="8" value={colorPrecision}
                            onChange={(e) => handleColorPrecisionChange(Number(e.target.value))}
                            className="w-full h-1 rounded-full appearance-none cursor-pointer
                                bg-gradient-to-r from-slate-700 via-amber-900/50 to-amber-500
                                [&::-webkit-slider-thumb]:appearance-none
                                [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3
                                [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white
                                [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-amber-500
                                [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:shadow-amber-500/30
                                [&::-webkit-slider-thumb]:transition-transform
                                [&::-webkit-slider-thumb]:hover:scale-125 [&::-webkit-slider-thumb]:active:scale-110
                            "
                        />
                    )}
                </div>
            </div>
        </div>
    );
};
