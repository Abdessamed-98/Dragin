/**
 * Shared shell footer — one row for every shell tool:
 *   • primary action: Run/Apply/… when idle items exist, else Save (download)
 *   • Copy / Paste / Clear cluster (neutral, locked palette via ToolIconButton)
 *
 * Replaces the per-tool footer each tool used to hand-roll. Copy/paste/save
 * logic lives here (over the tool's done outputs); the action itself comes from
 * the shell controller.
 */
import React, { useState } from 'react';
import { Loader2, Download, Copy, Check, ClipboardPaste, Trash2 } from 'lucide-react';
import { ToolIconButton } from '../ToolIconButton';
import { saveOutputs } from '../../services/saveOutput';
import { useI18n } from '../../i18n/I18nContext';
import { accentOf } from './accents';

export interface DoneOutput { name: string; url: string; path?: string | null }

interface ToolFooterProps {
    accent: string;
    actionIcon: React.ReactNode;
    actionLabel: string;
    /** Idle (carried / awaiting) items exist → show the run button. */
    hasIdle: boolean;
    /** Gate the run button (e.g. watermark needs text). */
    canRun: boolean;
    anyProcessing: boolean;
    hasFiles: boolean;
    onRun: () => void;
    /** Done outputs for this tool — drives Save/Copy enablement. */
    doneOutputs: DoneOutput[];
    saveFolder: string;
    onAddFiles: (files: File[]) => void;
    onClear: () => void;
}

export const ToolFooter: React.FC<ToolFooterProps> = ({
    accent, actionIcon, actionLabel, hasIdle, canRun, anyProcessing, hasFiles,
    onRun, doneOutputs, saveFolder, onAddFiles, onClear,
}) => {
    const { t } = useI18n();
    const ac = accentOf(accent);
    const [isDownloading, setIsDownloading] = useState(false);
    const [isCopying, setIsCopying] = useState(false);
    const [copied, setCopied] = useState(false);

    const anyDone = doneOutputs.length > 0;

    const handleDownload = async () => {
        if (!anyDone) return;
        setIsDownloading(true);
        try {
            await saveOutputs(doneOutputs.map(o => ({ name: o.name, url: o.url, originalPath: o.path ?? null })), saveFolder);
        } catch (e) { console.error('Save failed', e); } finally { setIsDownloading(false); }
    };

    const handleCopy = async () => {
        if (!anyDone || isCopying) return;
        setIsCopying(true);
        try {
            const items = doneOutputs.map(o => ({ dataUrl: o.url, name: o.name }));
            if ((window as any).electron?.clipboardWrite) await (window as any).electron.clipboardWrite(items);
            setCopied(true); setTimeout(() => setCopied(false), 1500);
        } catch (e) { console.error(e); } finally { setIsCopying(false); }
    };

    const handlePaste = async () => {
        try {
            if ((window as any).electron?.clipboardRead) {
                const clip = await (window as any).electron.clipboardRead();
                if (clip.length) {
                    const fs = await Promise.all(clip.map(async ({ dataUrl, name }: any) =>
                        new File([await (await fetch(dataUrl)).blob()], name)));
                    onAddFiles(fs);
                }
            }
        } catch { /* nothing on clipboard we can use */ }
    };

    return (
        <div className="flex items-center gap-1.5 px-3 pb-3 shrink-0">
            {hasIdle && !anyProcessing ? (
                <button onClick={onRun} disabled={!canRun}
                    className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all ${canRun ? ac.button : 'bg-[var(--surface-2)] text-[var(--text-3)] cursor-not-allowed'}`}>
                    {actionIcon}{actionLabel}
                </button>
            ) : (
                <button onClick={handleDownload} disabled={!anyDone || isDownloading || anyProcessing}
                    className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all ${!anyDone || anyProcessing ? 'bg-[var(--surface-2)] text-[var(--text-3)] cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}>
                    {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}{t('shell.download')}
                </button>
            )}
            <div className="flex-1 flex items-center gap-1">
                <ToolIconButton onClick={handleCopy} disabled={!anyDone || isCopying} title={t('shell.copy')}>
                    {isCopying ? <Loader2 className="w-4 h-4 animate-spin" /> : copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                </ToolIconButton>
                <ToolIconButton onClick={handlePaste} title={t('shell.paste')}><ClipboardPaste className="w-4 h-4" /></ToolIconButton>
                <ToolIconButton onClick={onClear} disabled={!hasFiles} danger title={t('shell.clear')}><Trash2 className="w-4 h-4" /></ToolIconButton>
            </div>
        </div>
    );
};
