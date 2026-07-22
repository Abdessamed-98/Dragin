/**
 * Shell tool descriptors — each tool reduced to { meta, Controls, process }.
 * The shell (ToolShell) owns the header, the shared grid, the footer, ingest,
 * and processing orchestration; a descriptor supplies only what's UNIQUE:
 *   • meta      — accent color, icon, accept filter, defaults
 *   • Controls  — the settings widgets (the rich per-tool UI)
 *   • process   — transform ONE file and applyResult (carries the output forward)
 *
 * Logic here is lifted from the standalone tools/ResizeTool, WatermarkTool,
 * MetadataTool (which stay in the repo, unused-for-shell, for easy rollback).
 */
import React from 'react';
import { LucideIcon, Scaling, Type, ShieldAlert, Image as ImageIcon, Link2, Unlink2, PenTool, Shapes, PenLine, LayoutGrid, Maximize2, Minimize2 } from 'lucide-react';
import { SessionFile, sessionStore } from '../../state/sessionStore';
import { toolAccepts } from '../../state/toolCompat';
import { resizeImage, addWatermark, scrubMetadata, vectorizeImage, compressImage, startUpscale, getUpscaleProgress, fetchUpscaleResultBlob, cleanupUpscaleJob, getUpscaleStatus } from '../../services/api';
import type { VectorizeOptions, UpscaleScale, UpscaleModel } from '../../services/api';
import { ToolId } from '../../types';

export interface ProcessResult { resultUrl: string; badge?: string }

export interface ControlsProps<S = any> {
    state: S;
    set: (patch: Partial<S>) => void;
    files: SessionFile[];
}

/** Props a FOCUS tool's Body receives — it renders the whole area below the
 *  header (preview/editor/result + its own actions) and reads the session live. */
export interface FocusBodyProps {
    files: SessionFile[];
    accent: string;
    inputAccept: string;
    onAddFiles: (files: File[]) => void;
    onClose: () => void;
}

export interface ShellTool<S = any> {
    id: ToolId;
    accent: string;
    Icon: LucideIcon;
    titleKey: string;
    /** 'grid' (default) = batch transform archetype; 'focus' = single-image
     *  (analyzer/editor) archetype rendered via Body. */
    kind?: 'grid' | 'focus';
    /** FOCUS tools only: renders the entire body (preview/editor/result + actions). */
    Body?: React.FC<FocusBodyProps>;
    /** FOCUS tools that render their OWN header/empty (wrapped legacy tools like
     *  pdf) — the shell skips its header + empty dropzone and hands the Body the
     *  whole panel. */
    hideHeader?: boolean;
    /** GRID tools: clicking a DONE cell opens this editor overlay for that file
     *  (remover magic-brush). */
    CellEditor?: React.FC<{ file: SessionFile; onClose: () => void }>;
    /** GRID tools: render cutout cells on a transparency checkerboard. */
    transparent?: boolean;
    /** Footer run-button label (grid tools). */
    actionLabelKey?: string;
    accept: (f: SessionFile) => boolean;
    inputAccept: string;
    emptyTitleKey: string;
    emptyHintKey?: string;
    defaults?: S;
    autoProcessDirect?: boolean;
    /** Max files processed at once (default 3). Lower for tools that each spawn a
     *  heavy backend process (upscaler/converter → 2). */
    concurrency?: number;
    canRun?: (state: S, files: SessionFile[]) => boolean;
    /** Optional backend capability probe (e.g. upscaler needs Real-ESRGAN). When
     *  it resolves false, the action is disabled and an unavailable note shows. */
    checkAvailable?: () => Promise<boolean>;
    /** i18n key for the "tool unavailable" note (paired with checkAvailable). */
    unavailableKey?: string;
    Controls?: React.FC<ControlsProps<S>>;
    /** GRID tools: transform ONE file (the tool's INPUT, not necessarily
     *  currentFile) and applyResult. Returns the result URL + a done-badge.
     *  `onProgress(pct)` (0–100) drives a determinate overlay for polled jobs. */
    process?: (item: { id: string; file: File; name: string }, state: S, onProgress?: (pct: number) => void) => Promise<ProcessResult>;
}

const isImg = (f: File) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|tiff?|gif)$/i.test(f.name);
const baseName = (name: string) => name.replace(/\.[^.]+$/, '');
const extOf = (name: string) => name.match(/\.[^.]+$/)?.[0] || '.png';

// ── RESIZE ───────────────────────────────────────────────────────────────────
interface ResizeState { width: number; height: number; mode: string; activeField: 'width' | 'height'; }
const PRESETS = [3840, 2560, 1920, 1280, 640];
const ASPECTS: { v: string; label: string }[] = [
    { v: 'original', label: 'Auto' }, { v: '1:1', label: '1:1' }, { v: '4:3', label: '4:3' },
    { v: '3:2', label: '3:2' }, { v: '16:9', label: '16:9' }, { v: '9:16', label: '9:16' },
];
const heightForRatio = (w: number, mode: string): number | null => {
    if (mode === 'free' || mode === 'original') return null;
    const [rw, rh] = mode.split(':').map(Number);
    return Math.max(1, Math.round(w * rh / rw));
};

const ResizeControls: React.FC<ControlsProps<ResizeState>> = ({ state, set }) => {
    const heightAuto = state.mode === 'original';
    const setWidth = (w: number) => {
        w = Math.max(1, w);
        const h = heightForRatio(w, state.mode);
        set(h != null ? { width: w, height: h } : { width: w });
    };
    const setHeight = (h: number) => set({ height: Math.max(1, h) });
    const applyMode = (m: string) => {
        const h = heightForRatio(state.width, m);
        set(h != null ? { mode: m, height: h } : { mode: m });
    };
    const preset = (p: number) => (state.activeField === 'height' && !heightAuto ? setHeight(p) : setWidth(p));

    return (
        <>
            <div className="px-4 py-3 border-b border-[var(--separator)] shrink-0">
                <div className="flex items-end gap-2">
                    <div className="flex-1 min-w-0">
                        <label className={`block text-[10px] font-bold uppercase tracking-wide mb-1 ${state.activeField === 'width' ? 'text-sky-400' : 'text-[var(--text-3)]'}`}>Width</label>
                        <div className={`flex items-center rounded-lg border bg-[var(--surface)] px-2.5 ${state.activeField === 'width' ? 'border-sky-500/60' : 'border-[var(--separator)]'} focus-within:border-sky-500`}>
                            <input type="number" value={state.width} min={1} max={20000}
                                onFocus={() => set({ activeField: 'width' })}
                                onChange={e => setWidth(Number(e.target.value))}
                                className="w-full py-1.5 bg-transparent text-sm font-semibold text-[var(--text)] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
                            <span className="text-[10px] text-[var(--text-3)] pl-1">px</span>
                        </div>
                    </div>
                    <button onClick={() => applyMode(state.mode === 'free' ? 'original' : 'free')}
                        className={`mb-0.5 p-2 rounded-lg border ${state.mode !== 'free' ? 'border-sky-500/60 bg-sky-500/10 text-sky-400' : 'border-[var(--separator)] bg-[var(--surface)] text-[var(--text-3)] hover:text-[var(--text)]'}`}>
                        {state.mode !== 'free' ? <Link2 className="w-3.5 h-3.5" /> : <Unlink2 className="w-3.5 h-3.5" />}
                    </button>
                    <div className="flex-1 min-w-0">
                        <label className={`block text-[10px] font-bold uppercase tracking-wide mb-1 ${state.activeField === 'height' && !heightAuto ? 'text-sky-400' : 'text-[var(--text-3)]'}`}>Height</label>
                        <div className={`flex items-center rounded-lg border bg-[var(--surface)] px-2.5 ${heightAuto ? 'border-[var(--separator)] opacity-60' : (state.activeField === 'height' ? 'border-sky-500/60' : 'border-[var(--separator)]') + ' focus-within:border-sky-500'}`}>
                            <input type="number" value={heightAuto ? '' : state.height} min={1} max={20000} disabled={heightAuto} placeholder={heightAuto ? 'auto' : undefined}
                                onFocus={() => set({ activeField: 'height' })}
                                onChange={e => setHeight(Number(e.target.value))}
                                className="w-full py-1.5 bg-transparent text-sm font-semibold text-[var(--text)] placeholder:text-[var(--text-3)] placeholder:font-normal focus:outline-none disabled:cursor-not-allowed [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none" />
                            <span className="text-[10px] text-[var(--text-3)] pl-1">px</span>
                        </div>
                    </div>
                </div>
                <div className="flex items-center gap-1 mt-2">
                    {PRESETS.map(p => (
                        <button key={p} onMouseDown={e => e.preventDefault()} onClick={() => preset(p)}
                            className={`flex-1 py-1 rounded-md text-[11px] font-semibold border ${(state.activeField === 'height' && !heightAuto ? state.height : state.width) === p ? 'border-sky-500/50 bg-sky-500/10 text-sky-300' : 'border-[var(--separator)] bg-[var(--surface)] text-[var(--text-3)] hover:text-[var(--text)]'}`}>{p}</button>
                    ))}
                </div>
            </div>
            <div className="px-4 pt-2.5 pb-3 border-b border-[var(--separator)] shrink-0">
                <div className="flex items-stretch gap-1.5">
                    {ASPECTS.map(a => {
                        const act = state.mode === a.v;
                        let box: { w: number; h: number } | null = null;
                        if (a.v !== 'original') {
                            const [rw, rh] = a.v.split(':').map(Number); const mm = 17;
                            box = rw >= rh ? { w: mm, h: Math.max(3, Math.round(mm * rh / rw)) } : { w: Math.max(3, Math.round(mm * rw / rh)), h: mm };
                        }
                        return (
                            <button key={a.v} onClick={() => applyMode(a.v)}
                                className={`flex-1 flex flex-col items-center justify-end gap-1.5 py-2 rounded-xl border ${act ? 'border-sky-500/60 bg-sky-500/10' : 'border-[var(--separator)] bg-[var(--surface)] hover:border-[var(--border-2)]'}`}>
                                <div className="h-[17px] flex items-center justify-center">
                                    {box ? <div style={{ width: box.w, height: box.h }} className={`rounded-[2px] border-[1.5px] ${act ? 'border-sky-400' : 'border-[var(--text-3)]'}`} />
                                        : <ImageIcon className={`w-[17px] h-[17px] ${act ? 'text-sky-400' : 'text-[var(--text-3)]'}`} strokeWidth={1.75} />}
                                </div>
                                <span className={`text-[10px] font-semibold leading-none ${act ? 'text-sky-300' : 'text-[var(--text-3)]'}`}>{a.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>
        </>
    );
};

const resizeTool: ShellTool<ResizeState> = {
    id: 'resize', accent: 'sky', Icon: Scaling, titleKey: 'resize.title', actionLabelKey: 'resize.run',
    accept: f => toolAccepts('resize', f) && isImg(f.currentFile), inputAccept: 'image/*',
    emptyTitleKey: 'resize.drop', emptyHintKey: 'resize.formats',
    defaults: { width: 1920, height: 1080, mode: 'original', activeField: 'width' },
    autoProcessDirect: true, Controls: ResizeControls,
    process: async ({ id, file, name }, s) => {
        let opts: import('../../services/api').ResizeOptions;
        if (s.mode === 'original') opts = { width: s.width, mode: 'width' };
        else if (s.mode === 'free') opts = { width: s.width, height: s.height, mode: 'fill' };
        else { const [rw, rh] = s.mode.split(':').map(Number); opts = { width: s.width, height: Math.max(1, Math.round(s.width * rh / rw)), mode: 'fill' }; }
        const r = await resizeImage(file, opts);
        await sessionStore.applyResult(id, r.dataUrl, `${baseName(name)}_${r.width}x${r.height}${extOf(name)}`, 'resize');
        return { resultUrl: r.dataUrl, badge: `${r.width}×${r.height}` };
    },
};

// ── WATERMARK ──────────────────────────────────────────────────────────────
interface WmState { text: string; opacity: number; fontSize: number; style: 'diagonal' | 'center' | 'corner'; color: string; }
const WM_STYLES: { v: WmState['style']; label: string }[] = [
    { v: 'diagonal', label: 'Tiled' }, { v: 'center', label: 'Center' }, { v: 'corner', label: 'Corner' },
];
const WatermarkControls: React.FC<ControlsProps<WmState>> = ({ state, set }) => (
    <div className="px-4 py-3 border-b border-[var(--separator)] shrink-0 space-y-2.5">
        <input value={state.text} onChange={e => set({ text: e.target.value })} placeholder="Watermark text…"
            className="w-full rounded-lg border border-[var(--separator)] bg-[var(--surface)] px-2.5 py-1.5 text-sm text-[var(--text)] focus:outline-none focus:border-cyan-500" />
        <div className="flex items-center gap-1.5">
            {WM_STYLES.map(st => (
                <button key={st.v} onClick={() => set({ style: st.v })}
                    className={`flex-1 py-1 rounded-md text-[11px] font-semibold border ${state.style === st.v ? 'border-cyan-500/60 bg-cyan-500/10 text-cyan-300' : 'border-[var(--separator)] bg-[var(--surface)] text-[var(--text-3)] hover:text-[var(--text)]'}`}>{st.label}</button>
            ))}
        </div>
        <div className="flex items-center gap-3">
            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-3)] w-14 shrink-0">Opacity</label>
            <input type="range" min={5} max={100} value={state.opacity} onChange={e => set({ opacity: Number(e.target.value) })} className="flex-1 accent-cyan-500" />
            <span className="text-[11px] text-[var(--text-2)] w-8 text-right">{state.opacity}%</span>
        </div>
        <div className="flex items-center gap-3">
            <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-3)] w-14 shrink-0">Size</label>
            <select value={state.fontSize} onChange={e => set({ fontSize: Number(e.target.value) })}
                className="flex-1 rounded-lg border border-[var(--separator)] bg-[var(--surface)] px-2 py-1 text-sm text-[var(--text)] focus:outline-none">
                {[16, 24, 36, 48, 64, 80].map(s => <option key={s} value={s}>{s}px</option>)}
            </select>
            <input type="color" value={state.color} onChange={e => set({ color: e.target.value })}
                className="w-8 h-8 rounded-lg border border-[var(--separator)] bg-transparent cursor-pointer" />
        </div>
    </div>
);

const watermarkTool: ShellTool<WmState> = {
    id: 'watermark', accent: 'cyan', Icon: Type, titleKey: 'watermark.title', actionLabelKey: 'watermark.apply',
    accept: f => toolAccepts('watermark', f) && isImg(f.currentFile), inputAccept: 'image/*',
    emptyTitleKey: 'watermark.title',
    defaults: { text: '', opacity: 30, fontSize: 36, style: 'diagonal', color: '#888888' },
    autoProcessDirect: false, Controls: WatermarkControls,
    canRun: s => s.text.trim().length > 0,
    process: async ({ id, file, name }, s) => {
        const r = await addWatermark(file, { text: s.text, opacity: s.opacity, fontSize: s.fontSize, style: s.style, color: s.color });
        await sessionStore.applyResult(id, r.url, `${baseName(name)}_watermarked.png`, 'watermark');
        return { resultUrl: r.url, badge: 'marked' };
    },
};

// ── METADATA ───────────────────────────────────────────────────────────────
const metadataTool: ShellTool<Record<string, never>> = {
    id: 'metadata', accent: 'orange', Icon: ShieldAlert, titleKey: 'metadata.headerTitle', actionLabelKey: 'metadata.defaultBtn',
    accept: f => toolAccepts('metadata', f) && isImg(f.currentFile), inputAccept: 'image/*',
    emptyTitleKey: 'metadata.headerTitle',
    defaults: {}, autoProcessDirect: true,
    process: async ({ id, file, name }) => {
        const r = await scrubMetadata(file);
        const removed = Object.keys(r.removedFields || {}).length;
        await sessionStore.applyResult(id, r.url, `${baseName(name)}_clean${extOf(name)}`, 'metadata');
        return { resultUrl: r.url, badge: removed ? `−${removed}` : 'clean' };
    },
};

// ── VECTORIZER ─────────────────────────────────────────────────────────────
type VecPreset = 'photo' | 'logo' | 'sketch' | 'pixel';
interface VecState { smoothness: number; colorMode: 'color' | 'binary'; colorPrecision: number; preset: VecPreset | null; }
const VEC_PRESETS: Record<VecPreset, { colormode: 'color' | 'binary'; colorPrecision: number; smoothness: number; mode: 'spline' | 'polygon' | 'none'; hierarchical: 'stacked' | 'cutout'; layer_difference: number; filter_speckle: number }> = {
    photo: { colormode: 'color', colorPrecision: 7, smoothness: 50, mode: 'spline', hierarchical: 'stacked', layer_difference: 16, filter_speckle: 4 },
    logo: { colormode: 'color', colorPrecision: 4, smoothness: 75, mode: 'spline', hierarchical: 'stacked', layer_difference: 32, filter_speckle: 12 },
    sketch: { colormode: 'binary', colorPrecision: 1, smoothness: 55, mode: 'spline', hierarchical: 'stacked', layer_difference: 16, filter_speckle: 6 },
    pixel: { colormode: 'color', colorPrecision: 8, smoothness: 0, mode: 'polygon', hierarchical: 'cutout', layer_difference: 0, filter_speckle: 0 },
};
const vtracerOptions = (s: VecState): Partial<VectorizeOptions> => {
    const t = s.smoothness / 100;
    const ex = s.preset ? VEC_PRESETS[s.preset] : null;
    return {
        colormode: s.colorMode, mode: ex?.mode ?? 'spline', hierarchical: ex?.hierarchical ?? 'stacked',
        layer_difference: ex?.layer_difference ?? 16,
        corner_threshold: Math.round(5 + t * 115), splice_threshold: Math.round(5 + t * 95), length_threshold: 1.0 + t * 5.0,
        filter_speckle: ex ? ex.filter_speckle : Math.round(1 + t * 4),
        color_precision: s.colorMode === 'binary' ? 1 : s.colorPrecision, path_precision: 8,
    };
};
const VEC_PRESET_BTNS: { key: VecPreset; label: string; Icon: LucideIcon }[] = [
    { key: 'photo', label: 'Photo', Icon: ImageIcon }, { key: 'logo', label: 'Logo', Icon: Shapes },
    { key: 'sketch', label: 'Sketch', Icon: PenLine }, { key: 'pixel', label: 'Pixel', Icon: LayoutGrid },
];
const VectorizerControls: React.FC<ControlsProps<VecState>> = ({ state, set }) => {
    const isColor = state.colorMode === 'color';
    const applyPreset = (name: VecPreset) => { const p = VEC_PRESETS[name]; set({ preset: name, colorMode: p.colormode, colorPrecision: p.colorPrecision, smoothness: p.smoothness }); };
    return (
        <div className="px-4 py-3 border-b border-[var(--separator)] shrink-0 space-y-2.5">
            <div className="flex items-center gap-1.5">
                {VEC_PRESET_BTNS.map(({ key, label, Icon }) => (
                    <button key={key} onClick={() => applyPreset(key)}
                        className={`flex-1 flex flex-col items-center gap-1 py-1.5 rounded-lg border ${state.preset === key ? 'border-rose-500/60 bg-rose-500/10 text-rose-300' : 'border-[var(--separator)] bg-[var(--surface)] text-[var(--text-3)] hover:text-[var(--text)]'}`}>
                        <Icon className="w-3.5 h-3.5" /><span className="text-[10px] font-semibold">{label}</span>
                    </button>
                ))}
            </div>
            <div className="flex items-center gap-3">
                <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-3)] w-16 shrink-0">Smooth</label>
                <input type="range" min={0} max={100} value={state.smoothness} onChange={e => set({ smoothness: Number(e.target.value), preset: null })} className="flex-1 accent-rose-500" />
            </div>
            <div className="flex items-center gap-2">
                <button onClick={() => set({ colorMode: isColor ? 'binary' : 'color', preset: null })}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border shrink-0 ${isColor ? 'border-rose-500/60 bg-rose-500/10 text-rose-300' : 'border-[var(--separator)] bg-[var(--surface)] text-[var(--text-3)]'}`}>
                    {isColor ? 'Color' : 'B & W'}
                </button>
                <input type="range" min={2} max={8} value={state.colorPrecision} disabled={!isColor}
                    onChange={e => set({ colorPrecision: Number(e.target.value), preset: null })} className="flex-1 accent-rose-500 disabled:opacity-40" />
            </div>
        </div>
    );
};
const vectorizerTool: ShellTool<VecState> = {
    id: 'vectorizer', accent: 'rose', Icon: PenTool, titleKey: 'vectorizer.headerTitle', actionLabelKey: 'vectorizer.run',
    accept: f => toolAccepts('vectorizer', f) && isImg(f.currentFile), inputAccept: 'image/*',
    emptyTitleKey: 'vectorizer.headerTitle',
    defaults: { smoothness: 0, colorMode: 'binary', colorPrecision: 3, preset: null },
    autoProcessDirect: true, Controls: VectorizerControls,
    process: async ({ id, file, name }, s) => {
        const r = await vectorizeImage(file, vtracerOptions(s));
        await sessionStore.applyResult(id, new Blob([r.svgString], { type: 'image/svg+xml' }), `${baseName(name)}.svg`, 'vectorizer');
        return { resultUrl: r.svgDataUrl, badge: `${r.pathCount}p` };
    },
};

// ── UPSCALER ───────────────────────────────────────────────────────────────
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
interface UpState { scale: UpscaleScale; model: UpscaleModel; }
const UpscalerControls: React.FC<ControlsProps<UpState>> = ({ state, set }) => (
    <div className="px-4 py-3 border-b border-[var(--separator)] shrink-0 flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-3)] w-12 shrink-0">Scale</span>
            {[2, 4].map(sc => (
                <button key={sc} onClick={() => set({ scale: sc as UpscaleScale })}
                    className={`flex-1 py-1 rounded-lg text-[11px] font-semibold border ${state.scale === sc ? 'border-pink-500/60 bg-pink-500/10 text-pink-300' : 'border-[var(--separator)] bg-[var(--surface)] text-[var(--text-3)] hover:text-[var(--text)]'}`}>{sc}x</button>
            ))}
        </div>
        <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-3)] w-12 shrink-0">Model</span>
            {([['realesrgan-x4plus', 'General'], ['realesrgan-x4plus-anime', 'Anime']] as const).map(([v, label]) => (
                <button key={v} onClick={() => set({ model: v })}
                    className={`flex-1 py-1 rounded-lg text-[11px] font-semibold border ${state.model === v ? 'border-pink-500/60 bg-pink-500/10 text-pink-300' : 'border-[var(--separator)] bg-[var(--surface)] text-[var(--text-3)] hover:text-[var(--text)]'}`}>{label}</button>
            ))}
        </div>
    </div>
);
const upscalerTool: ShellTool<UpState> = {
    id: 'upscaler', accent: 'pink', Icon: Maximize2, titleKey: 'upscaler.headerTitle', actionLabelKey: 'upscaler.upscale',
    accept: f => toolAccepts('upscaler', f) && isImg(f.currentFile), inputAccept: 'image/*',
    emptyTitleKey: 'upscaler.headerTitle',
    defaults: { scale: 4, model: 'realesrgan-x4plus' },
    autoProcessDirect: false, concurrency: 2, Controls: UpscalerControls,
    checkAvailable: () => getUpscaleStatus().then(r => r.available).catch(() => false),
    unavailableKey: 'upscaler.unavailable',
    process: async ({ id, file, name }, s, onProgress) => {
        const { jobId } = await startUpscale(file, s.scale, s.model);
        try {
            for (; ;) {
                const prog = await getUpscaleProgress(jobId);
                if (prog.status === 'done') {
                    onProgress?.(100);
                    const blob = await fetchUpscaleResultBlob(jobId);
                    await sessionStore.applyResult(id, blob, `${baseName(name)}-${s.scale}x.png`, 'upscaler');
                    return { resultUrl: URL.createObjectURL(blob), badge: `${s.scale}x` };
                }
                if (prog.status === 'error') throw new Error(prog.error || 'Upscale failed');
                onProgress?.(prog.progress);
                await sleep(1000);
            }
        } finally {
            cleanupUpscaleJob(jobId).catch(() => { });
        }
    },
};

// ── COMPRESSOR ─────────────────────────────────────────────────────────────
const CompressorControls: React.FC<ControlsProps<{ quality: number }>> = ({ state, set }) => (
    <div className="px-4 py-3 border-b border-[var(--separator)] shrink-0 flex items-center gap-3">
        <label className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-3)] w-16 shrink-0">Quality</label>
        <input type="range" min={10} max={100} value={state.quality} onChange={e => set({ quality: Number(e.target.value) })} className="flex-1 accent-emerald-500" />
        <span className="text-[11px] text-[var(--text-2)] w-8 text-right">{state.quality}</span>
    </div>
);
const compressorTool: ShellTool<{ quality: number }> = {
    id: 'compressor', accent: 'emerald', Icon: Minimize2, titleKey: 'tool.compressor.title', actionLabelKey: 'compressor.run',
    accept: f => toolAccepts('compressor', f) && isImg(f.currentFile), inputAccept: 'image/*',
    emptyTitleKey: 'tool.compressor.title',
    defaults: { quality: 70 }, autoProcessDirect: true, Controls: CompressorControls,
    process: async ({ id, file, name }, s) => {
        const r = await compressImage(file, s.quality);
        await sessionStore.applyResult(id, r.url, `${baseName(name)}-compressed${extOf(name)}`, 'compressor');
        return { resultUrl: r.url, badge: r.saved };
    },
};

import { paletteTool, ocrTool, cropperTool } from './focusTools';
import { removerTool } from './removerTool';
import { zipTool } from './zipTool';
import { converterTool } from './converterTool';
import { pdfTool } from './pdfTool';

export const SHELL_TOOLS: Partial<Record<ToolId, ShellTool>> = {
    remover: removerTool as ShellTool,
    zip: zipTool,
    converter: converterTool as ShellTool,
    pdf: pdfTool,
    resize: resizeTool as ShellTool,
    watermark: watermarkTool as ShellTool,
    metadata: metadataTool as ShellTool,
    vectorizer: vectorizerTool as ShellTool,
    upscaler: upscalerTool as ShellTool,
    compressor: compressorTool as ShellTool,
    palette: paletteTool,
    ocr: ocrTool,
    cropper: cropperTool,
};
