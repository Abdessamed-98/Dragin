
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Check, X, Loader2, PenTool, Sun, Moon } from 'lucide-react';
import { VectorizeOptions, vectorizeImage } from '../../services/api';

interface VectorizerToolProps {
    file: File;
    originalUrl: string;
    onSave: (svgDataUrl: string, svgString: string) => void;
    onCancel: () => void;
}

export const VectorizerTool: React.FC<VectorizerToolProps> = ({
    file,
    originalUrl,
    onSave,
    onCancel
}) => {
    // --- State ---
    const [smoothness, setSmoothness] = useState(50); // 0-100 slider
    const [colorMode, setColorMode] = useState<'color' | 'binary'>('color');
    const [isProcessing, setIsProcessing] = useState(false);
    const [svgPreview, setSvgPreview] = useState<string | null>(null);
    const [svgString, setSvgString] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [hasProcessed, setHasProcessed] = useState(false);

    const abortRef = useRef(false);

    // Map smoothness 0-100 to vtracer parameters
    // Low smoothness = jagged/sharp, High smoothness = very smooth curves
    const getVtracerOptions = useCallback((): Partial<VectorizeOptions> => {
        // corner_threshold: 0-180 degrees. Higher = smoother (more corners become curves)
        // At smoothness=0  → corner_threshold=10 (sharp, keeps corners)
        // At smoothness=100 → corner_threshold=170 (smooth, rounds everything)
        const corner_threshold = Math.round(10 + (smoothness / 100) * 160);

        // splice_threshold: 0-180 degrees. Higher = smoother curve junctions
        const splice_threshold = Math.round(10 + (smoothness / 100) * 160);

        // length_threshold: Controls segment length sensitivity
        // Higher = smoother but less detail
        const length_threshold = 2.0 + (smoothness / 100) * 8.0;

        // filter_speckle: Remove noise. Slightly higher at max smoothness
        const filter_speckle = Math.round(2 + (smoothness / 100) * 8);

        // color_precision: bits for color, less at higher smoothness for cleaner look
        const color_precision = colorMode === 'binary' ? 1 : Math.max(3, Math.round(8 - (smoothness / 100) * 4));

        return {
            colormode: colorMode,
            corner_threshold,
            splice_threshold,
            length_threshold,
            filter_speckle,
            color_precision,
            path_precision: 8,
        };
    }, [smoothness, colorMode]);

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

    // Auto-process on first load
    useEffect(() => {
        processImage();
        return () => { abortRef.current = true; };
    }, []); // Only on mount

    // --- Handlers ---
    const handleApply = () => {
        processImage();
    };

    const handleSave = () => {
        if (svgPreview && svgString) {
            onSave(svgPreview, svgString);
        }
    };

    const smoothnessLabel = smoothness <= 20 ? 'حاد' :
        smoothness <= 40 ? 'خفيف' :
            smoothness <= 60 ? 'متوسط' :
                smoothness <= 80 ? 'ناعم' : 'سلس جداً';

    return (
        <div className="absolute inset-0 flex flex-col z-[100] rounded-2xl overflow-hidden">
            {/* Compact Top Bar */}
            <div className="h-10 bg-slate-900/90 border-b border-white/5 flex items-center justify-between px-3 shrink-0 z-20">
                <div className="flex items-center gap-2">
                    <PenTool className="w-3.5 h-3.5 text-rose-400" />
                    <span className="text-[11px] font-bold text-white">Vector</span>
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

            {/* Preview Area */}
            <div className="flex-1 relative overflow-hidden flex items-center justify-center min-h-0 bg-[#0c0c14]">
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
                {svgPreview ? (
                    <img
                        src={svgPreview}
                        className="max-w-full max-h-full object-contain block p-3 relative z-10"
                        alt="SVG preview"
                    />
                ) : (
                    <img
                        src={originalUrl}
                        className="max-w-full max-h-full object-contain block p-3 relative z-10 opacity-50"
                        alt="Original"
                    />
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
                        <button onClick={handleApply} className="mt-2 text-[10px] text-rose-300 underline hover:text-white">إعادة المحاولة</button>
                    </div>
                )}
            </div>

            {/* Controls Panel */}
            <div className="bg-slate-900/95 border-t border-white/5 px-3 py-2.5 shrink-0 space-y-2.5">
                {/* Smoothness Slider */}
                <div className="space-y-1">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">النعومة</span>
                        <span className="text-[10px] text-rose-300 font-medium">{smoothnessLabel}</span>
                    </div>
                    <div className="relative group/slider">
                        <input
                            type="range"
                            min="0"
                            max="100"
                            value={smoothness}
                            onChange={(e) => setSmoothness(Number(e.target.value))}
                            className="w-full h-1.5 rounded-full appearance-none cursor-pointer
                                bg-gradient-to-r from-slate-700 via-rose-900/50 to-rose-500
                                [&::-webkit-slider-thumb]:appearance-none
                                [&::-webkit-slider-thumb]:w-3.5
                                [&::-webkit-slider-thumb]:h-3.5
                                [&::-webkit-slider-thumb]:rounded-full
                                [&::-webkit-slider-thumb]:bg-white
                                [&::-webkit-slider-thumb]:border-2
                                [&::-webkit-slider-thumb]:border-rose-500
                                [&::-webkit-slider-thumb]:shadow-md
                                [&::-webkit-slider-thumb]:shadow-rose-500/30
                                [&::-webkit-slider-thumb]:transition-transform
                                [&::-webkit-slider-thumb]:hover:scale-125
                                [&::-webkit-slider-thumb]:active:scale-110
                            "
                        />
                    </div>
                </div>

                {/* Color Mode Toggle + Apply Button */}
                <div className="flex items-center gap-2">
                    {/* Color/BW Toggle */}
                    <button
                        onClick={() => setColorMode(prev => prev === 'color' ? 'binary' : 'color')}
                        className={`
                            flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold transition-all flex-1 justify-center
                            ${colorMode === 'color'
                                ? 'bg-gradient-to-r from-rose-500/20 to-amber-500/20 text-rose-200 border border-rose-500/20'
                                : 'bg-slate-800 text-slate-300 border border-white/10'
                            }
                        `}
                    >
                        {colorMode === 'color' ? (
                            <>
                                <Sun className="w-3 h-3" />
                                <span>ألوان</span>
                            </>
                        ) : (
                            <>
                                <Moon className="w-3 h-3" />
                                <span>أبيض/أسود</span>
                            </>
                        )}
                    </button>

                    {/* Apply Button */}
                    <button
                        onClick={handleApply}
                        disabled={isProcessing}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 disabled:opacity-50 disabled:hover:bg-rose-600 text-white text-[10px] font-bold transition-all active:scale-95 flex-1 justify-center"
                    >
                        {isProcessing ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                            <>
                                <PenTool className="w-3 h-3" />
                                <span>تطبيق</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};
