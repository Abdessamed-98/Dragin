import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Scaling, Upload, Loader2, Download, Trash2, Copy, Check, ClipboardPaste, AlertCircle, Image as ImageIcon, Link2, Unlink2 } from 'lucide-react';
import { resizeImage, getFileThumbnail } from '../../services/api';
import { saveOutputs } from '../../services/saveOutput';
import { useI18n } from '../../i18n/I18nContext';
import { ToolHeader } from '../ToolHeader';
import { ToolIconButton } from '../ToolIconButton';

interface ResizeToolProps {
    onClose: () => void;
    droppedFiles: File[];
    dropGeneration: number;
    onItemCountChange?: (count: number) => void;
    clearGen?: number;
}

interface ResizeItem {
    id: string;
    file: File;
    name: string;
    status: 'idle' | 'processing' | 'done' | 'error';
    previewUrl?: string;
    previewNeedsRevoke?: boolean;
    srcW?: number;
    srcH?: number;
    resultDataUrl?: string;
    resultW?: number;
    resultH?: number;
    error?: string;
}

const genId = () => Math.random().toString(36).substring(2, 11);
const PRESETS = [3840, 2560, 1920, 1280, 640]; // 4K · QHD · 1080p · 720p · thumbnail
// Aspect modes. 'original' = keep the image's own ratio (scale, no crop).
// 'free' = unlocked, W/H independent. Others = cover-crop to that exact shape.
const ASPECTS: { v: string; label: string }[] = [
    { v: 'original', label: 'Auto' },
    { v: '1:1', label: '1:1' },
    { v: '4:3', label: '4:3' },
    { v: '3:2', label: '3:2' },
    { v: '16:9', label: '16:9' },
    { v: '3:4', label: '3:4' },
    { v: '4:5', label: '4:5' },
    { v: '9:16', label: '9:16' },
];
const isImg = (f: File) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|tiff?|gif)$/i.test(f.name);
// Target height for a given width under a mode (null = caller decides, e.g. free/unknown).
const heightFor = (w: number, mode: string, srcRatio: number | null): number | null => {
    if (mode === 'free') return null;
    if (mode === 'original') return srcRatio ? Math.max(1, Math.round(w / srcRatio)) : null;
    const [rw, rh] = mode.split(':').map(Number);
    return Math.max(1, Math.round(w * rh / rw));
};
const widthFor = (h: number, mode: string, srcRatio: number | null): number | null => {
    if (mode === 'free' || mode === 'original') return mode === 'original' && srcRatio ? Math.max(1, Math.round(h * srcRatio)) : null;
    const [rw, rh] = mode.split(':').map(Number);
    return Math.max(1, Math.round(h * rw / rh));
};
// Signature of the current target — used to skip redundant reprocessing (e.g. blur with no change).
const sigOf = (w: number, h: number, m: string) => m === 'free' ? `f:${w}x${h}` : m === 'original' ? `o:${w}` : `${m}:${w}`;

export const ResizeTool: React.FC<ResizeToolProps> = ({ onClose, droppedFiles, dropGeneration, onItemCountChange, clearGen = 0 }) => {
    const { t } = useI18n();
    const [files, setFiles] = useState<ResizeItem[]>([]);
    const [width, setWidth] = useState(1920);
    const [height, setHeight] = useState(1080);
    const [mode, setMode] = useState('original'); // 'original' | 'free' | '1:1' | '4:3' | ...
    const [activeField, setActiveField] = useState<'width' | 'height'>('width'); // which field the presets target
    const [customChip, setCustomChip] = useState<number | null>(() => {
        try { const v = Number(localStorage.getItem('resizeCustomChip')); return v && !PRESETS.includes(v) ? v : null; } catch { return null; }
    });
    const [isDragOver, setIsDragOver] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [isCopying, setIsCopying] = useState(false);
    const [copied, setCopied] = useState(false);

    const widthRef = useRef(width); useEffect(() => { widthRef.current = width; }, [width]);
    const heightRef = useRef(height); useEffect(() => { heightRef.current = height; }, [height]);
    const modeRef = useRef(mode); useEffect(() => { modeRef.current = mode; }, [mode]);
    const lastSigRef = useRef(''); // last target signature actually processed
    useEffect(() => { onItemCountChange?.(files.length); }, [files.length, onItemCountChange]);

    // Representative source ratio (W/H): a number when all loaded images share it, else null.
    const srcRatio = (() => {
        const rs = files.map(f => (f.srcW && f.srcH) ? f.srcW / f.srcH : null).filter((x): x is number => x != null);
        if (!rs.length) return null;
        return rs.every(r => Math.abs(r - rs[0]) < 0.001) ? rs[0] : null;
    })();
    const heightUnknown = mode === 'original' && srcRatio == null; // batch of mixed ratios → per-image auto height

    const processOne = useCallback(async (item: ResizeItem, w: number, h: number, m: string) => {
        setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'processing' } : f));
        try {
            let opts: import('../../services/api').ResizeOptions;
            if (m === 'original') {
                opts = { width: w, mode: 'width' };                 // scale by width, keep each image's ratio
            } else if (m === 'free') {
                opts = { width: w, height: h, mode: 'fill' };        // exact W×H, cover-crop (no distortion)
            } else {
                const [rw, rh] = m.split(':').map(Number);
                opts = { width: w, height: Math.max(1, Math.round(w * rh / rw)), mode: 'fill' };
            }
            const r = await resizeImage(item.file, opts);
            setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'done', resultDataUrl: r.dataUrl, resultW: r.width, resultH: r.height } : f));
        } catch (e: any) {
            setFiles(prev => prev.map(f => f.id === item.id ? { ...f, status: 'error', error: e?.message } : f));
        }
    }, []);

    const addFiles = useCallback(async (incoming: File[]) => {
        const items: ResizeItem[] = [];
        for (const file of incoming) {
            if (!isImg(file)) continue;
            let previewUrl: string | undefined; let previewNeedsRevoke = false;
            try { const r = await getFileThumbnail(file, 64); if (r) { previewUrl = r.url; previewNeedsRevoke = r.needsRevoke; } } catch {}
            let srcW: number | undefined, srcH: number | undefined;
            try { const bmp = await createImageBitmap(file); srcW = bmp.width; srcH = bmp.height; bmp.close(); } catch {}
            items.push({ id: genId(), file, name: file.name, status: 'idle', previewUrl, previewNeedsRevoke, srcW, srcH });
        }
        if (!items.length) return;
        setFiles(prev => [...prev, ...items]);
        lastSigRef.current = sigOf(widthRef.current, heightRef.current, modeRef.current);
        items.forEach(it => processOne(it, widthRef.current, heightRef.current, modeRef.current));
    }, [processOne]);

    // Forward dropped files from DockApp
    const lastDrop = useRef(dropGeneration);
    useEffect(() => {
        if (dropGeneration === 0 || dropGeneration === lastDrop.current) return;
        lastDrop.current = dropGeneration;
        if (droppedFiles.length) addFiles(droppedFiles);
    }, [dropGeneration]); // eslint-disable-line react-hooks/exhaustive-deps

    // Global clear
    const lastClear = useRef(clearGen);
    useEffect(() => {
        if (clearGen === 0 || clearGen === lastClear.current) return;
        lastClear.current = clearGen;
        setFiles(prev => { prev.forEach(f => { if (f.previewUrl && f.previewNeedsRevoke) URL.revokeObjectURL(f.previewUrl); }); return []; });
    }, [clearGen]);

    const reprocessAll = (w: number, h: number, m: string) => {
        const sig = sigOf(w, h, m);
        if (sig === lastSigRef.current) return; // nothing actually changed — don't re-run the batch
        lastSigRef.current = sig;
        setFiles(prev => prev.map(f => ({ ...f, status: 'idle' as const })));
        setTimeout(() => setFiles(prev => { prev.filter(f => f.status === 'idle').forEach(f => processOne(f, w, h, m)); return prev; }), 0);
    };

    // Keep Height locked to Width while proportions are constrained (any mode but 'free').
    useEffect(() => {
        if (mode === 'free') return;
        const h = heightFor(width, mode, srcRatio);
        if (h != null && h !== height) { setHeight(h); heightRef.current = h; }
    }, [mode, width, srcRatio]); // eslint-disable-line react-hooks/exhaustive-deps

    // Remember the last hand-typed value as a quick chip (skip the fixed presets).
    const rememberCustom = (v: number) => {
        if (PRESETS.includes(v) || v < 16 || v === customChip) return;
        setCustomChip(v);
        try { localStorage.setItem('resizeCustomChip', String(v)); } catch {}
    };

    const applyWidth = (w: number) => {
        w = Math.max(1, w); setWidth(w); widthRef.current = w; rememberCustom(w);
        const h = heightFor(w, modeRef.current, srcRatio); if (h != null) heightRef.current = h;
        reprocessAll(w, heightRef.current, modeRef.current);
    };
    const applyHeight = (h: number) => {
        h = Math.max(1, h); setHeight(h); heightRef.current = h; rememberCustom(h);
        if (modeRef.current !== 'free') {
            const w = widthFor(h, modeRef.current, srcRatio);
            if (w != null) { setWidth(w); widthRef.current = w; }
        }
        reprocessAll(widthRef.current, h, modeRef.current);
    };
    const applyMode = (m: string) => {
        setMode(m); modeRef.current = m;
        const h = heightFor(widthRef.current, m, srcRatio); if (h != null) { setHeight(h); heightRef.current = h; }
        reprocessAll(widthRef.current, heightRef.current, m);
    };
    const toggleLink = () => applyMode(mode === 'free' ? 'original' : 'free');

    const handleDownload = async () => {
        const done = files.filter(f => f.status === 'done' && f.resultDataUrl);
        if (!done.length) return;
        setIsDownloading(true);
        try {
            await saveOutputs(done.map(item => ({
                name: `${item.name.replace(/\.[^.]+$/, '')}_${item.resultW}x${item.resultH}${item.name.match(/\.[^.]+$/)?.[0] || '.png'}`,
                url: item.resultDataUrl!,
                originalPath: (item.file as any).path ?? null,
            })), 'resized');
        } catch (e) { console.error('Save failed', e); } finally { setIsDownloading(false); }
    };

    const handleCopy = async () => {
        const done = files.filter(f => f.status === 'done' && f.resultDataUrl);
        if (!done.length || isCopying) return;
        setIsCopying(true);
        try {
            const items = done.map(item => ({ dataUrl: item.resultDataUrl!, name: `${item.name.replace(/\.[^.]+$/, '')}_${item.resultW}x${item.resultH}.png` }));
            if ((window as any).electron?.clipboardWrite) await (window as any).electron.clipboardWrite(items);
            setCopied(true); setTimeout(() => setCopied(false), 1500);
        } catch (e) { console.error(e); } finally { setIsCopying(false); }
    };

    const handlePaste = async () => {
        try {
            if ((window as any).electron?.clipboardRead) {
                const clip = await (window as any).electron.clipboardRead();
                if (clip.length) {
                    const fs = await Promise.all(clip.map(async ({ dataUrl, name }: any) => new File([await (await fetch(dataUrl)).blob()], name)));
                    addFiles(fs); return;
                }
            }
        } catch {}
    };

    const onDrop = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); const f = Array.from(e.dataTransfer.files); if (f.length) addFiles(f); };
    const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files?.length) addFiles(Array.from(e.target.files)); e.target.value = ''; };

    const hasFiles = files.length > 0;
    const anyDone = files.some(f => f.status === 'done');
    const anyProcessing = files.some(f => f.status === 'processing');
    // CSS aspect-ratio for preview cells so the chosen shape is visible at a glance.
    const cellAspect = mode === 'original' ? (srcRatio ? String(srcRatio) : '1 / 1')
        : mode === 'free' ? `${width} / ${Math.max(1, height)}`
        : mode.replace(':', ' / ');
    // Quick presets drive whichever field was last focused (Height only when it's editable).
    const presetField: 'width' | 'height' = activeField === 'height' && !heightUnknown ? 'height' : 'width';
    // For a single image we know its source size — disable presets that would only upscale.
    const srcDim = files.length === 1 ? (presetField === 'height' ? files[0].srcH : files[0].srcW) : undefined;
    const isOversize = (p: number) => srcDim != null && p > srcDim;

    return (
        <div className="absolute inset-0 flex flex-col rounded-2xl overflow-hidden"
            onDrop={onDrop} onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={e => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setIsDragOver(false); }}>
            {/* Header */}
            <ToolHeader icon={<Scaling className="w-4 h-4 text-sky-400" />} title={t('resize.title')} count={files.length} onClose={onClose} />

            {/* Dimensions — Width × Height with a proportion lock */}
            <div className="px-4 py-3 border-b border-[var(--separator)] shrink-0">
                <div className="flex items-end gap-2">
                    {/* Width */}
                    <div className="flex-1 min-w-0">
                        <label className={`block text-[10px] font-bold uppercase tracking-wide mb-1 transition-colors ${activeField === 'width' ? 'text-sky-400' : 'text-[var(--text-3)]'}`}>{t('resize.width')}</label>
                        <div className={`flex items-center rounded-lg border bg-[var(--surface)] px-2.5 transition-colors ${activeField === 'width' ? 'border-sky-500/60' : 'border-[var(--separator)]'} focus-within:border-sky-500`}>
                            <input type="number" value={width} min={1} max={20000}
                                onFocus={() => setActiveField('width')}
                                onChange={e => setWidth(Math.max(1, Number(e.target.value)))}
                                onBlur={() => applyWidth(width)}
                                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                className="w-full py-1.5 bg-transparent text-sm font-semibold text-[var(--text)] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
                            <span className="text-[10px] text-[var(--text-3)] pl-1">px</span>
                        </div>
                    </div>
                    {/* Proportion lock */}
                    <button onClick={toggleLink}
                        title={mode === 'free' ? t('resize.lockHint') : t('resize.unlockHint')}
                        className={`mb-0.5 p-2 rounded-lg border transition-colors ${mode !== 'free' ? 'border-sky-500/60 bg-sky-500/10 text-sky-400' : 'border-[var(--separator)] bg-[var(--surface)] text-[var(--text-3)] hover:text-[var(--text)]'}`}>
                        {mode !== 'free' ? <Link2 className="w-3.5 h-3.5" /> : <Unlink2 className="w-3.5 h-3.5" />}
                    </button>
                    {/* Height */}
                    <div className="flex-1 min-w-0">
                        <label className={`block text-[10px] font-bold uppercase tracking-wide mb-1 transition-colors ${activeField === 'height' && !heightUnknown ? 'text-sky-400' : 'text-[var(--text-3)]'}`}>{t('resize.height')}</label>
                        <div className={`flex items-center rounded-lg border bg-[var(--surface)] px-2.5 transition-colors ${heightUnknown ? 'border-[var(--separator)] opacity-60' : (activeField === 'height' ? 'border-sky-500/60' : 'border-[var(--separator)]') + ' focus-within:border-sky-500'}`}>
                            <input type="number" value={heightUnknown ? '' : height} min={1} max={20000} disabled={heightUnknown}
                                placeholder={heightUnknown ? 'auto' : undefined}
                                onFocus={() => setActiveField('height')}
                                onChange={e => setHeight(Math.max(1, Number(e.target.value)))}
                                onBlur={() => { if (!heightUnknown) applyHeight(height); }}
                                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                className="w-full py-1.5 bg-transparent text-sm font-semibold text-[var(--text)] placeholder:text-[var(--text-3)] placeholder:font-normal focus:outline-none disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
                            <span className="text-[10px] text-[var(--text-3)] pl-1">px</span>
                        </div>
                    </div>
                </div>
                {/* Quick presets — apply to the active field (Width or Height) */}
                <div className="flex items-center gap-1 mt-2">
                    {PRESETS.map(p => {
                        const over = isOversize(p);
                        return (
                            <button key={p} disabled={over} onMouseDown={e => e.preventDefault()}
                                onClick={over ? undefined : () => presetField === 'height' ? applyHeight(p) : applyWidth(p)}
                                title={over ? t('resize.tooLarge') : undefined}
                                className={`flex-1 py-1 rounded-md text-[11px] font-semibold border transition-colors ${over ? 'opacity-35 cursor-not-allowed border-[var(--separator)] bg-[var(--surface)] text-[var(--text-3)]' : (presetField === 'height' ? height : width) === p ? 'border-sky-500/50 bg-sky-500/10 text-sky-300' : 'border-[var(--separator)] bg-[var(--surface)] text-[var(--text-3)] hover:text-[var(--text)]'}`}>{p}</button>
                        );
                    })}
                    {customChip != null && (() => {
                        const over = isOversize(customChip);
                        return (
                            <button disabled={over} onMouseDown={e => e.preventDefault()} title={over ? t('resize.tooLarge') : t('resize.yourSize')}
                                onClick={over ? undefined : () => presetField === 'height' ? applyHeight(customChip) : applyWidth(customChip)}
                                className={`flex-1 py-1 rounded-md text-[11px] font-semibold border border-dashed transition-colors ${over ? 'opacity-35 cursor-not-allowed border-[var(--separator)] bg-[var(--surface)] text-[var(--text-3)]' : (presetField === 'height' ? height : width) === customChip ? 'border-sky-500/60 bg-sky-500/10 text-sky-300' : 'border-[var(--border-2)] bg-[var(--surface)] text-[var(--text-3)] hover:text-[var(--text)]'}`}>{customChip}</button>
                        );
                    })()}
                </div>
            </div>

            {/* Aspect ratio — sets the locked shape */}
            <div className="px-4 pt-2.5 pb-3 border-b border-[var(--separator)] shrink-0">
                <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-[var(--text-2)]">{t('resize.aspect')}</span>
                    <span className="text-[10px] font-medium text-[var(--text-3)]">{mode === 'original' ? t('resize.keepsRatio') : mode === 'free' ? t('resize.freeHint') : t('resize.cropsToFill')}</span>
                </div>
                <div className="flex items-stretch gap-1.5">
                    {ASPECTS.map(a => {
                        const act = mode === a.v;
                        let box: { w: number; h: number } | null = null;
                        if (a.v !== 'original') {
                            const [rw, rh] = a.v.split(':').map(Number);
                            const mm = 17;
                            box = rw >= rh ? { w: mm, h: Math.max(3, Math.round(mm * rh / rw)) } : { w: Math.max(3, Math.round(mm * rw / rh)), h: mm };
                        }
                        return (
                            <button key={a.v} onClick={() => applyMode(a.v)}
                                className={`flex-1 flex flex-col items-center justify-end gap-1.5 py-2 rounded-xl border transition-all ${act ? 'border-sky-500/60 bg-sky-500/10' : 'border-[var(--separator)] bg-[var(--surface)] hover:border-[var(--border-2)]'}`}>
                                <div className="h-[17px] flex items-center justify-center">
                                    {box
                                        ? <div style={{ width: box.w, height: box.h }} className={`rounded-[2px] border-[1.5px] ${act ? 'border-sky-400' : 'border-[var(--text-3)]'}`} />
                                        : <ImageIcon className={`w-[17px] h-[17px] ${act ? 'text-sky-400' : 'text-[var(--text-3)]'}`} strokeWidth={1.75} />}
                                </div>
                                <span className={`text-[10px] font-semibold leading-none ${act ? 'text-sky-300' : 'text-[var(--text-3)]'}`}>{a.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Body */}
            <div className="flex-1 flex flex-col min-h-0 p-3 gap-2">
                {!hasFiles && (
                    <label htmlFor="resize-input" className={`flex-1 flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed cursor-pointer transition-all ${isDragOver ? 'border-sky-400 bg-sky-500/10' : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-2)]'}`}>
                        <div className={`p-4 rounded-2xl ${isDragOver ? 'bg-sky-500/20' : 'bg-[var(--surface-2)]'}`}>{isDragOver ? <Upload className="w-8 h-8 text-sky-400" /> : <Scaling className="w-8 h-8 text-[var(--text-3)]" />}</div>
                        <div className="text-center px-4">
                            <p className="text-sm font-semibold text-[var(--text-2)]">{t('resize.drop')}</p>
                            <p className="text-[10px] text-[var(--text-3)] mt-2">{t('resize.formats')}</p>
                        </div>
                        <input id="resize-input" type="file" accept="image/*" multiple className="sr-only" onChange={onFileInput} />
                    </label>
                )}

                {files.length === 1 && (
                    <div className="flex-1 relative min-h-0 rounded-xl overflow-hidden bg-black/20 border border-[var(--separator)]">
                        {(files[0].resultDataUrl || files[0].previewUrl) ? (
                            <img src={files[0].resultDataUrl || files[0].previewUrl} className="w-full h-full object-contain" alt="" draggable={false} />
                        ) : <div className="w-full h-full flex items-center justify-center"><Scaling className="w-8 h-8 text-sky-400/40" /></div>}
                        {files[0].status === 'processing' && <div className="absolute inset-0 bg-black/50 flex items-center justify-center"><Loader2 className="w-8 h-8 text-sky-400 animate-spin" /></div>}
                        {files[0].status === 'done' && <div className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[11px] bg-black/60 text-white px-2 py-0.5 rounded-full">{files[0].resultW}×{files[0].resultH}</div>}
                        {files[0].status === 'error' && <div className="absolute inset-0 flex flex-col items-center justify-center bg-red-950/70 gap-2"><AlertCircle className="w-8 h-8 text-red-400" /><span className="text-xs text-red-300">{files[0].error}</span></div>}
                    </div>
                )}

                {files.length > 1 && (
                    <div className="flex-1 min-h-0 overflow-y-auto -mr-1 pr-1"><div className="grid grid-cols-3 gap-1.5">
                        {files.map(item => (
                            <div key={item.id} style={{ aspectRatio: cellAspect }} className="relative rounded-lg border border-[var(--separator)] overflow-hidden bg-[var(--surface)]">
                                {(item.resultDataUrl || item.previewUrl) ? <img src={item.resultDataUrl || item.previewUrl} className={`w-full h-full object-cover ${item.status === 'processing' ? 'opacity-40' : ''}`} alt="" draggable={false} /> : <div className="w-full h-full flex items-center justify-center"><Scaling className="w-4 h-4 text-sky-400/40" /></div>}
                                {item.status === 'processing' && <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="w-5 h-5 text-sky-400 animate-spin" /></div>}
                                {item.status === 'error' && <div className="absolute inset-0 flex items-center justify-center bg-red-950/70"><AlertCircle className="w-4 h-4 text-red-400" /></div>}
                                {item.status === 'done' && <div className="absolute bottom-0.5 right-0.5 text-[8px] leading-none bg-black/65 text-white px-1 py-0.5 rounded">{item.resultW}×{item.resultH}</div>}
                            </div>
                        ))}
                        <label htmlFor="resize-add" style={{ aspectRatio: cellAspect }} className="rounded-lg border border-dashed border-[var(--border)] cursor-pointer flex items-center justify-center hover:border-[var(--border-2)]"><Upload className="w-4 h-4 text-[var(--text-3)]" /><input id="resize-add" type="file" accept="image/*" multiple className="sr-only" onChange={onFileInput} /></label>
                    </div></div>
                )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-1.5 px-3 pb-3 shrink-0">
                <button onClick={handleDownload} disabled={!anyDone || isDownloading || anyProcessing}
                    className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all ${!anyDone || anyProcessing ? 'bg-[var(--surface-2)] text-[var(--text-3)] cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}>
                    {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}{t('resize.download')}
                </button>
                <div className="flex-1 flex items-center gap-1">
                    <ToolIconButton onClick={handleCopy} disabled={!anyDone || isCopying} title={t('resize.copy')}>{isCopying ? <Loader2 className="w-4 h-4 animate-spin" /> : copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}</ToolIconButton>
                    <ToolIconButton onClick={handlePaste} title={t('resize.paste')}><ClipboardPaste className="w-4 h-4" /></ToolIconButton>
                    <ToolIconButton onClick={() => { setFiles([]); onClose(); }} disabled={!hasFiles} danger title={t('resize.clear')}><Trash2 className="w-4 h-4" /></ToolIconButton>
                </div>
            </div>
        </div>
    );
};
