
import React, { useState, useCallback } from 'react';
import { Check, RefreshCw, Loader2, Minimize2 } from 'lucide-react';
import { compressImage } from '../../services/api';

interface CompressorToolProps {
    file: File;
    initialResult: { url: string; originalSize: string; newSize: string; saved: string };
    onSave: (url: string, metadata: { originalSize: string; newSize: string; savedPercentage: string }) => void;
    onCancel: () => void;
}

export const CompressorTool: React.FC<CompressorToolProps> = ({
    file,
    initialResult,
    onSave,
    onCancel,
}) => {
    const [quality, setQuality] = useState(70);
    const [isProcessing, setIsProcessing] = useState(false);
    const [result, setResult] = useState(initialResult);
    const [error, setError] = useState<string | null>(null);

    const handleApply = useCallback(async () => {
        setIsProcessing(true);
        setError(null);
        try {
            const res = await compressImage(file, quality);
            setResult(res);
        } catch (err: any) {
            setError(err?.message || 'فشل الضغط');
        } finally {
            setIsProcessing(false);
        }
    }, [file, quality]);

    const qualityLabel = quality >= 85 ? 'عالية' : quality >= 65 ? 'متوسطة' : quality >= 40 ? 'منخفضة' : 'منخفضة جداً';

    return (
        <div className="absolute inset-0 flex flex-col rounded-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 shrink-0">
                <div className="flex items-center gap-2">
                    <Minimize2 className="w-4 h-4 text-emerald-400" />
                    <span className="text-sm font-bold text-white">ضغط الصورة</span>
                </div>
                <button onClick={onCancel} className="text-slate-500 hover:text-white transition-colors">
                    <span className="text-lg leading-none">×</span>
                </button>
            </div>

            {/* Preview */}
            <div className="flex-1 flex items-center justify-center p-4 min-h-0 bg-[repeating-conic-gradient(#1e293b_0%_25%,#0f172a_0%_50%)] bg-[length:16px_16px]">
                <img
                    src={result.url}
                    alt="preview"
                    className="max-w-full max-h-full object-contain rounded-lg shadow-xl"
                />
            </div>

            {/* Stats */}
            <div className="flex items-center justify-between px-4 py-2 bg-slate-800/50 border-t border-white/5 shrink-0">
                <span className="text-xs text-slate-400">{result.originalSize} → <span className="text-white font-bold">{result.newSize}</span></span>
                <span className="text-xs font-bold text-emerald-400">{result.saved} محفوظ</span>
            </div>

            {/* Quality slider */}
            <div className="px-4 py-3 border-t border-white/5 shrink-0">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-slate-400">الجودة</span>
                    <span className="text-xs font-bold text-emerald-400">{quality}% — {qualityLabel}</span>
                </div>
                <input
                    type="range"
                    min={10}
                    max={95}
                    step={5}
                    value={quality}
                    onChange={e => setQuality(Number(e.target.value))}
                    className="w-full accent-emerald-500 cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-slate-600 mt-1">
                    <span>أقل حجم</span>
                    <span>أعلى جودة</span>
                </div>
                {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-2 px-4 pb-4 shrink-0">
                <button
                    onClick={handleApply}
                    disabled={isProcessing}
                    className="flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-bold transition-all hover:scale-105 active:scale-95"
                >
                    {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                    {isProcessing ? 'جاري الضغط…' : 'تطبيق'}
                </button>
                <button
                    onClick={() => onSave(result.url, { originalSize: result.originalSize, newSize: result.newSize, savedPercentage: result.saved })}
                    disabled={isProcessing}
                    className="flex items-center justify-center gap-1.5 h-9 px-4 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 hover:text-white text-xs transition-colors border border-white/5"
                >
                    <Check className="w-3.5 h-3.5" />
                    حفظ
                </button>
            </div>
        </div>
    );
};
