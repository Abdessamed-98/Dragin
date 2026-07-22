/**
 * Zip on the shell — a terminal LIST tool (no carry). Reads session files as
 * rows; one action archives them (Create ZIP → save), or, when the session is a
 * single .zip, extracts it back INTO the session. Uses the focus Body slot for
 * a custom (non-grid) body.
 */
import React, { useState } from 'react';
import { FileArchive, Loader2, Trash2, FolderInput, Package } from 'lucide-react';
import { SessionFile, sessionStore } from '../../state/sessionStore';
import { zipFiles, unzipFile } from '../../services/api';
import { saveOutputs } from '../../services/saveOutput';
import { ToolIconButton } from '../ToolIconButton';
import type { ShellTool, FocusBodyProps } from './shellTools';

const fmtSize = (b: number) => (b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`);
const isZipFile = (f: SessionFile) => /\.zip$/i.test(f.name) || f.kind === 'archive';

const ZipBody: React.FC<FocusBodyProps> = ({ files, onClose }) => {
    const [busy, setBusy] = useState(false);
    const unzipMode = files.length === 1 && isZipFile(files[0]);

    const run = async () => {
        setBusy(true);
        try {
            if (unzipMode) {
                const entries = await unzipFile(files[0].currentFile);
                const fs = await Promise.all(entries.map(async e => new File([await (await fetch(e.dataUrl)).blob()], e.name)));
                sessionStore.remove([files[0].id]);
                if (fs.length) sessionStore.addFiles(fs, null);
            } else {
                const r = await zipFiles(files.map(f => f.currentFile));
                await saveOutputs([{ name: 'archive.zip', url: r.dataUrl }], 'archive');
            }
        } catch (e) { console.error('Zip op failed', e); } finally { setBusy(false); }
    };

    return (
        <div className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1">
                {files.map(f => (
                    <div key={f.id} className="flex items-center gap-2 rounded-lg bg-[var(--surface)] border border-[var(--separator)] px-2.5 py-2">
                        <FileArchive className="w-4 h-4 text-teal-400 shrink-0" />
                        <span className="text-xs text-[var(--text-2)] truncate flex-1">{f.name}</span>
                        <span className="text-[10px] text-[var(--text-3)] shrink-0">{fmtSize(f.currentFile.size)}</span>
                        <button onClick={() => sessionStore.remove([f.id])} className="text-[var(--text-3)] hover:text-[var(--red)] shrink-0"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                ))}
            </div>
            <div className="flex items-center gap-1.5 px-3 pb-3 shrink-0">
                <button onClick={run} disabled={busy || !files.length}
                    className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold bg-teal-600 hover:bg-teal-500 text-white disabled:opacity-40">
                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : unzipMode ? <FolderInput className="w-4 h-4" /> : <Package className="w-4 h-4" />}
                    {unzipMode ? 'Extract' : 'Create ZIP'}
                </button>
                <div className="flex-1 flex items-center gap-1">
                    <ToolIconButton onClick={() => { sessionStore.remove(files.map(f => f.id)); onClose(); }} disabled={!files.length} danger title="Clear all"><Trash2 className="w-4 h-4" /></ToolIconButton>
                </div>
            </div>
        </div>
    );
};

export const zipTool: ShellTool = {
    id: 'zip', kind: 'focus', accent: 'teal', Icon: FileArchive, titleKey: 'zip.title',
    accept: () => true, inputAccept: '*',
    emptyTitleKey: 'zip.title', Body: ZipBody,
};
