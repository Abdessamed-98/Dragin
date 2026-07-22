/**
 * FOCUS-archetype descriptors — single-image analyzers/editors that read the
 * session live (instant switch, no re-ingest flash — the fix for the crop lag).
 * Each provides a Body that renders the whole area below the shared header.
 *
 * palette / ocr — read-only analyzers (no applyResult); results cached per
 * file+revision so switching focus/tool doesn't re-run the backend.
 * cropper — an editor: CropperTool on the focused file, save → applyResult.
 */
import React, { useEffect, useState } from 'react';
import { Loader2, Check, Copy, Trash2, Palette as PaletteIcon, ScanText, Crop as CropIcon } from 'lucide-react';
import { SessionFile, sessionStore } from '../../state/sessionStore';
import { toolAccepts } from '../../state/toolCompat';
import { extractPalette, extractText } from '../../services/api';
import type { PaletteColor } from '../../services/api';
import { CropperTool } from '../tools/CropperTool';
import { ToolIconButton } from '../ToolIconButton';
import { FocusView } from './FocusView';
import { accentOf } from './accents';
import type { ShellTool, FocusBodyProps } from './shellTools';

const isImg = (f: File) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|tiff?|gif)$/i.test(f.name);
// Cache analyzer output by tool+file+revision so re-focusing / re-entering is instant.
const analysisCache = new Map<string, unknown>();

/** Shared focus footer — matches the grid footer chrome (clear + extra actions). */
const FocusFooter: React.FC<{ files: SessionFile[]; onClose: () => void; children?: React.ReactNode }> = ({ files, onClose, children }) => (
    <div className="flex items-center gap-1.5 px-3 pb-3 shrink-0">
        <div className="flex-1 flex items-center gap-1">
            {children}
            <ToolIconButton onClick={() => { sessionStore.remove(files.map(f => f.id)); onClose(); }} disabled={!files.length} danger title="Clear all"><Trash2 className="w-4 h-4" /></ToolIconButton>
        </div>
    </div>
);

// ── PALETTE ──────────────────────────────────────────────────────────────────
const PaletteResult: React.FC<{ file: SessionFile }> = ({ file }) => {
    const [colors, setColors] = useState<PaletteColor[] | null>(null);
    const [copied, setCopied] = useState<number | null>(null);
    useEffect(() => {
        const key = `palette:${file.id}:${file.revision}`;
        const c = analysisCache.get(key) as PaletteColor[] | undefined;
        if (c) { setColors(c); return; }
        setColors(null);
        let alive = true;
        extractPalette(file.currentFile, 8).then(res => { if (alive) { analysisCache.set(key, res); setColors(res); } }).catch(() => { if (alive) setColors([]); });
        return () => { alive = false; };
    }, [file.id, file.revision]);
    if (!colors) return <div className="shrink-0 h-14 flex items-center justify-center"><Loader2 className="w-5 h-5 text-violet-400 animate-spin" /></div>;
    return (
        <div className="shrink-0 grid grid-cols-8 gap-1">
            {colors.map((c, i) => (
                <button key={i} onClick={() => { navigator.clipboard?.writeText(c.hex); setCopied(i); setTimeout(() => setCopied(v => (v === i ? null : v)), 1200); }}
                    title={c.hex} style={{ background: c.hex }} className="h-9 rounded-md border border-black/20 relative flex items-center justify-center">
                    {copied === i && <Check className="w-3.5 h-3.5 text-white drop-shadow" />}
                </button>
            ))}
        </div>
    );
};
const PaletteBody: React.FC<FocusBodyProps> = ({ files, accent, onClose }) => (
    <>
        <FocusView files={files} accent={accent} renderResult={f => <PaletteResult file={f} />} />
        <FocusFooter files={files} onClose={onClose} />
    </>
);
export const paletteTool: ShellTool = {
    id: 'palette', kind: 'focus', accent: 'violet', Icon: PaletteIcon, titleKey: 'palette.headerTitle',
    accept: f => toolAccepts('palette', f) && isImg(f.currentFile), inputAccept: 'image/*',
    emptyTitleKey: 'palette.headerTitle', Body: PaletteBody,
};

// ── OCR ──────────────────────────────────────────────────────────────────────
const OcrResult: React.FC<{ file: SessionFile }> = ({ file }) => {
    const [text, setText] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        const key = `ocr:${file.id}:${file.revision}`;
        const c = analysisCache.get(key) as string | undefined;
        if (c != null) { setText(c); return; }
        setText(null);
        let alive = true;
        extractText(file.currentFile).then(r => { if (alive) { analysisCache.set(key, r.text); setText(r.text); } }).catch(() => { if (alive) setText(''); });
        return () => { alive = false; };
    }, [file.id, file.revision]);
    return (
        <div className="shrink-0 flex flex-col gap-1.5">
            {text == null
                ? <div className="h-28 flex items-center justify-center rounded-lg bg-[var(--surface)] border border-[var(--separator)]"><Loader2 className="w-5 h-5 text-fuchsia-400 animate-spin" /></div>
                : <textarea readOnly value={text || '(no text found)'} className="h-28 w-full resize-none rounded-lg bg-[var(--surface)] border border-[var(--separator)] p-2 text-xs text-[var(--text-2)] focus:outline-none" />}
            {text ? (
                <button onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1200); }}
                    className="self-end flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-2)]">
                    {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />} Copy text
                </button>
            ) : null}
        </div>
    );
};
const OcrBody: React.FC<FocusBodyProps> = ({ files, accent, onClose }) => (
    <>
        <FocusView files={files} accent={accent} renderResult={f => <OcrResult file={f} />} />
        <FocusFooter files={files} onClose={onClose} />
    </>
);
export const ocrTool: ShellTool = {
    // Images only for now — FocusView's <img> preview can't render a PDF; PDF OCR
    // returns once FocusView gains non-image (thumbnail) preview support.
    id: 'ocr', kind: 'focus', accent: 'fuchsia', Icon: ScanText, titleKey: 'tool.ocr.title',
    accept: f => toolAccepts('ocr', f) && isImg(f.currentFile), inputAccept: 'image/*',
    emptyTitleKey: 'tool.ocr.title', Body: OcrBody,
};

// ── CROPPER (editor) ─────────────────────────────────────────────────────────
const CropperBody: React.FC<FocusBodyProps> = ({ files, accent, onClose }) => {
    const ac = accentOf(accent);
    const [focusId, setFocusId] = useState<string | null>(null);
    useEffect(() => {
        if (!files.length) { setFocusId(null); return; }
        if (!focusId || !files.some(f => f.id === focusId)) setFocusId(files[files.length - 1].id);
    }, [files, focusId]);
    const focused = files.find(f => f.id === focusId) ?? files[files.length - 1];
    if (!focused) return null;
    const ext = focused.name.match(/\.[^.]+$/)?.[0] || '.png';
    return (
        <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 relative min-h-0 m-3 rounded-xl overflow-hidden">
                <CropperTool key={`${focused.id}:${focused.revision}`}
                    imageSrc={focused.currentUrl}
                    onSave={newUrl => { sessionStore.applyResult(focused.id, newUrl, `${focused.name.replace(/\.[^.]+$/, '')}_cropped${ext}`, 'cropper'); }}
                    onCancel={() => sessionStore.revert(focused.id)} />
            </div>
            {files.length > 1 && (
                <div className="shrink-0 flex items-center gap-1.5 overflow-x-auto px-3 pb-3">
                    {files.map(f => (
                        <button key={f.id} onClick={() => setFocusId(f.id)}
                            className={`shrink-0 w-11 h-11 rounded-lg overflow-hidden border-2 ${f.id === focused.id ? ac.dropBorder : 'border-[var(--separator)] hover:border-[var(--border-2)]'}`}>
                            <img src={f.currentUrl} className="w-full h-full object-cover" draggable={false} alt="" />
                        </button>
                    ))}
                    <button onClick={() => { sessionStore.remove(files.map(f => f.id)); onClose(); }} title="Clear all"
                        className="shrink-0 ml-auto p-2 rounded-lg text-[var(--text-2)] hover:text-[var(--red)] bg-[var(--surface-2)] hover:bg-[var(--surface-3)]"><Trash2 className="w-4 h-4" /></button>
                </div>
            )}
        </div>
    );
};
export const cropperTool: ShellTool = {
    id: 'cropper', kind: 'focus', accent: 'orange', Icon: CropIcon, titleKey: 'tool.cropper.title',
    accept: f => toolAccepts('cropper', f) && isImg(f.currentFile), inputAccept: 'image/*',
    emptyTitleKey: 'tool.cropper.title', Body: CropperBody,
};
