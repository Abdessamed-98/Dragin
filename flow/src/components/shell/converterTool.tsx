/**
 * Format Converter on the shell — grid archetype, mixed media (image/video/audio).
 *  • Controls: a format toggle bar per media type PRESENT in the session.
 *  • process picks the target by the file's kind: images convert synchronously;
 *    video/audio start a job and poll to completion (live % via onProgress).
 *  • FileGrid now renders video frames + audio placeholders, so mixed cells work.
 */
import React, { useEffect, useState } from 'react';
import { ArrowRightLeft, AlertTriangle } from 'lucide-react';
import { sessionStore, kindOf } from '../../state/sessionStore';
import { toolAccepts } from '../../state/toolCompat';
import { convertImage, startVideoConversion, getVideoProgress, getConvertStatus } from '../../services/api';
import type { ImageFormat, ConvertFormat } from '../../services/api';
import type { ShellTool, ControlsProps } from './shellTools';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const isMedia = (f: File) => { const k = kindOf(f); return k === 'image' || k === 'video' || k === 'audio'; };
const fileExt = (fmt: string) => (fmt === 'av1' ? 'mp4' : fmt);

interface ConvState { image: string; video: string; audio: string; }
const GROUPS: { kind: 'image' | 'video' | 'audio'; label: string; key: keyof ConvState; formats: string[] }[] = [
    { kind: 'image', label: 'Image', key: 'image', formats: ['jpg', 'png', 'webp', 'avif', 'bmp', 'tiff'] },
    { kind: 'video', label: 'Video', key: 'video', formats: ['mp4', 'av1', 'webm', 'mov', 'avi', 'mkv', 'gif'] },
    { kind: 'audio', label: 'Audio', key: 'audio', formats: ['mp3', 'wav', 'ogg'] },
];

const ConverterControls: React.FC<ControlsProps<ConvState>> = ({ state, set, files }) => {
    const [ffmpeg, setFfmpeg] = useState<boolean | null>(null);
    useEffect(() => { getConvertStatus().then(s => setFfmpeg(s.ffmpeg)).catch(() => setFfmpeg(false)); }, []);
    const present = new Set(files.map(f => f.kind));
    const groups = GROUPS.filter(g => present.has(g.kind));
    const needsFfmpeg = present.has('video') || present.has('audio');
    return (
        <div className="px-4 py-3 border-b border-[var(--separator)] shrink-0 flex flex-col gap-2.5">
            {groups.map(g => (
                <div key={g.key} className="flex items-center gap-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-3)] w-12 shrink-0">{g.label}</span>
                    <div className="flex-1 flex flex-wrap gap-1">
                        {g.formats.map(fmt => (
                            <button key={fmt} onClick={() => set({ [g.key]: fmt } as Partial<ConvState>)}
                                className={`px-2 py-0.5 rounded-md text-[11px] font-semibold border ${state[g.key] === fmt ? 'border-blue-500/60 bg-blue-500/10 text-blue-300' : 'border-[var(--separator)] bg-[var(--surface)] text-[var(--text-3)] hover:text-[var(--text)]'}`}>{fmt}</button>
                        ))}
                    </div>
                </div>
            ))}
            {needsFfmpeg && ffmpeg === false && (
                <p className="flex items-center gap-1.5 text-[10px] text-amber-300"><AlertTriangle className="w-3 h-3" /> Video/audio conversion needs FFmpeg (install the Converter tool).</p>
            )}
        </div>
    );
};

export const converterTool: ShellTool<ConvState> = {
    id: 'converter', accent: 'blue', Icon: ArrowRightLeft, titleKey: 'converter.headerTitle', actionLabelKey: 'converter.convert',
    accept: f => toolAccepts('converter', f) && isMedia(f.currentFile), inputAccept: 'image/*,video/*,audio/*',
    emptyTitleKey: 'converter.headerTitle',
    defaults: { image: 'jpg', video: 'mp4', audio: 'mp3' }, autoProcessDirect: false, concurrency: 2,
    Controls: ConverterControls,
    process: async ({ id, file, name }, s, onProgress) => {
        const kind = kindOf(file);
        const fmt = kind === 'image' ? s.image : kind === 'video' ? s.video : s.audio;
        const outName = `${name.replace(/\.[^.]+$/, '')}.${fileExt(fmt)}`;
        if (kind === 'image') {
            const r = await convertImage(file, fmt as ImageFormat);
            await sessionStore.applyResult(id, r.dataUrl, outName, 'converter');
            return { resultUrl: r.dataUrl, badge: fmt };
        }
        const { jobId } = await startVideoConversion(file, fmt as ConvertFormat);
        for (; ;) {
            const p = await getVideoProgress(jobId);
            if (p.status === 'done') {
                onProgress?.(100);
                if (p.dataUrl) await sessionStore.applyResult(id, p.dataUrl, outName, 'converter');
                return { resultUrl: p.dataUrl || '', badge: fmt };
            }
            if (p.status === 'error') throw new Error(p.error || 'Conversion failed');
            if (typeof p.progress === 'number') onProgress?.(p.progress);
            await sleep(1000);
        }
    },
};
