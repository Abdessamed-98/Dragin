/**
 * ToolShell — the ONE persistent panel chrome for shell-enabled tools.
 *
 * Rendered once by SideDock; the `toolId` prop changes as the user rail-switches
 * among shell tools. Because this instance (and its FileGrid) never remounts on
 * a switch, the <img> nodes persist — only the header, the Controls slot, the
 * footer action, and the accent change. That's the whole "shared container"
 * win: switching a tool ≠ rebuilding a tool.
 *
 * Structure:
 *   ToolHeader (reused)                     ← title/icon/count, props change
 *   descriptor.Controls (keyed by toolId)   ← the only rich per-tool UI; swaps
 *   FileGrid (persistent)                   ← session files + this tool's overlay
 *   ToolFooter                              ← run/save + copy/paste/clear
 *   <ShellIngestor key={toolId}/>           ← headless; fresh `seen` per tool
 *
 * The controller lives here (not in the keyed ingestor) so the footer's Run can
 * call it. Two correctness points the design turns on:
 *   • REPROCESS FROM INPUT, not currentFile. Each item's `input` is captured at
 *     ingest (currentFile at arrival). The tool's own applyResult bumps revision
 *     but is self-output-guarded (no re-ingest), so `input` stays the pre-tool
 *     file — re-running with new settings never double-applies. A DIFFERENT tool
 *     changing the file DOES re-ingest, updating `input` (correct pipeline).
 *   • DONE STATE CARRIES THE POST-applyResult REVISION, so the grid sees it as
 *     fresh; a later change by another tool bumps revision → ingest resets idle.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import { sessionStore, useSession, useSessionIngest, IngestItem, SessionFile } from '../../state/sessionStore';
import { processingStore, useToolItems, ItemState } from '../../state/processingStore';
import { useToolUi } from '../../state/toolUiStore';
import { runPool } from '../../utils/pool';
import { useI18n } from '../../i18n/I18nContext';
import { ToolId } from '../../types';
import { ToolHeader } from '../ToolHeader';
import { FileGrid } from './FileGrid';
import { FocusEmpty } from './FocusView';
import { ToolFooter, DoneOutput } from './ToolFooter';
import { SHELL_TOOLS } from './shellTools';
import { accentOf } from './accents';

interface ToolShellProps {
    toolId: ToolId;
    onClose: () => void;
    onOpenSettings?: () => void;
}

// Headless ingest binding, keyed by toolId so each tool gets a FRESH `seen` map
// (a single shared useSessionIngest would leak seen-revisions across tools).
const ShellIngestor: React.FC<{
    toolId: ToolId;
    accept: (f: SessionFile) => boolean;
    onIngest: (batch: IngestItem[]) => void;
    onRemove: (ids: string[]) => void;
}> = ({ toolId, accept, onIngest, onRemove }) => {
    useSessionIngest(true, toolId, accept, onIngest, onRemove);
    return null;
};

export const ToolShell: React.FC<ToolShellProps> = ({ toolId, onClose, onOpenSettings }) => {
    const { t: tt } = useI18n();
    // Descriptor i18n keys are plain strings (dynamic per tool), so bypass the
    // strict compile-time key union.
    const t = tt as (k: string) => string;
    const desc = SHELL_TOOLS[toolId]!;
    const ac = accentOf(desc.accent);

    const [state, set] = useToolUi(toolId, desc.defaults ?? {});
    const stateRef = useRef(state);
    stateRef.current = state;

    const { files: allFiles } = useSession();
    const files = allFiles.filter(desc.accept);
    const items = useToolItems(toolId);

    // Transform ONE file by id: read its `input` (captured at ingest, pre-tool),
    // run the descriptor, then write `done` with the POST-applyResult revision.
    const runOne = useCallback(async (fileId: string) => {
        const snap = () => sessionStore.getSnapshot().files.find(f => f.id === fileId);
        const f = snap();
        if (!f || !desc.process) return;
        const prev = processingStore.getTool(toolId)[fileId];
        const input = prev?.input ?? f.currentFile;
        processingStore.setItem(toolId, fileId, { status: 'processing', revision: f.revision, input, progress: undefined });
        const onProgress = (pct: number) => processingStore.setItem(toolId, fileId, { status: 'processing', revision: f.revision, input, progress: pct });
        try {
            const { resultUrl, badge } = await desc.process({ id: fileId, file: input, name: f.name }, stateRef.current, onProgress);
            const nf = snap();
            processingStore.setItem(toolId, fileId, { status: 'done', revision: nf?.revision ?? f.revision, resultUrl, badge, input, progress: undefined });
        } catch (e: any) {
            processingStore.setItem(toolId, fileId, { status: 'error', revision: f.revision, error: e?.message ?? String(e), input });
        }
    }, [toolId, desc]);

    // Ingest: seed idle (capturing input = currentFile at arrival); auto-run the
    // direct drops when the tool opts in.
    const onIngest = useCallback((batch: IngestItem[]) => {
        const snap = sessionStore.getSnapshot().files;
        const direct: string[] = [];
        for (const it of batch) {
            const f = snap.find(x => x.id === it.id);
            processingStore.setItem(toolId, it.id, { status: 'idle', revision: it.revision, input: f?.currentFile ?? it.file });
            if (it.direct && desc.autoProcessDirect) direct.push(it.id);
        }
        if (direct.length) runPool(direct, runOne, desc.concurrency ?? 3);
    }, [toolId, desc, runOne]);

    const onRemove = useCallback((ids: string[]) => processingStore.removeItems(toolId, ids), [toolId]);

    // Manual run of every idle item (the footer action button).
    const processIdle = useCallback(() => {
        const map = processingStore.getTool(toolId);
        const idle = files.filter(f => map[f.id]?.status === 'idle').map(f => f.id);
        if (idle.length) runPool(idle, runOne, desc.concurrency ?? 3);
    }, [toolId, files, runOne, desc]);

    // Settings changed WITHIN this tool → mark processed items idle so the user
    // re-runs with the new settings (manual, matching the carried-files policy).
    // Skip on tool switch (state legitimately changes to the new tool's values).
    const stateKey = JSON.stringify(state);
    const lastToolRef = useRef(toolId);
    const lastKeyRef = useRef(stateKey);
    useEffect(() => {
        if (lastToolRef.current !== toolId) { lastToolRef.current = toolId; lastKeyRef.current = stateKey; return; }
        if (lastKeyRef.current === stateKey) return;
        lastKeyRef.current = stateKey;
        const map = processingStore.getTool(toolId);
        for (const f of files) {
            const st = map[f.id];
            if (st && st.status !== 'idle' && st.status !== 'processing') {
                processingStore.setItem(toolId, f.id, { status: 'idle', revision: f.revision, input: st.input });
            }
        }
    }, [stateKey, toolId]); // eslint-disable-line react-hooks/exhaustive-deps

    const addFiles = useCallback((incoming: File[]) => {
        const ok = incoming.filter(f => desc.accept({ currentFile: f, kind: 'image' } as SessionFile));
        if (ok.length) sessionStore.addFiles(ok, toolId);
    }, [toolId, desc]);

    // Footer derived state. Pure editor tools (no process, e.g. cropper) never
    // show a Run button; their "done" outputs are files this tool last touched.
    const fresh = (f: SessionFile): ItemState | undefined => { const s = items[f.id]; return s && s.revision === f.revision ? s : undefined; };
    const isEditorTool = !desc.process;
    const hasIdle = !isEditorTool && files.some(f => { const s = items[f.id]; return !s || s.status === 'idle'; });
    const anyProcessing = files.some(f => fresh(f)?.status === 'processing');
    const doneOutputs: DoneOutput[] = isEditorTool
        ? files.filter(f => f.provenance[f.provenance.length - 1] === toolId)
            .map(f => ({ name: f.name, url: f.currentUrl, path: (f.originalFile as any).path ?? null }))
        : files.filter(f => fresh(f)?.status === 'done')
            .map(f => ({ name: f.name, url: fresh(f)!.resultUrl || f.currentUrl, path: (f.currentFile as any).path ?? null }));
    // Cell-editor overlay (remover magic-brush, cropper). Reset on tool switch.
    const [editingId, setEditingId] = React.useState<string | null>(null);
    useEffect(() => { setEditingId(null); }, [toolId]);

    // Editor tools (autoEditSingle): a LONE file opens straight in the editor —
    // multiple files stay in the grid, click one to edit. Only fires when the
    // count ARRIVES at 1 (0→1 or on tool entry), so closing the editor with one
    // file loaded doesn't bounce back in.
    const prevEditCountRef = useRef(-1);
    const prevEditToolRef = useRef<ToolId | null>(null);
    useEffect(() => {
        const switched = prevEditToolRef.current !== toolId;
        prevEditToolRef.current = toolId;
        const prev = switched ? 0 : prevEditCountRef.current;
        prevEditCountRef.current = files.length;
        if (desc.autoEditSingle && desc.CellEditor && files.length === 1 && prev === 0) {
            setEditingId(files[0].id);
        }
    }, [files.length, toolId]); // eslint-disable-line react-hooks/exhaustive-deps

    // Backend capability probe (e.g. upscaler → Real-ESRGAN). Undefined = unknown/ok.
    const [available, setAvailable] = React.useState<boolean | undefined>(undefined);
    useEffect(() => {
        if (!desc.checkAvailable) { setAvailable(undefined); return; }
        let alive = true;
        desc.checkAvailable().then(ok => { if (alive) setAvailable(ok); }).catch(() => { if (alive) setAvailable(false); });
        return () => { alive = false; };
    }, [toolId]); // eslint-disable-line react-hooks/exhaustive-deps

    const canRun = (desc.canRun ? desc.canRun(state, files) : true) && available !== false;

    // Global "clear all data" removes files from the session → useSessionIngest's
    // onRemove fires → processingStore is pruned automatically. No local handler.
    const clearAll = () => { sessionStore.remove(files.map(f => f.id)); onClose(); };

    const Controls = desc.Controls;

    // FOCUS archetype — single-image analyzer/editor. Shares the header + the
    // live-session read (instant switch, no flash); its Body owns everything else.
    if (desc.kind === 'focus' && desc.Body) {
        const Body = desc.Body;
        // Wrapped legacy tools (pdf) own their header/empty — give them the panel.
        if (desc.hideHeader) {
            return (
                <div className="absolute inset-0 flex flex-col rounded-2xl overflow-hidden">
                    <Body files={files} accent={desc.accent} inputAccept={desc.inputAccept} onAddFiles={addFiles} onClose={onClose} />
                </div>
            );
        }
        return (
            <div className="absolute inset-0 flex flex-col rounded-2xl overflow-hidden">
                <ToolHeader icon={<desc.Icon className={`w-4 h-4 ${ac.icon}`} />} title={t(desc.titleKey)} count={files.length} onClose={onClose} onSettings={onOpenSettings} />
                {files.length === 0
                    ? <FocusEmpty accent={desc.accent} inputAccept={desc.inputAccept} icon={<desc.Icon className="w-8 h-8 text-[var(--text-3)]" />} title={t(desc.emptyTitleKey)} hint={desc.emptyHintKey ? t(desc.emptyHintKey) : undefined} onAddFiles={addFiles} />
                    : <Body files={files} accent={desc.accent} inputAccept={desc.inputAccept} onAddFiles={addFiles} onClose={onClose} />}
            </div>
        );
    }

    return (
        <div className="absolute inset-0 flex flex-col rounded-2xl overflow-hidden">
            <ToolHeader
                icon={<desc.Icon className={`w-4 h-4 ${ac.icon}`} />}
                title={t(desc.titleKey)}
                count={files.length}
                onClose={onClose}
                onSettings={onOpenSettings}
            />

            {Controls && files.length > 0 && (
                <div key={`controls-${toolId}`}>
                    <Controls state={state} set={set} files={files} />
                </div>
            )}

            <FileGrid
                files={files}
                items={items}
                accent={desc.accent}
                inputAccept={desc.inputAccept}
                emptyIcon={<desc.Icon className="w-8 h-8 text-[var(--text-3)]" />}
                emptyTitle={t(desc.emptyTitleKey)}
                emptyHint={desc.emptyHintKey ? t(desc.emptyHintKey) : undefined}
                onAddFiles={addFiles}
                cellAspect={undefined}
                showOriginal={(state as any).showOriginal === true}
                transparent={desc.transparent}
                onCellClick={desc.CellEditor ? (f => setEditingId(f.id)) : undefined}
                cellClickMode={desc.cellEditOnClick}
            />

            {/* Per-cell editor overlay (remover magic-brush) */}
            {desc.CellEditor && editingId && (() => {
                const ef = files.find(f => f.id === editingId);
                if (!ef) return null;
                const Editor = desc.CellEditor;
                return (
                    <div className="absolute inset-0 z-[60] rounded-2xl overflow-hidden">
                        <Editor file={ef} onClose={() => setEditingId(null)} />
                    </div>
                );
            })()}

            {available === false && desc.unavailableKey && (
                <div className="mx-3 mb-2 rounded-lg bg-amber-500/10 border border-amber-500/30 px-3 py-2 text-[11px] text-amber-300 shrink-0">
                    {t(desc.unavailableKey)}
                </div>
            )}

            <ToolFooter
                accent={desc.accent}
                actionIcon={<desc.Icon className="w-4 h-4" />}
                actionLabel={t(desc.actionLabelKey ?? desc.titleKey)}
                hasIdle={hasIdle}
                canRun={canRun}
                anyProcessing={anyProcessing}
                hasFiles={files.length > 0}
                onRun={processIdle}
                doneOutputs={doneOutputs}
                saveFolder={toolId}
                onAddFiles={addFiles}
                onClear={clearAll}
            />

            <ShellIngestor key={`ingestor-${toolId}`} toolId={toolId} accept={desc.accept} onIngest={onIngest} onRemove={onRemove} />
        </div>
    );
};
