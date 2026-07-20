import React, { useState, useCallback, useEffect, useRef } from 'react';
import { FileArchive, Upload, Loader2, Download, Trash2, File as FileIco, FolderArchive, PackageOpen } from 'lucide-react';
import { zipFiles, unzipFile } from '../../services/api';
import { saveOutputs } from '../../services/saveOutput';
import { useI18n } from '../../i18n/I18nContext';
import { ToolHeader } from '../ToolHeader';
import { ToolIconButton } from '../ToolIconButton';
import { sessionStore, useSessionIngest } from '../../state/sessionStore';
import { toolAccepts } from '../../state/toolCompat';

interface ZipToolProps {
    onClose: () => void;
    /** True while this tool is the expanded panel — session ingestion runs only then. */
    active: boolean;
    onItemCountChange?: (count: number) => void;
    clearGen?: number;
}

const isZip = (f: File) => /\.zip$/i.test(f.name) || f.type === 'application/zip' || f.type === 'application/x-zip-compressed';
const fmtSize = (b: number) => b < 1024 ? `${b} B` : b < 1024 * 1024 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1024 / 1024).toFixed(1)} MB`;

export const ZipTool: React.FC<ZipToolProps> = ({ onClose, active, onItemCountChange, clearGen = 0 }) => {
    const { t } = useI18n();
    const [mode, setMode] = useState<'zip' | 'unzip'>('zip');
    const [inputs, setInputs] = useState<{ id: string; file: File }[]>([]);
    const [extracted, setExtracted] = useState<{ name: string; dataUrl: string }[]>([]);
    const [status, setStatus] = useState<'idle' | 'working' | 'done' | 'error'>('idle');
    const [error, setError] = useState<string | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);

    const count = mode === 'unzip' ? extracted.length : inputs.length;
    useEffect(() => { onItemCountChange?.(count); }, [count, onItemCountChange]);

    const reset = () => { setInputs([]); setExtracted([]); setStatus('idle'); setError(null); };

    // Ingest session files (keyed by session id) — same auto-detect as the old
    // drop handler (single .zip → unzip, anything else → collect for zipping);
    // same-id re-ingest replaces.
    const ingestBatch = useCallback(async (batch: { id: string; file: File }[]) => {
        if (!batch.length) return;
        if (batch.length === 1 && isZip(batch[0].file)) {
            // Unzip
            const { id, file } = batch[0];
            setMode('unzip'); setStatus('working'); setError(null); setExtracted([]); setInputs([{ id, file }]);
            try {
                const results = await unzipFile(file);
                setExtracted(results); setStatus('done');
            } catch (e: any) { setStatus('error'); setError(e?.message || 'Unzip failed'); }
        } else {
            // Collect for zipping
            setMode('zip'); setStatus('idle'); setError(null); setExtracted([]);
            setInputs(prev => [...prev.filter(p => !batch.some(b => b.id === p.id)), ...batch.map(({ id, file }) => ({ id, file }))]);
        }
    }, []);

    const removeLocal = useCallback((ids: string[]) => {
        setInputs(prev => {
            const next = prev.filter(p => !ids.includes(p.id));
            if (!next.length) { setMode('zip'); setExtracted([]); setStatus('idle'); setError(null); }
            return next;
        });
    }, []);

    useSessionIngest(active, 'zip', f => toolAccepts('zip', f), ingestBatch, removeLocal);

    // UI adds (drop on panel / file input / "add more") go through the session
    // store — the ingest above brings them into local state.
    const addFiles = useCallback((incoming: File[]) => {
        if (incoming.length) sessionStore.addFiles(incoming, 'zip');
    }, []);

    const lastClear = useRef(clearGen);
    useEffect(() => { if (clearGen === 0 || clearGen === lastClear.current) return; lastClear.current = clearGen; reset(); }, [clearGen]);

    const doZip = async () => {
        if (inputs.length === 0) return;
        setStatus('working'); setError(null);
        try {
            const { dataUrl } = await zipFiles(inputs.map(i => i.file));
            setStatus('done');
            await saveOutputs([{ name: `archive-${Date.now()}.zip`, url: dataUrl, originalPath: (inputs[0].file as any).path ?? null }], 'archive');
        } catch (e: any) { setStatus('error'); setError(e?.message || 'Zip failed'); }
    };

    const handleDownloadExtracted = async () => {
        if (!extracted.length) return;
        setIsDownloading(true);
        try { await saveOutputs(extracted.map(e => ({ name: e.name, url: e.dataUrl, originalPath: null })), 'extracted'); }
        catch (e) { console.error(e); } finally { setIsDownloading(false); }
    };

    const onDrop = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); const f = Array.from(e.dataTransfer.files); if (f.length) addFiles(f); };
    const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files?.length) addFiles(Array.from(e.target.files)); e.target.value = ''; };

    const hasItems = count > 0;

    return (
        <div className="absolute inset-0 flex flex-col rounded-2xl overflow-hidden"
            onDrop={onDrop} onDragOver={e => { e.preventDefault(); setIsDragOver(true); }}
            onDragLeave={e => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setIsDragOver(false); }}>
            {/* Header */}
            <ToolHeader icon={<FileArchive className="w-4 h-4 text-teal-400" />} title={t('zip.title')} count={count} onClose={onClose} />

            {/* Body */}
            <div className="flex-1 flex flex-col min-h-0 p-3 gap-2">
                {!hasItems && (
                    <label htmlFor="zip-input" className={`flex-1 flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed cursor-pointer transition-all ${isDragOver ? 'border-teal-400 bg-teal-500/10' : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-2)]'}`}>
                        <div className={`p-4 rounded-2xl ${isDragOver ? 'bg-teal-500/20' : 'bg-[var(--surface-2)]'}`}>{isDragOver ? <Upload className="w-8 h-8 text-teal-400" /> : <FileArchive className="w-8 h-8 text-[var(--text-3)]" />}</div>
                        <div className="text-center px-4">
                            <p className="text-sm font-semibold text-[var(--text-2)]">{t('zip.drop')}</p>
                            <p className="text-[10px] text-[var(--text-3)] mt-2">{t('zip.hint')}</p>
                        </div>
                        <input id="zip-input" type="file" multiple className="sr-only" onChange={onFileInput} />
                    </label>
                )}

                {hasItems && (
                    <div className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-1.5">
                        <div className="flex items-center gap-2 px-1 mb-1 text-[11px] font-semibold text-[var(--text-3)]">
                            {mode === 'unzip' ? <><PackageOpen className="w-3.5 h-3.5" />{t('zip.extracted')}</> : <><FolderArchive className="w-3.5 h-3.5" />{t('zip.toZip')}</>}
                        </div>
                        {(mode === 'unzip' ? extracted.map((e, i) => ({ key: i, name: e.name })) : inputs.map(i => ({ key: i.id, name: i.file.name, size: i.file.size }))).map((row: any) => (
                            <div key={row.key} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--separator)]">
                                <FileIco className="w-4 h-4 text-[var(--text-3)] shrink-0" />
                                <span className="text-xs text-[var(--text-2)] truncate flex-1">{row.name}</span>
                                {row.size != null && <span className="text-[10px] text-[var(--text-3)] shrink-0">{fmtSize(row.size)}</span>}
                            </div>
                        ))}
                        {status === 'working' && <div className="flex items-center justify-center gap-2 py-3 text-[var(--text-2)] text-xs"><Loader2 className="w-4 h-4 animate-spin" />{t('zip.working')}</div>}
                        {status === 'error' && <div className="text-xs text-red-400 px-1 py-2">{error}</div>}
                        {mode === 'zip' && (
                            <label htmlFor="zip-add" className="flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-[var(--border)] cursor-pointer text-[var(--text-3)] hover:text-[var(--text-2)] text-xs">
                                <Upload className="w-3.5 h-3.5" />{t('zip.addMore')}<input id="zip-add" type="file" multiple className="sr-only" onChange={onFileInput} />
                            </label>
                        )}
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-1.5 px-3 pb-3 shrink-0">
                {mode === 'unzip' ? (
                    <button onClick={handleDownloadExtracted} disabled={!extracted.length || isDownloading}
                        className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold ${!extracted.length ? 'bg-[var(--surface-2)] text-[var(--text-3)] cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}>
                        {isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}{t('zip.saveExtracted')}
                    </button>
                ) : (
                    <button onClick={doZip} disabled={!inputs.length || status === 'working'}
                        className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold ${!inputs.length ? 'bg-[var(--surface-2)] text-[var(--text-3)] cursor-not-allowed' : 'bg-teal-600 hover:bg-teal-500 text-white'}`}>
                        {status === 'working' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderArchive className="w-4 h-4" />}{t('zip.zipBtn', { count: String(inputs.length) })}
                    </button>
                )}
                <ToolIconButton onClick={() => { sessionStore.remove(inputs.map(i => i.id)); onClose(); }} disabled={!hasItems} danger title={t('zip.clear')}><Trash2 className="w-4 h-4" /></ToolIconButton>
            </div>
        </div>
    );
};
