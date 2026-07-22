/**
 * FocusView — the shared body for single-image FOCUS tools (palette, OCR).
 *
 * One large preview of the focused file + a tool-specific result panel + a
 * filmstrip to pick the focus when several files are loaded. Like FileGrid, it
 * reads the session LIVE, so switching to a focus tool shows the image instantly
 * (no re-ingest flash) — the whole point of the shell.
 *
 * Presentational only: the descriptor passes `renderResult(file)`, whose
 * component owns its own (cached) analysis.
 */
import React, { useState, useEffect } from 'react';
import { Upload } from 'lucide-react';
import { SessionFile } from '../../state/sessionStore';
import { accentOf } from './accents';

interface FocusViewProps {
    files: SessionFile[];
    accent: string;
    renderResult: (file: SessionFile) => React.ReactNode;
}

export const FocusView: React.FC<FocusViewProps> = ({ files, accent, renderResult }) => {
    const ac = accentOf(accent);
    const [focusId, setFocusId] = useState<string | null>(null);

    // Keep focus valid: default to the last file; if the focused file vanishes,
    // fall back to the last remaining one.
    useEffect(() => {
        if (!files.length) { setFocusId(null); return; }
        if (!focusId || !files.some(f => f.id === focusId)) setFocusId(files[files.length - 1].id);
    }, [files, focusId]);

    const focused = files.find(f => f.id === focusId) ?? files[files.length - 1];
    if (!focused) return null;

    return (
        <div className="flex-1 flex flex-col min-h-0 p-3 gap-2">
            {/* Focused preview */}
            <div className="flex-1 relative min-h-0 rounded-xl overflow-hidden bg-black/20 border border-[var(--separator)] flex items-center justify-center">
                <img src={focused.currentUrl} className="max-w-full max-h-full object-contain" alt="" draggable={false} />
            </div>

            {/* Tool result panel */}
            {renderResult(focused)}

            {/* Filmstrip — pick the focus when multiple files are loaded */}
            {files.length > 1 && (
                <div className="shrink-0 flex items-center gap-1.5 overflow-x-auto pb-1">
                    {files.map(f => (
                        <button key={f.id} onClick={() => setFocusId(f.id)}
                            className={`shrink-0 w-11 h-11 rounded-lg overflow-hidden border-2 transition-colors ${f.id === focused.id ? ac.dropBorder : 'border-[var(--separator)] hover:border-[var(--border-2)]'}`}>
                            <img src={f.currentUrl} className="w-full h-full object-cover" alt="" draggable={false} />
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

/** Shared empty-state dropzone for focus tools (mirrors FileGrid's). */
export const FocusEmpty: React.FC<{ accent: string; inputAccept: string; icon: React.ReactNode; title: string; hint?: string; onAddFiles: (f: File[]) => void }> = ({ accent, inputAccept, icon, title, hint, onAddFiles }) => {
    const ac = accentOf(accent);
    const [over, setOver] = useState(false);
    return (
        <div className="flex-1 flex flex-col min-h-0 p-3"
            onDrop={e => { e.preventDefault(); e.stopPropagation(); setOver(false); const f = Array.from(e.dataTransfer.files); if (f.length) onAddFiles(f); }}
            onDragOver={e => { e.preventDefault(); setOver(true); }}
            onDragLeave={e => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(false); }}>
            <label className={`flex-1 flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed cursor-pointer transition-all ${over ? `${ac.dropBorder} ${ac.dropBg}` : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-2)]'}`}>
                <div className={`p-4 rounded-2xl ${over ? ac.dropIconBg : 'bg-[var(--surface-2)]'}`}>{over ? <Upload className={`w-8 h-8 ${ac.icon}`} /> : icon}</div>
                <div className="text-center px-4">
                    <p className="text-sm font-semibold text-[var(--text-2)]">{title}</p>
                    {hint && <p className="text-[10px] text-[var(--text-3)] mt-2">{hint}</p>}
                </div>
                <input type="file" accept={inputAccept} multiple className="sr-only" onChange={e => { if (e.target.files?.length) onAddFiles(Array.from(e.target.files)); e.target.value = ''; }} />
            </label>
        </div>
    );
};
