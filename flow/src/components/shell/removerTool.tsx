/**
 * Background Remover on the shell — grid archetype with editor extras.
 *  • process = BEN2 background removal, auto on drop (first run loads the model).
 *  • cutouts render on a transparency checkerboard.
 *  • Controls: eye-toggle (show originals) + auto-crop-all (trim transparency).
 *  • Clicking a done cutout opens the magic-brush editor (CellEditor).
 * All edits write back via applyResult so the cutout carries to the next tool.
 */
import React, { useEffect, useState, Suspense } from 'react';
import { Eye, EyeOff, Scissors, Loader2, Sparkles } from 'lucide-react';
import { SessionFile, sessionStore } from '../../state/sessionStore';
import { toolAccepts } from '../../state/toolCompat';
import { removeBackgroundBen2, checkBen2ModelLoaded, trimTransparency } from '../../services/api';
import type { ShellTool, ControlsProps } from './shellTools';

// Lazy: the brush editor (canvas engine) only loads when a cutout is clicked.
const MagicBrushTool = React.lazy(() => import('../tools/MagicBrushTool').then(m => ({ default: m.MagicBrushTool })));

const isImg = (f: File) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp|tiff?|gif)$/i.test(f.name);
const outName = (name: string) => `${name.replace(/\.[^.]+$/, '')}-BGremoved.png`;

interface RemoverState { showOriginal: boolean }

const RemoverControls: React.FC<ControlsProps<RemoverState>> = ({ state, set, files }) => {
    const [modelKnown, setModelKnown] = useState<boolean | null>(null);
    const [trimming, setTrimming] = useState(false);
    useEffect(() => { checkBen2ModelLoaded().then(setModelKnown).catch(() => setModelKnown(true)); }, []);

    const autoCropAll = async () => {
        setTrimming(true);
        try {
            for (const f of files) {
                if (f.provenance[f.provenance.length - 1] !== 'remover') continue; // only cutouts
                try {
                    const trimmed = await trimTransparency(f.currentUrl);
                    if (trimmed) await sessionStore.applyResult(f.id, trimmed, outName(f.name), 'remover');
                } catch { /* skip this one */ }
            }
        } finally { setTrimming(false); }
    };

    return (
        <div className="px-4 py-3 border-b border-[var(--separator)] shrink-0 flex flex-col gap-2">
            <div className="flex items-center gap-1.5">
                <button onClick={() => set({ showOriginal: !state.showOriginal })}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-semibold border ${state.showOriginal ? 'border-indigo-500/60 bg-indigo-500/10 text-indigo-300' : 'border-[var(--separator)] bg-[var(--surface)] text-[var(--text-3)] hover:text-[var(--text)]'}`}>
                    {state.showOriginal ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {state.showOriginal ? 'Showing original' : 'Show original'}
                </button>
                <button onClick={autoCropAll} disabled={trimming || state.showOriginal}
                    className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[11px] font-semibold border border-[var(--separator)] bg-[var(--surface)] text-[var(--text-3)] hover:text-[var(--text)] disabled:opacity-40">
                    {trimming ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scissors className="w-3.5 h-3.5" />} Auto-crop
                </button>
            </div>
            {modelKnown === false && (
                <p className="text-[10px] text-[var(--text-3)]">First removal loads the AI model (a few seconds), then it's fast.</p>
            )}
        </div>
    );
};

const RemoverEditor: React.FC<{ file: SessionFile; onClose: () => void }> = ({ file, onClose }) => (
    <Suspense fallback={<div className="absolute inset-0 flex items-center justify-center bg-black/40"><Loader2 className="w-6 h-6 text-indigo-400 animate-spin" /></div>}>
        <MagicBrushTool
            originalImageSrc={file.originalUrl}
            processedImageSrc={file.currentUrl}
            onSave={newUrl => { sessionStore.applyResult(file.id, newUrl, outName(file.name), 'remover'); onClose(); }}
            onCancel={onClose}
        />
    </Suspense>
);

export const removerTool: ShellTool<RemoverState> = {
    id: 'remover', accent: 'indigo', Icon: Sparkles, titleKey: 'tool.remover.title', actionLabelKey: 'tool.remover.title',
    accept: f => toolAccepts('remover', f) && isImg(f.currentFile), inputAccept: 'image/*',
    emptyTitleKey: 'tool.remover.title',
    defaults: { showOriginal: false }, autoProcessDirect: true, transparent: true,
    Controls: RemoverControls, CellEditor: RemoverEditor,
    process: async ({ id, file, name }) => {
        const url = await removeBackgroundBen2(file);
        await sessionStore.applyResult(id, url, outName(name), 'remover');
        return { resultUrl: url };
    },
};
