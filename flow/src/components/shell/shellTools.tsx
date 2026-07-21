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
import { LucideIcon, Scaling, Type, ShieldAlert, Image as ImageIcon, Link2, Unlink2 } from 'lucide-react';
import { SessionFile, sessionStore } from '../../state/sessionStore';
import { toolAccepts } from '../../state/toolCompat';
import { resizeImage, addWatermark, scrubMetadata } from '../../services/api';
import { ToolId } from '../../types';

export interface ProcessResult { resultUrl: string; badge?: string }

export interface ControlsProps<S = any> {
    state: S;
    set: (patch: Partial<S>) => void;
    files: SessionFile[];
}

export interface ShellTool<S = any> {
    id: ToolId;
    accent: string;
    Icon: LucideIcon;
    titleKey: string;
    actionLabelKey: string;
    accept: (f: SessionFile) => boolean;
    inputAccept: string;
    emptyTitleKey: string;
    emptyHintKey?: string;
    defaults: S;
    autoProcessDirect: boolean;
    canRun?: (state: S, files: SessionFile[]) => boolean;
    Controls?: React.FC<ControlsProps<S>>;
    /** Transform ONE file (the tool's INPUT, not necessarily currentFile) and
     *  applyResult. Returns the result URL + a short done-badge caption. */
    process: (item: { id: string; file: File; name: string }, state: S) => Promise<ProcessResult>;
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

export const SHELL_TOOLS: Partial<Record<ToolId, ShellTool>> = {
    resize: resizeTool as ShellTool,
    watermark: watermarkTool as ShellTool,
    metadata: metadataTool as ShellTool,
};
