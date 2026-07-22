import React, { useState, useEffect, useCallback, useRef, Component, ErrorInfo } from 'react';
import { SideDock, DockEdge } from './SideDock';
import { ActiveSession, ToolId, SessionItem } from '../types';
import { useElectron } from '../hooks/useElectron';
import { dlog } from '../utils/dockLogger';
import { useI18n } from '../i18n/I18nContext';
import {
    compressImage,
    cropImage,
    removeBackgroundBen2,
    checkBen2ModelLoaded,
    unloadBen2Model,
} from '../services/api';
import { sessionStore, useSessionHasFiles, useSessionCount, useSessionIngest } from '../state/sessionStore';
import { toolAccepts } from '../state/toolCompat';
import { runPool } from '../utils/pool';



// While dragging a file, the dock stays revealed only when the cursor is within
// this margin (px) around the rail tongue's box, so it collapses when you drag
// away from the tongue rather than across the whole wide window.
const REVEAL_MARGIN = 100;
// A file-drag reveals the dock only when it reaches this strip at the right edge
// (matches the green debug zone / the main-process edge watcher).
const EDGE_TRIGGER = 16;
// Rail tongue geometry — must mirror SideDock's rail constants.
const RAIL_TILE = 80, RAIL_PAD = 8, RAIL_GAP = 10;

// Catch unhandled errors that could kill the dock
window.addEventListener('error', (e) => dlog('UNCAUGHT', { message: e.message, filename: e.filename, line: e.lineno, col: e.colno }));
window.addEventListener('unhandledrejection', (e) => dlog('UNHANDLED_PROMISE', { reason: String(e.reason) }));

// Small wrapper for crash UI (class components can't use hooks)
const CrashMessage: React.FC<{ error: Error }> = ({ error }) => {
    let t: (key: string) => string;
    try {
        const i18n = useI18n();
        t = i18n.t as any;
    } catch {
        // If context is broken, fall back to Arabic
        t = (key: string) => {
            const fallback: Record<string, string> = {
                'dock.crashed': 'الشريط توقف عن العمل',
                'dock.restart': 'إعادة تشغيل',
            };
            return fallback[key] || key;
        };
    }
    return (
        <div className="min-h-screen w-full flex items-center justify-end bg-transparent">
            <div
                className="w-[280px] mr-4 flex flex-col items-center gap-3 p-6 rounded-2xl bg-slate-900/95 border border-red-800/40 text-red-300 text-xs backdrop-blur-sm pointer-events-auto"
                style={{ direction: 'rtl' }}
            >
                <span className="text-sm font-bold text-red-400">{t('dock.crashed')}</span>
                <span className="text-red-300/70 text-center text-[11px] leading-relaxed max-w-[220px] break-words">
                    {error.message}
                </span>
                <button
                    onClick={() => window.location.reload()}
                    className="mt-1 px-5 py-2 rounded-xl bg-red-800/40 hover:bg-red-700/50 text-red-200 text-xs font-bold transition-colors"
                >
                    {t('dock.restart')}
                </button>
            </div>
        </div>
    );
};

// ── Top-level Error Boundary ─────────────────────────────────────────────
// Catches any unhandled render error in the entire dock tree.
// Forces the window to stay visible so the user can see recovery UI.
class DockErrorBoundary extends Component<
    { children: React.ReactNode },
    { error: Error | null }
> {
    state: { error: Error | null } = { error: null };

    static getDerivedStateFromError(error: Error) {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        dlog('FATAL_ERROR_BOUNDARY', {
            message: error.message,
            stack: error.stack?.split('\n').slice(0, 8),
            componentStack: info.componentStack?.split('\n').slice(0, 10),
        });
        // Force dock window to full width + interactive so the crash UI is visible
        window.electron?.resizeDock(540);
        window.electron?.setIgnoreMouseEvents(false);
        window.electron?.sendDockMode('active');
    }

    render() {
        if (this.state.error) {
            return <CrashMessage error={this.state.error} />;
        }
        return this.props.children;
    }
}

const DockAppInner: React.FC = () => {
    const { activeToolIds, isDockEnabled, isGalleryOpen, isDockPinned, dispatch, setIgnoreMouseEvents, openGallery, resizeDock, sendDockMode, shelfSave, shelfLoad, shelfDelete } = useElectron();

    const [isDragging, setIsDragging] = useState(false);
    const [isToolDragging] = useState(false); // For internal reorder or from gallery (if across windows, tricky)

    // Which screen edge the dock lives on (synced from the gallery via settings).
    const [edge, setEdge] = useState<DockEdge>('right');
    useEffect(() => {
        window.electron?.getSetting?.('dockEdge').then((v: any) => { if (v) setEdge(v); });
        window.electron?.onSettingChange?.(({ key, value }) => { if (key === 'dockEdge' && value) setEdge(value); });
    }, []);

    // Sessions stored locally in Dock Window (Processor)
    const [sessions, setSessions] = useState<Record<string, ActiveSession | undefined>>({});
    const [expandedToolId, setExpandedToolId] = useState<ToolId | null>(null);
    const expandedToolIdRef = useRef<ToolId | null>(null);
    useEffect(() => { expandedToolIdRef.current = expandedToolId; }, [expandedToolId]);
    // Last tool the user worked in — the ONE tile that wears the session badge.
    // (Per-tool counts would show the same shared file on every visited tile.)
    const [lastToolId, setLastToolId] = useState<ToolId | null>(null);
    useEffect(() => { if (expandedToolId) setLastToolId(expandedToolId); }, [expandedToolId]);
    const [lastFocusedItemId, setLastFocusedItemId] = useState<string | null>(null);

    // Self-contained tools now ingest files from the shared session store
    // (src/state/sessionStore.ts) — the old per-tool droppedFiles plumbing is gone.

    // Whether the remover (BEN2) model is currently being loaded (first inference)
    const [removerModelLoading, setRemoverModelLoading] = useState(false);

    // Clear signal for self-contained tools
    const [clearGen, setClearGen] = useState(0);

    const { onClearDataConfirmed } = useElectron();

    useEffect(() => {
        onClearDataConfirmed(() => {
            sessionStore.clear();
            setSessions({});
            setClearGen(g => g + 1);
        });
    }, [onClearDataConfirmed]);

    // Load persisted shelf items on startup
    useEffect(() => {
        shelfLoad().then(items => {
            if (items.length === 0) return;
            setSessions(prev => ({
                ...prev,
                shelf: {
                    id: 'shelf-persistent',
                    toolId: 'shelf' as ToolId,
                    items: items.map(item => ({
                        id: item.id,
                        file: new File([], item.name),
                        originalUrl: item.url,
                        processedUrl: item.url,
                        status: 'completed' as const,
                    })),
                    selectedItemIds: [],
                    status: 'completed' as const,
                }
            }));
        });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // --- Visibility Logic ---
    // The dock is visible if:
    // 1. A tool is expanded
    // 2. We are dragging files
    // 3. Any tool holds files (persistent until cleared)
    // 4. The Library Window is open

    const hasAnyFiles = Object.values(sessions).some(
        session => session != null && session.items.length > 0
    );
    // Shared session (self-contained tools + carry-over) also keeps the dock alive.
    // Boolean selector: re-renders the dock tree only when emptiness flips.
    const sessionHasFiles = useSessionHasFiles();
    const sessionCount = useSessionCount();
    // ONE badge for the shared session (on the last-used tool); shelf keeps its
    // own count — it's separate persistent storage, not part of the session.
    const badgeCounts: Partial<Record<ToolId, number>> = {};
    if (lastToolId && lastToolId !== 'shelf' && sessionCount > 0) badgeCounts[lastToolId] = sessionCount;
    const shelfCount = sessions['shelf']?.items.length ?? 0;
    if (shelfCount > 0) badgeCounts['shelf'] = shelfCount;
    // Last self-tool counts (ref only — visibility no longer reads these, since
    // hidden tools' counts go stale until they reconcile on activation).
    const selfCountRef = useRef<Record<string, number>>({});
    // Whether the CURRENTLY expanded tool has shown files during THIS activation.
    // Reset on every switch — so opening an already-empty tool (its files were
    // deleted elsewhere) does NOT read a stale >0 and collapse itself (the
    // open-then-close flicker). Only a genuine files→empty while viewing collapses.
    const sawFilesRef = useRef(false);
    useEffect(() => { sawFilesRef.current = false; }, [expandedToolId]);
    const handleSelfItemCountChange = useCallback((toolId: string, count: number) => {
        selfCountRef.current[toolId] = count;
        if (expandedToolIdRef.current !== (toolId as ToolId)) return;
        if (count > 0) { sawFilesRef.current = true; return; }
        // Emptied while viewing (last item cleared/dragged out) → collapse to rail.
        // Opened already-empty (sawFiles=false) → stay open on the dropzone.
        if (sawFilesRef.current) setExpandedToolId(null);
    }, []);
    // NOTE: hidden tools' local counts go stale (they only reconcile while active),
    // so visibility must NOT depend on them — the session store is the truth.
    const isInteractionActive = expandedToolId !== null || isDragging || hasAnyFiles || sessionHasFiles || isGalleryOpen || isDockPinned;
    const isVisible = isDockEnabled && isInteractionActive;

    // --- Dock diagnostics ---
    const prevVisibleRef = useRef(isVisible);
    if (prevVisibleRef.current !== isVisible) {
        dlog('visibility', {
            visible: isVisible,
            reason: { isDockEnabled, expandedToolId, isDragging, hasAnyFiles, isGalleryOpen },
        });
        prevVisibleRef.current = isVisible;
    }

    // ============================================================
    // MAIN-PROCESS EDGE DETECTION STRATEGY
    // ============================================================
    // The main process polls cursor position every 100ms.
    // When cursor hits the right screen edge (~8px), it enables
    // mouse events so file drags can be detected.
    //
    // IDLE MODE (main process controls):
    //   - Edge polling active, click-through when not at edge
    //   - Renderer sends 'dock-mode: idle'
    //
    // ACTIVE MODE (renderer controls):
    //   - Edge polling stopped, renderer uses interactive islands
    //   - Renderer sends 'dock-mode: active'
    // ============================================================

    // --- Tell main process when we switch modes ---
    const isMouseInsideRef = useRef(false);

    useEffect(() => {
        if (isVisible) {
            sendDockMode('active');
            if (!isDragging && !isMouseInsideRef.current) {
                dlog('click-through', { on: true, reason: 'visible-but-no-interaction' });
                setIgnoreMouseEvents(true, { forward: true });
            }
        } else {
            dlog('mode', { mode: 'idle' });
            sendDockMode('idle');
        }
    }, [isVisible, isDragging, expandedToolId, sendDockMode, setIgnoreMouseEvents]);

    // --- Fixed Window Width ---
    // The window no longer shrinks when idle. Resizing between 16px and 540px
    // caused a one-frame Windows setBounds position/size desync that flashed the
    // edge-anchored content to the left. Since the tongue now reveals via scaleX
    // (not by the window growing), the window can stay a constant width and is
    // simply click-through when idle. Set once on mount.
    useEffect(() => {
        resizeDock(540);
    }, [resizeDock]);

    // --- Interactive Islands ---
    const leaveTimerRef = React.useRef<NodeJS.Timeout | null>(null);

    const handleInteractiveEnter = () => {
        if (leaveTimerRef.current) {
            clearTimeout(leaveTimerRef.current);
            leaveTimerRef.current = null;
        }
        isMouseInsideRef.current = true;
        dlog('mouse', { inside: true });
        setIgnoreMouseEvents(false);
    };

    const handleInteractiveLeave = () => {
        if (isDragging) return;
        isMouseInsideRef.current = false;
        leaveTimerRef.current = setTimeout(() => {
            dlog('mouse', { inside: false, clickThrough: true });
            setIgnoreMouseEvents(true, { forward: true });
            leaveTimerRef.current = null;
        }, 50);
    };

    // When dragging stops, restore click-through (unless mouse is inside a widget)
    useEffect(() => {
        if (!isDragging && isVisible && !isMouseInsideRef.current) {
            setIgnoreMouseEvents(true, { forward: true });
        }
    }, [isDragging, isVisible, setIgnoreMouseEvents]);

    // --- Drag Detection (window-level listeners) ---
    const dragTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

    const handleWindowDragOver = useCallback((e: DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';

        // Reveal only when the drag reaches the edge strip. Once revealed, keep
        // the rail alive while the drag stays within the tongue's box + margin;
        // leaving that box collapses it. Edge-generalized: the strip + box flip to
        // whichever edge the dock lives on.
        const n = activeToolIds.length;
        const railThickness = RAIL_TILE + RAIL_PAD * 2;                 // perpendicular to edge
        const railLength = n > 0 ? n * RAIL_TILE + (n - 1) * RAIL_GAP + RAIL_PAD * 2 : RAIL_TILE + RAIL_PAD * 2;
        const W = window.innerWidth, H = window.innerHeight, m = REVEAL_MARGIN;
        const isVertical = edge === 'right' || edge === 'left';

        // Tongue rect in window coords (rail size, centred along the edge).
        let x0: number, x1: number, y0: number, y1: number;
        if (isVertical) {
            y0 = (H - railLength) / 2; y1 = (H + railLength) / 2;
            if (edge === 'right') { x0 = W - railThickness; x1 = W; } else { x0 = 0; x1 = railThickness; }
        } else {
            x0 = (W - railLength) / 2; x1 = (W + railLength) / 2;
            if (edge === 'top') { y0 = 0; y1 = railThickness; } else { y0 = H - railThickness; y1 = H; }
        }
        const inBox = e.clientX >= x0 - m && e.clientX <= x1 + m && e.clientY >= y0 - m && e.clientY <= y1 + m;

        // Edge strip: reveals AND keeps the tongue visible. Box: keeps it alive once shown.
        const inEdge = edge === 'right' ? e.clientX >= W - EDGE_TRIGGER
            : edge === 'left' ? e.clientX <= EDGE_TRIGGER
            : edge === 'top' ? e.clientY <= EDGE_TRIGGER
            : e.clientY >= H - EDGE_TRIGGER;

        // Reveal via the edge; stay alive while in the edge OR the box.
        const active = inEdge || (isDragging && inBox);

        if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);

        if (active) {
            if (!isDragging) setIsDragging(true);
            dragTimeoutRef.current = setTimeout(() => setIsDragging(false), 1500);
        } else if (isDragging) {
            setIsDragging(false);
        }
    }, [isDragging, activeToolIds.length, edge]);

    const handleWindowDragLeave = useCallback((e: DragEvent) => {
        e.preventDefault();
        if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
            setIsDragging(false);
        }
    }, []);

    const handleWindowDrop = useCallback((e: DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    }, []);

    // dragend fires when ANY drag operation completes (successful or cancelled)
    // This catches the case where focus switches mid-drag and drop/dragleave don't fire
    const handleWindowDragEnd = useCallback(() => {
        setIsDragging(false);
    }, []);

    useEffect(() => {
        window.addEventListener('dragover', handleWindowDragOver as any);
        window.addEventListener('dragleave', handleWindowDragLeave as any);
        window.addEventListener('drop', handleWindowDrop as any);
        window.addEventListener('dragend', handleWindowDragEnd as any);
        return () => {
            window.removeEventListener('dragover', handleWindowDragOver as any);
            window.removeEventListener('dragleave', handleWindowDragLeave as any);
            window.removeEventListener('drop', handleWindowDrop as any);
            window.removeEventListener('dragend', handleWindowDragEnd as any);
        };
    }, [handleWindowDragOver, handleWindowDragLeave, handleWindowDrop, handleWindowDragEnd]);

    // Tools that only make sense with a single file (they open a full overlay UI)
    const SINGLE_FILE_TOOLS = new Set<ToolId>(['cropper']);

    // Compressor quality (shared across all compressor items)
    const [compressorQuality, setCompressorQuality] = useState(70);

    // --- Processing Logic ---
    // ALL drops now land in the shared session store; every tool (self-contained
    // via useSessionIngest inside the component, session tools via the bridge
    // below) ingests from there. That single change is what makes tool-switching
    // with carry-over work. Shelf is the exception: persistent storage, own path.
    const handleToolDrop = async (files: File[], toolId: ToolId) => {
        dlog('drop', { toolId, fileCount: files.length, names: files.map(f => f.name) });
        setExpandedToolId(toolId);

        if (toolId === 'shelf') {
            let sessionId: string;
            const currentSession = sessions[toolId];
            sessionId = currentSession ? currentSession.id : Math.random().toString(36).substring(2, 11);
            const newItems: SessionItem[] = files.map(file => ({
                id: Math.random().toString(36).substring(2, 11),
                file,
                originalUrl: URL.createObjectURL(file),
                status: 'pending'
            }));
            setSessions(prev => {
                const prevSession = prev[toolId];
                const updatedItems = prevSession ? [...prevSession.items, ...newItems] : newItems;
                return {
                    ...prev,
                    [toolId]: {
                        id: sessionId, toolId, items: updatedItems,
                        selectedItemIds: prevSession ? prevSession.selectedItemIds : [],
                        status: 'processing'
                    }
                };
            });
            newItems.forEach(item => processItem(sessionId, item.id, item.file, toolId));
            return;
        }

        sessionStore.addFiles(Array.from(files), toolId);
    };

    // ── Session-tool bridge ──────────────────────────────────────────────────
    // remover/compressor/cropper still use the ToolWidget session UI. This bridge
    // ingests session-store files into their ActiveSession while they're the
    // expanded tool. DIRECT drops auto-process (same beloved behavior as always);
    // files CARRIED here via a rail switch enter 'idle' and wait for the manual
    // action button (see handleProcessIdle) — switching tools never burns CPU.
    const sessionsRef = useRef(sessions);
    useEffect(() => { sessionsRef.current = sessions; }, [sessions]);

    const ingestSessionTool = useCallback((toolId: 'remover' | 'compressor' | 'cropper', batch: { id: string; file: File; direct: boolean }[]) => {
        if (!batch.length) return;
        let incoming = batch;
        if (SINGLE_FILE_TOOLS.has(toolId)) incoming = incoming.slice(0, 1);

        const prevSession = sessionsRef.current[toolId];
        const sessionId = prevSession ? prevSession.id : Math.random().toString(36).substring(2, 11);
        const newItems: SessionItem[] = incoming.map(b => ({
            id: b.id, // session-store id — keys the write-back in applyResult
            file: b.file,
            originalUrl: URL.createObjectURL(b.file),
            status: b.direct ? 'pending' : 'idle'
        }));

        setSessions(prev => {
            const s = prev[toolId];
            // Re-ingest replaces same-id items (revision bumps), keeps the rest.
            const kept = (s?.items || []).filter(i => !newItems.some(n => n.id === i.id));
            return {
                ...prev,
                [toolId]: {
                    id: sessionId, toolId,
                    items: [...kept, ...newItems],
                    selectedItemIds: s?.selectedItemIds || [],
                    status: newItems.some(n => n.status === 'pending') ? 'processing' : (s?.status || 'idle')
                }
            };
        });

        const toProcess = newItems.filter(n => n.status === 'pending');
        if (!toProcess.length) return;
        if (toolId === 'remover') {
            toProcess.forEach(item => updateItemStatus(toolId, sessionId, item.id, { status: 'processing' }));
            processRemoverBatch(sessionId, toProcess);
        } else {
            runPool(toProcess, item => processItem(sessionId, item.id, item.file, toolId));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Manual trigger for carried (idle) items — wired to the tool's action button.
    const handleProcessIdle = useCallback((toolId: ToolId) => {
        const session = sessionsRef.current[toolId];
        if (!session) return;
        const idle = session.items.filter(i => i.status === 'idle');
        if (!idle.length) return;
        if (toolId === 'remover') {
            idle.forEach(item => updateItemStatus(toolId, session.id, item.id, { status: 'processing' }));
            processRemoverBatch(session.id, idle);
        } else {
            runPool(idle, item => processItem(session.id, item.id, item.file, toolId));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const removeSessionToolItems = useCallback((toolId: ToolId, ids: string[]) => {
        setSessions(prev => {
            const s = prev[toolId];
            if (!s) return prev;
            const items = s.items.filter(i => !ids.includes(i.id));
            if (!items.length) return { ...prev, [toolId]: undefined };
            return { ...prev, [toolId]: { ...s, items, selectedItemIds: s.selectedItemIds.filter(id => !ids.includes(id)) } };
        });
    }, []);

    // Deleting session files in ANY tool must immediately clean the hidden
    // session-tool mirrors too (their ingest hooks only reconcile while active).
    useEffect(() => {
        const prune = () => {
            const live = new Set(sessionStore.getSnapshot().files.map(f => f.id));
            setSessions(prev => {
                let changed = false;
                const next = { ...prev };
                for (const toolId of ['remover', 'compressor', 'cropper'] as ToolId[]) {
                    const s = prev[toolId];
                    if (!s) continue;
                    const items = s.items.filter(i => live.has(i.id));
                    if (items.length !== s.items.length) {
                        changed = true;
                        next[toolId] = items.length
                            ? { ...s, items, selectedItemIds: s.selectedItemIds.filter(id => items.some(i => i.id === id)) }
                            : undefined;
                    }
                }
                return changed ? next : prev;
            });
        };
        return sessionStore.subscribe(prune);
    }, []);

    useSessionIngest(expandedToolId === 'remover', 'remover', f => toolAccepts('remover', f),
        b => ingestSessionTool('remover', b), ids => removeSessionToolItems('remover', ids));
    // Compressor migrated to the shell (SHELL_TOOLS) — its ToolShell owns ingest
    // + processing now. Disabled here so it can't double-process. (remover/cropper
    // stay on this session path until they migrate.)
    useSessionIngest(false, 'compressor', f => toolAccepts('compressor', f),
        b => ingestSessionTool('compressor', b), ids => removeSessionToolItems('compressor', ids));
    useSessionIngest(expandedToolId === 'cropper', 'cropper', f => toolAccepts('cropper', f),
        b => ingestSessionTool('cropper', b), ids => removeSessionToolItems('cropper', ids));

    // Output name for a session-tool transform (mirrors ToolWidget's download naming).
    const outNameFor = (originalName: string, toolId: ToolId): string => {
        const suffix = ({ remover: 'BGremoved', compressor: 'compressed', cropper: 'cropped' } as Record<string, string>)[toolId] || 'processed';
        const lastDot = originalName.lastIndexOf('.');
        const base = lastDot === -1 ? originalName : originalName.substring(0, lastDot);
        const ext = toolId === 'remover' ? '.png' : (lastDot === -1 ? '.png' : originalName.substring(lastDot));
        return `${base}-${suffix}${ext}`;
    };

    /** Background Remover (BEN2): single model, no modes. The "Loading model..."
     *  label shows until the first result while the model loads on first use. */
    const processRemoverBatch = async (sessionId: string, items: SessionItem[]) => {
        const modelReady = await checkBen2ModelLoaded();
        if (!modelReady) setRemoverModelLoading(true);
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            try {
                const url = await removeBackgroundBen2(item.file);
                if (i === 0 && !modelReady) setRemoverModelLoading(false);
                updateItemStatus('remover', sessionId, item.id, { processedUrl: url, status: 'completed' });
                // Session write-back: the cutout becomes the file's current state,
                // so switching to another tool carries the RESULT.
                sessionStore.applyResult(item.id, url, outNameFor(item.file.name, 'remover'), 'remover');
            } catch {
                if (i === 0 && !modelReady) setRemoverModelLoading(false);
                updateItemStatus('remover', sessionId, item.id, { status: 'error' });
            }
        }
        setRemoverModelLoading(false);
        checkSessionCompletion('remover', sessionId);
    };

    const processItem = async (sessionId: string, itemId: string, file: File, toolId: ToolId, quality?: number) => {
        updateItemStatus(toolId, sessionId, itemId, { status: 'processing' });

        try {
            let updates: Partial<SessionItem> = { status: 'completed' };

            switch (toolId) {
                case 'compressor':
                    const compResult = await compressImage(file, quality ?? compressorQuality);
                    updates.processedUrl = compResult.url;
                    updates.metadata = {
                        originalSize: compResult.originalSize,
                        newSize: compResult.newSize,
                        savedPercentage: compResult.saved
                    };
                    // Session write-back so the compressed file carries to the next tool.
                    sessionStore.applyResult(itemId, compResult.url, outNameFor(file.name, 'compressor'), 'compressor');
                    break;
                case 'shelf': {
                    const buffer = await file.arrayBuffer();
                    updates.processedUrl = await shelfSave(itemId, buffer, file.name);
                    break;
                }
                case 'cropper': updates.processedUrl = await cropImage(file); break;
                case 'metadata':
                case 'watermark':
                    updates.processedUrl = URL.createObjectURL(file);
                    break;
                default:
                    await new Promise(r => setTimeout(r, 2000));
                    updates.processedUrl = URL.createObjectURL(file);
                    break;
            }

            updateItemStatus(toolId, sessionId, itemId, updates);

        } catch (error) {
            dlog('process_error', { toolId, itemId, error: String(error) });
            updateItemStatus(toolId, sessionId, itemId, { status: 'error' });
        }

        checkSessionCompletion(toolId, sessionId);
    };

    const handleUpdateItem = async (toolId: ToolId, itemId: string, updates: Partial<SessionItem>) => {
        const session = sessions[toolId];
        if (!session) return;
        updateItemStatus(toolId, session.id, itemId, updates);
        // Real transforms arriving via overlays (cropper save, magic brush, auto-crop)
        // carry into the session so the next tool receives the edited file.
        if (updates.processedUrl && toolId !== 'shelf') {
            const item = session.items.find(i => i.id === itemId);
            if (item) sessionStore.applyResult(itemId, updates.processedUrl, outNameFor(item.file.name, toolId), toolId);
        }
    };

    const updateItemStatus = (toolId: ToolId, sessionId: string, itemId: string, updates: Partial<SessionItem>) => {
        setSessions(prev => {
            const session = prev[toolId];
            if (!session || session.id !== sessionId) return prev;
            const newItems = session.items.map(item => item.id === itemId ? { ...item, ...updates } : item);
            return { ...prev, [toolId]: { ...session, items: newItems } };
        });
    };

    const checkSessionCompletion = (toolId: ToolId, sessionId: string) => {
        setSessions(prev => {
            const session = prev[toolId];
            if (!session || session.id !== sessionId) return prev;
            const allDone = session.items.every(i => i.status === 'completed' || i.status === 'error');
            return allDone ? { ...prev, [toolId]: { ...session, status: 'completed' } } : prev;
        });
    };

    // --- Session Management ---
    const handleInternalTransfer = async (sourceToolId: ToolId, targetToolId: ToolId, itemIds: string[]) => {
        const sourceSession = sessions[sourceToolId];
        if (!sourceSession) return;
        const itemsToTransfer = sourceSession.items.filter(item => itemIds.includes(item.id));
        if (itemsToTransfer.length === 0) return;

        // Prefer the processed output when transferring between tools.
        // Shelf items have an empty File placeholder, other tools have a blob/data URL processedUrl.
        const files = await Promise.all(itemsToTransfer.map(async item => {
            const url = item.status === 'completed' ? item.processedUrl : null;
            if (url) {
                try {
                    const res = await fetch(url);
                    const blob = await res.blob();
                    return new File([blob], item.file.name, { type: blob.type || item.file.type });
                } catch { /* fall through to original */ }
            }
            return item.file;
        }));

        handleToolDrop(files, targetToolId);
    };

    const handleRecompress = (newQuality: number) => {
        setCompressorQuality(newQuality);
        const session = sessions['compressor'];
        if (!session) return;
        // Re-compress all completed/error items at the new quality
        session.items.forEach(item => {
            if (item.status !== 'completed' && item.status !== 'error') return;
            updateItemStatus('compressor', session.id, item.id, { status: 'processing', processedUrl: undefined });
            processItem(session.id, item.id, item.file, 'compressor', newQuality);
        });
    };

    const handleDelete = (toolId: ToolId) => {
        dlog('delete', { toolId });
        // Delete shelf files from disk before updating state
        if (toolId === 'shelf') {
            const session = sessions[toolId];
            if (session) {
                const idsToDelete = session.selectedItemIds.length > 0
                    ? session.selectedItemIds
                    : session.items.map(i => i.id);
                shelfDelete(idsToDelete);
            }
        } else {
            // Session-tool items are session-store files — remove them there too
            // so they don't reappear on the next tool switch.
            const session = sessions[toolId];
            if (session) {
                const idsToDelete = session.selectedItemIds.length > 0
                    ? session.selectedItemIds
                    : session.items.map(i => i.id);
                sessionStore.remove(idsToDelete);
            }
        }

        setSessions(prev => {
            const session = prev[toolId];
            if (!session) return prev;
            const hasSelection = session.selectedItemIds.length > 0;

            if (!hasSelection) {
                if (expandedToolId === toolId) setExpandedToolId(null);
                if (toolId === 'remover') unloadBen2Model();
                return { ...prev, [toolId]: undefined };
            } else {
                const newItems = session.items.filter(item => !session.selectedItemIds.includes(item.id));
                if (newItems.length === 0) {
                    if (expandedToolId === toolId) setExpandedToolId(null);
                    if (toolId === 'remover') unloadBen2Model();
                    return { ...prev, [toolId]: undefined };
                }
                return { ...prev, [toolId]: { ...session, items: newItems, selectedItemIds: [] } };
            }
        });
    };

    const closeSessionView = (_toolId: ToolId) => setExpandedToolId(null);
    const expandSession = (toolId: ToolId) => setExpandedToolId(toolId);

    const handleRemoveTool = (id: ToolId) => {
        dispatch('REMOVE_TOOL', id);
        if (expandedToolId === id) setExpandedToolId(null);
        if (id === 'remover') unloadBen2Model();
    };

    const handleReorderTools = (newOrder: ToolId[]) => {
        dispatch('REORDER_TOOLS', newOrder);
    };

    const handleAddTool = (toolId: ToolId) => {
        dispatch('ADD_TOOL', toolId);
    };

    const handleSelection = (toolId: ToolId, itemId: string, multiSelect: boolean, rangeSelect: boolean) => {
        setSessions(prev => {
            const session = prev[toolId];
            if (!session) return prev;
            let newSelectedIds = [...session.selectedItemIds];
            const allItems = session.items;
            const clickedIndex = allItems.findIndex(i => i.id === itemId);

            if (rangeSelect && lastFocusedItemId) {
                const lastIndex = allItems.findIndex(i => i.id === lastFocusedItemId);
                if (lastIndex !== -1 && clickedIndex !== -1) {
                    const start = Math.min(lastIndex, clickedIndex);
                    const end = Math.max(lastIndex, clickedIndex);
                    newSelectedIds = allItems.slice(start, end + 1).map(i => i.id);
                }
            } else if (multiSelect) {
                if (newSelectedIds.includes(itemId)) {
                    newSelectedIds = newSelectedIds.filter(id => id !== itemId);
                } else {
                    newSelectedIds.push(itemId);
                }
                setLastFocusedItemId(itemId);
            } else {
                // Toggle: if clicking the only selected item, deselect it
                if (newSelectedIds.length === 1 && newSelectedIds[0] === itemId) {
                    newSelectedIds = [];
                } else {
                    newSelectedIds = [itemId];
                }
                setLastFocusedItemId(itemId);
            }
            return { ...prev, [toolId]: { ...session, selectedItemIds: newSelectedIds } };
        });
    };

    return (
        <div className="min-h-screen w-full relative overflow-hidden bg-transparent pointer-events-none">
            <SideDock
                isVisible={isVisible}
                edge={edge}
                activeToolIds={activeToolIds}
                sessions={sessions}
                expandedToolId={expandedToolId}
                onDrop={handleToolDrop}
                onInternalDrop={handleInternalTransfer}
                onDeleteSession={handleDelete}
                onCloseSession={closeSessionView}
                onExpandSession={expandSession}
                onSelect={handleSelection}
                onRemoveTool={handleRemoveTool}
                isToolDragging={isToolDragging}
                onReorderTools={handleReorderTools}
                onAddTool={handleAddTool}
                onMouseEnter={handleInteractiveEnter}
                onMouseLeave={handleInteractiveLeave}
                onOpenGallery={openGallery}

                onUpdateItem={handleUpdateItem}
                onSwitchTool={(id) => setExpandedToolId(id)}
                badgeCounts={badgeCounts}
                onProcessIdle={handleProcessIdle}
                clearGen={clearGen}
                compressorQuality={compressorQuality}
                onRecompress={handleRecompress}
                removerModelLoading={removerModelLoading}
                onSelfItemCountChange={handleSelfItemCountChange}
            />
        </div>
    );
};

export const DockApp: React.FC = () => (
    <DockErrorBoundary>
        <DockAppInner />
    </DockErrorBoundary>
);
