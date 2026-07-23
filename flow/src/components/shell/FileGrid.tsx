/**
 * Shared file grid — the ONE persistent body every shell tool renders.
 *
 * It draws session files directly (sessionStore) and overlays each cell with
 * this tool's transient status from processingStore. Because the shell keeps a
 * single FileGrid mounted across rail switches and cells are keyed by file id,
 * the <img> nodes survive a tool switch — no reload, no flash. Switching a tool
 * only changes the overlay map + accent, never the images.
 *
 * Replaces the status-cell markup every tool used to hand-roll
 * (see the old tools/ResizeTool.tsx grid cells).
 */
import React, { useEffect, useState } from 'react';
import { Loader2, AlertCircle, Upload, Check, Music, Film } from 'lucide-react';
import { SessionFile, sessionStore } from '../../state/sessionStore';
import { getFileThumbnail } from '../../services/api';
import { ItemState } from '../../state/processingStore';
import { accentOf, AccentClasses } from './accents';

/** Grab a still frame (~0.1s) from a video file as a data-URL, for grid cells. */
function videoFrame(file: File): Promise<string | null> {
    return new Promise(resolve => {
        const url = URL.createObjectURL(file);
        const v = document.createElement('video');
        v.muted = true; v.preload = 'metadata'; v.src = url;
        const done = (out: string | null) => { URL.revokeObjectURL(url); resolve(out); };
        v.addEventListener('loadeddata', () => { try { v.currentTime = Math.min(0.1, (v.duration || 1) / 2); } catch { done(null); } });
        v.addEventListener('seeked', () => {
            try { const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d')!.drawImage(v, 0, 0); done(c.toDataURL('image/jpeg', 0.7)); }
            catch { done(null); }
        }, { once: true });
        v.addEventListener('error', () => done(null), { once: true });
    });
}

interface FileGridProps {
    files: SessionFile[];
    items: Record<string, ItemState>;
    /** Tailwind color stem, e.g. 'sky' — used for spinners/accents. */
    accent: string;
    inputAccept: string;
    emptyIcon: React.ReactNode;
    emptyTitle: string;
    emptyHint?: string;
    onAddFiles: (files: File[]) => void;
    /** Optional per-cell CSS aspect-ratio (Resize varies it by chosen shape). */
    cellAspect?: string;
    /** Show each file's ORIGINAL instead of its result (remover eye-toggle). */
    showOriginal?: boolean;
    /** Checkered transparency backdrop (cutouts). */
    transparent?: boolean;
    /** Click a cell → open an editor (remover magic-brush, cropper). */
    onCellClick?: (file: SessionFile) => void;
    /** When cells are clickable: 'done' (default) or 'always' (pure editors). */
    cellClickMode?: 'done' | 'always';
}

const CHECKER = 'repeating-conic-gradient(#808080 0% 25%, #a0a0a0 0% 50%) 50% / 16px 16px';

/** One cell: shared thumbnail (or this tool's result) + status overlay. */
const GridCell: React.FC<{ file: SessionFile; state?: ItemState; ac: AccentClasses; cellAspect?: string; showOriginal?: boolean; transparent?: boolean; onClick?: (f: SessionFile) => void; clickMode?: 'done' | 'always' }> = ({ file, state, ac, cellAspect, showOriginal, transparent, onClick, clickMode = 'done' }) => {
    const [thumb, setThumb] = useState<string | null>(null);
    const isVideo = file.kind === 'video';
    const isAudio = file.kind === 'audio';

    // Thumbnail per kind, all through the shared cache (one extraction per
    // id+revision, reused across cells + tool switches): images via the backend,
    // video via a canvas still-frame; audio → no thumbnail (icon placeholder).
    useEffect(() => {
        if (isAudio) { setThumb(null); return; }
        let alive = true;
        const make = isVideo
            ? async () => { const f = await videoFrame(file.currentFile); return f ? { url: f, needsRevoke: false } : null; }
            : () => getFileThumbnail(file.currentFile, 96);
        sessionStore.getThumb(file.id, file.revision, make)
            .then(t => { if (alive) setThumb(t?.url ?? null); });
        return () => { alive = false; };
    }, [file.id, file.revision, isVideo, isAudio]);

    // A result for THIS revision wins over the thumbnail; stale results are ignored.
    const fresh = state && state.revision === file.revision;
    const processing = fresh && state.status === 'processing';
    const error = fresh && state.status === 'error';
    const done = fresh && state.status === 'done';
    const src = showOriginal ? file.originalUrl : ((fresh && state.resultUrl) || thumb);
    const clickable = !!onClick && !showOriginal && (clickMode === 'always' || !!done);

    return (
        <div onClick={clickable ? () => onClick!(file) : undefined}
            style={{ ...(cellAspect ? { aspectRatio: cellAspect } : {}), ...(transparent ? { background: CHECKER } : {}) }}
            className={`relative rounded-lg border overflow-hidden aspect-square ${transparent ? 'border-[var(--separator)]' : 'border-[var(--separator)] bg-[var(--surface)]'} ${clickable ? 'cursor-pointer hover:ring-2 hover:ring-white/40' : ''}`}>
            {src
                ? <img src={src} className={`w-full h-full object-cover ${processing ? 'opacity-40' : ''}`} alt="" draggable={false} />
                : <div className="w-full h-full flex flex-col items-center justify-center gap-1 px-1">
                    {isAudio ? <Music className={`w-5 h-5 ${ac.spinnerDim}`} /> : isVideo ? <Film className={`w-5 h-5 ${ac.spinnerDim}`} /> : <Loader2 className={`w-4 h-4 ${ac.spinnerDim} animate-spin`} />}
                    {(isAudio || isVideo) && <span className="text-[8px] text-[var(--text-3)] truncate max-w-full">{file.name}</span>}
                </div>}
            {processing && (
                <div className="absolute inset-0 flex items-center justify-center">
                    {typeof state?.progress === 'number'
                        ? <span className={`text-[11px] font-bold ${ac.spinner} bg-black/55 px-1.5 py-0.5 rounded-full`}>{Math.round(state.progress)}%</span>
                        : <Loader2 className={`w-5 h-5 ${ac.spinner} animate-spin`} />}
                </div>
            )}
            {error && <div className="absolute inset-0 flex items-center justify-center bg-red-950/70" title={state?.error}><AlertCircle className="w-4 h-4 text-red-400" /></div>}
            {done && state?.badge && <div className="absolute bottom-0.5 right-0.5 text-[8px] leading-none bg-black/65 text-white px-1 py-0.5 rounded flex items-center gap-0.5"><Check className="w-2 h-2" />{state.badge}</div>}
        </div>
    );
};

export const FileGrid: React.FC<FileGridProps> = ({ files, items, accent, inputAccept, emptyIcon, emptyTitle, emptyHint, onAddFiles, cellAspect, showOriginal, transparent, onCellClick, cellClickMode }) => {
    const [isDragOver, setIsDragOver] = useState(false);
    const ac = accentOf(accent);

    const onDrop = (e: React.DragEvent) => {
        e.preventDefault(); e.stopPropagation(); setIsDragOver(false);
        const f = Array.from(e.dataTransfer.files);
        if (f.length) onAddFiles(f);
    };
    const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.length) onAddFiles(Array.from(e.target.files));
        e.target.value = '';
    };

    return (
        <div className="flex-1 flex flex-col min-h-0 p-3 gap-2"
            onDrop={onDrop}
            onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={e => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setIsDragOver(false); }}>
            {files.length === 0 ? (
                <label className={`flex-1 flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed cursor-pointer transition-all ${isDragOver ? `${ac.dropBorder} ${ac.dropBg}` : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-2)]'}`}>
                    <div className={`p-4 rounded-2xl ${isDragOver ? ac.dropIconBg : 'bg-[var(--surface-2)]'}`}>
                        {isDragOver ? <Upload className={`w-8 h-8 ${ac.icon}`} /> : emptyIcon}
                    </div>
                    <div className="text-center px-4">
                        <p className="text-sm font-semibold text-[var(--text-2)]">{emptyTitle}</p>
                        {emptyHint && <p className="text-[10px] text-[var(--text-3)] mt-2">{emptyHint}</p>}
                    </div>
                    <input type="file" accept={inputAccept} multiple className="sr-only" onChange={onFileInput} />
                </label>
            ) : (
                <div className="flex-1 min-h-0 overflow-y-auto -mr-1 pr-1">
                    <div className="grid grid-cols-3 gap-1.5">
                        {files.map(f => <GridCell key={f.id} file={f} state={items[f.id]} ac={ac} cellAspect={cellAspect} showOriginal={showOriginal} transparent={transparent} onClick={onCellClick} clickMode={cellClickMode} />)}
                        <label style={cellAspect ? { aspectRatio: cellAspect } : undefined}
                            className="rounded-lg border border-dashed border-[var(--border)] cursor-pointer flex items-center justify-center hover:border-[var(--border-2)] aspect-square">
                            <Upload className="w-4 h-4 text-[var(--text-3)]" />
                            <input type="file" accept={inputAccept} multiple className="sr-only" onChange={onFileInput} />
                        </label>
                    </div>
                </div>
            )}
        </div>
    );
};
