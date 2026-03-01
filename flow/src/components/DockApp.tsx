import React, { useState, useEffect, useCallback, useRef, Component, ErrorInfo } from 'react';
import { SideDock } from './SideDock';
import { ActiveSession, ToolId, SessionItem } from '../types';
import { useElectron } from '../hooks/useElectron';
import { dlog } from '../utils/dockLogger';
import {
    removeBackground,
    compressImage,
    cropImage,
    unloadRemoverModels,
    checkRemoverModelLoaded,
    RemoverOptions,
    RemoverMode,
} from '../services/api';



// Catch unhandled errors that could kill the dock
window.addEventListener('error', (e) => dlog('UNCAUGHT', { message: e.message, filename: e.filename, line: e.lineno, col: e.colno }));
window.addEventListener('unhandledrejection', (e) => dlog('UNHANDLED_PROMISE', { reason: String(e.reason) }));

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
            return (
                <div className="min-h-screen w-full flex items-center justify-end bg-transparent">
                    <div
                        className="w-[280px] mr-4 flex flex-col items-center gap-3 p-6 rounded-2xl bg-slate-900/95 border border-red-800/40 text-red-300 text-xs backdrop-blur-sm pointer-events-auto"
                        style={{ direction: 'rtl' }}
                    >
                        <span className="text-sm font-bold text-red-400">الشريط توقف عن العمل</span>
                        <span className="text-red-300/70 text-center text-[11px] leading-relaxed max-w-[220px] break-words">
                            {this.state.error.message}
                        </span>
                        <button
                            onClick={() => window.location.reload()}
                            className="mt-1 px-5 py-2 rounded-xl bg-red-800/40 hover:bg-red-700/50 text-red-200 text-xs font-bold transition-colors"
                        >
                            إعادة تشغيل
                        </button>
                    </div>
                </div>
            );
        }
        return this.props.children;
    }
}

const DockAppInner: React.FC = () => {
    const { activeToolIds, isDockEnabled, isGalleryOpen, isDockPinned, dispatch, setIgnoreMouseEvents, openGallery, resizeDock, sendDockMode, onExternalToolDrag, onExternalToolDragMove, onExternalToolDragEnd, startDockToolDrag, endDockToolDrag, shelfSave, shelfLoad, shelfDelete } = useElectron();

    const [isDragging, setIsDragging] = useState(false);
    const [isToolDragging] = useState(false); // For internal reorder or from gallery (if across windows, tricky)

    // Sessions stored locally in Dock Window (Processor)
    const [sessions, setSessions] = useState<Record<string, ActiveSession | undefined>>({});
    const [expandedToolId, setExpandedToolId] = useState<ToolId | null>(null);
    const [lastFocusedItemId, setLastFocusedItemId] = useState<string | null>(null);

    // PDF tool: forward dropped files via props (PdfTool is self-contained)
    const [pdfDroppedFiles, setPdfDroppedFiles] = useState<File[]>([]);
    const [pdfDropGen, setPdfDropGen] = useState(0);

    // Converter tool: forward dropped files via props (ConverterTool is self-contained)
    const [converterDroppedFiles, setConverterDroppedFiles] = useState<File[]>([]);
    const [converterDropGen, setConverterDropGen] = useState(0);

    // Upscaler tool: forward dropped files via props (UpscalerTool is self-contained)
    const [upscalerDroppedFiles, setUpscalerDroppedFiles] = useState<File[]>([]);
    const [upscalerDropGen, setUpscalerDropGen] = useState(0);

    // Metadata tool: forward dropped files via props (MetadataTool is self-contained)
    const [metadataDroppedFiles, setMetadataDroppedFiles] = useState<File[]>([]);
    const [metadataDropGen, setMetadataDropGen] = useState(0);

    // Watermark tool: forward dropped files via props (WatermarkTool is self-contained)
    const [watermarkDroppedFiles, setWatermarkDroppedFiles] = useState<File[]>([]);
    const [watermarkDropGen, setWatermarkDropGen] = useState(0);

    // Palette tool: forward dropped files via props (PaletteTool is self-contained)
    const [paletteDroppedFiles, setPaletteDroppedFiles] = useState<File[]>([]);
    const [paletteDropGen, setPaletteDropGen] = useState(0);

    // Vectorizer tool: forward dropped files via props (VectorizerTool is self-contained)
    const [vectorizerDroppedFiles, setVectorizerDroppedFiles] = useState<File[]>([]);
    const [vectorizerDropGen, setVectorizerDropGen] = useState(0);

    // Remover tool: processing mode + per-mode result cache
    const [removerOptions, setRemoverOptions] = useState<RemoverOptions>({
        mode: 'speed',
    });
    // Cache: itemId → { mode → processedUrl }
    const removerCacheRef = useRef<Record<string, Partial<Record<RemoverMode, string>>>>({});
    // Whether the remover model is currently being loaded (first inference)
    const [removerModelLoading, setRemoverModelLoading] = useState(false);

    // Clear signal for self-contained tools
    const [clearGen, setClearGen] = useState(0);

    const { onClearDataConfirmed } = useElectron();

    // --- External Tool Drag State (Gallery → Dock) ---
    const [externalDragId, setExternalDragId] = useState<ToolId | null>(null);
    const [proposedIndex, setProposedIndex] = useState<number | null>(null);

    useEffect(() => {
        onClearDataConfirmed(() => {
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

    // Listen for external tool drag events from gallery via main process
    useEffect(() => {
        onExternalToolDrag((data) => {
            setExternalDragId(data.toolId as ToolId);
            setProposedIndex(activeToolIds.length); // Default: end
        });

        onExternalToolDragMove((data) => {
            if (data.proposedIndex !== null) {
                setExternalDragId(data.toolId as ToolId);
                setProposedIndex(data.proposedIndex);
            } else {
                setProposedIndex(null);
            }
        });

        onExternalToolDragEnd(() => {
            setExternalDragId(null);
            setProposedIndex(null);
        });
    }, [onExternalToolDrag, onExternalToolDragMove, onExternalToolDragEnd, activeToolIds.length]);

    // --- Visibility Logic ---
    // The dock is visible if:
    // 1. A tool is expanded
    // 2. We are dragging files
    // 3. Any tool holds files (persistent until cleared)
    // 4. The Library Window is open

    const hasAnyFiles = Object.values(sessions).some(
        session => session != null && session.items.length > 0
    );
    const [selfItemCounts, setSelfItemCounts] = useState<Partial<Record<string, number>>>({});
    const handleSelfItemCountChange = useCallback((toolId: string, count: number) => {
        setSelfItemCounts(prev => {
            if (prev[toolId] === count) return prev; // no-op: skip re-render if unchanged
            return { ...prev, [toolId]: count };
        });
    }, []);
    const anySelfHasFiles = Object.values(selfItemCounts).some(c => (c ?? 0) > 0);
    const isInteractionActive = expandedToolId !== null || isDragging || hasAnyFiles || isGalleryOpen || isDockPinned || externalDragId !== null || anySelfHasFiles;
    const isVisible = isDockEnabled && isInteractionActive;

    // --- Dock diagnostics ---
    const prevVisibleRef = useRef(isVisible);
    if (prevVisibleRef.current !== isVisible) {
        dlog('visibility', {
            visible: isVisible,
            reason: { isDockEnabled, expandedToolId, isDragging, hasAnyFiles, isGalleryOpen, externalDragId },
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

    // --- Dynamic Window Resizing ---
    const resizeTimerRef = React.useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        let targetWidth: number;

        if (!isVisible) {
            // IDLE: 16px — enough for edge polling to detect drags
            targetWidth = 16;
        } else {
            // ACTIVE: always use max width to avoid setBounds position+size
            // desync on Windows which causes a one-frame alignment flash
            targetWidth = 540;
        }

        if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = setTimeout(() => {
            resizeDock(targetWidth);
        }, 16);

        return () => {
            if (resizeTimerRef.current) clearTimeout(resizeTimerRef.current);
        };
    }, [isVisible, expandedToolId, isDragging, resizeDock]);

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

        if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current);

        if (!isDragging) {
            setIsDragging(true);
        }

        dragTimeoutRef.current = setTimeout(() => {
            setIsDragging(false);
        }, 1500);
    }, [isDragging]);

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
    const SINGLE_FILE_TOOLS = new Set<ToolId>(['compressor', 'cropper']);

    // --- Processing Logic ---
    const handleToolDrop = async (files: File[], toolId: ToolId) => {
        dlog('drop', { toolId, fileCount: files.length, names: files.map(f => f.name) });
        setExpandedToolId(toolId);

        // OCR tool manages its own file-drop & processing internally via OcrTool.tsx.
        // We just expand the widget — no session pipeline needed.
        if (toolId === 'ocr') return;

        // PDF tool is self-contained (like OCR). Forward files via state props.
        if (toolId === 'pdf') {
            setPdfDroppedFiles(Array.from(files));
            setPdfDropGen(g => g + 1);
            return;
        }

        // Converter tool is self-contained. Forward files via state props.
        if (toolId === 'converter') {
            setConverterDroppedFiles(Array.from(files));
            setConverterDropGen(g => g + 1);
            return;
        }

        // Upscaler tool is self-contained. Forward files via state props.
        if (toolId === 'upscaler') {
            setUpscalerDroppedFiles(Array.from(files));
            setUpscalerDropGen(g => g + 1);
            return;
        }

        // Metadata tool is self-contained. Forward files via state props.
        if (toolId === 'metadata') {
            setMetadataDroppedFiles(Array.from(files));
            setMetadataDropGen(g => g + 1);
            return;
        }

        // Watermark tool is self-contained. Forward files via state props.
        if (toolId === 'watermark') {
            setWatermarkDroppedFiles(Array.from(files));
            setWatermarkDropGen(g => g + 1);
            return;
        }

        // Palette tool is self-contained. Forward files via state props.
        if (toolId === 'palette') {
            setPaletteDroppedFiles(Array.from(files));
            setPaletteDropGen(g => g + 1);
            return;
        }

        // Vectorizer tool is self-contained. Forward files via state props.
        if (toolId === 'vectorizer') {
            setVectorizerDroppedFiles(Array.from(files));
            setVectorizerDropGen(g => g + 1);
            return;
        }

        // Overlay tools only operate on one file at a time — silently take the first.
        if (SINGLE_FILE_TOOLS.has(toolId)) files = files.slice(0, 1);

        let sessionId: string;
        const currentSession = sessions[toolId];
        if (currentSession) {
            sessionId = currentSession.id;
        } else {
            sessionId = Math.random().toString(36).substring(2, 11);
        }

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
                    id: sessionId,
                    toolId,
                    items: updatedItems,
                    selectedItemIds: prevSession ? prevSession.selectedItemIds : [],
                    status: 'processing'
                }
            };
        });

        // Remover: batch all files in one request for speed
        if (toolId === 'remover') {
            newItems.forEach(item => updateItemStatus(toolId, sessionId, item.id, { status: 'processing' }));
            processRemoverBatch(sessionId, newItems, removerOptions);
        } else {
            newItems.forEach(item => processItem(sessionId, item.id, item.file, toolId));
        }
    };

    /** Process remover items one-by-one so each result appears immediately.
     *  Sequential is faster per-image (full CPU) and gives clear progressive UX. */
    const processRemoverBatch = async (sessionId: string, items: SessionItem[], opts: RemoverOptions) => {
        const mode = opts.mode || 'speed';
        // Check if model needs loading — show "Loading model..." label
        const modelReady = await checkRemoverModelLoaded(mode);
        if (!modelReady) setRemoverModelLoading(true);
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            try {
                const url = await removeBackground(item.file, opts);
                // After first result, model is loaded — switch label
                if (i === 0 && !modelReady) setRemoverModelLoading(false);
                if (!removerCacheRef.current[item.id]) removerCacheRef.current[item.id] = {};
                removerCacheRef.current[item.id][mode] = url;
                updateItemStatus('remover', sessionId, item.id, { processedUrl: url, status: 'completed' });
            } catch {
                if (i === 0 && !modelReady) setRemoverModelLoading(false);
                updateItemStatus('remover', sessionId, item.id, { status: 'error' });
            }
        }
        checkSessionCompletion('remover', sessionId);
    };

    const processItem = async (sessionId: string, itemId: string, file: File, toolId: ToolId) => {
        updateItemStatus(toolId, sessionId, itemId, { status: 'processing' });

        try {
            let updates: Partial<SessionItem> = { status: 'completed' };

            switch (toolId) {
                case 'compressor':
                    const compResult = await compressImage(file);
                    updates.processedUrl = compResult.url;
                    updates.metadata = {
                        originalSize: compResult.originalSize,
                        newSize: compResult.newSize,
                        savedPercentage: compResult.saved
                    };
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

    // Handle remover mode change: restore cached results or batch-reprocess uncached
    const handleRemoverModeChange = (newMode: RemoverMode) => {
        const newOpts = { mode: newMode };
        setRemoverOptions(newOpts);
        const session = sessions['remover'];
        if (!session) return;

        const uncached: SessionItem[] = [];
        session.items.forEach(item => {
            if (item.status !== 'completed' && item.status !== 'error') return;
            const cached = removerCacheRef.current[item.id]?.[newMode];
            if (cached) {
                updateItemStatus('remover', session.id, item.id, { processedUrl: cached, status: 'completed' });
            } else {
                updateItemStatus('remover', session.id, item.id, { status: 'processing', processedUrl: undefined });
                uncached.push(item);
            }
        });

        if (uncached.length > 0) {
            processRemoverBatch(session.id, uncached, newOpts);
        }
    };

    const handleCancelProcessing = (toolId: ToolId) => {
        setSessions(prev => {
            const session = prev[toolId];
            if (!session) return prev;
            return {
                ...prev,
                [toolId]: {
                    ...session,
                    items: session.items.map(item =>
                        item.status === 'processing' ? { ...item, status: 'idle' as const } : item
                    ),
                    status: session.items.every(i => i.status === 'completed' || i.status === 'error' || i.status === 'processing')
                        ? 'idle' as const : session.status,
                },
            };
        });
    };

    const handleDelete = (toolId: ToolId) => {
        dlog('delete', { toolId });
        // Clean up remover mode cache for deleted items
        if (toolId === 'remover') {
            const session = sessions[toolId];
            if (session) {
                const idsToDelete = session.selectedItemIds.length > 0
                    ? session.selectedItemIds
                    : session.items.map(i => i.id);
                idsToDelete.forEach(id => delete removerCacheRef.current[id]);
            }
        }
        // Delete shelf files from disk before updating state
        if (toolId === 'shelf') {
            const session = sessions[toolId];
            if (session) {
                const idsToDelete = session.selectedItemIds.length > 0
                    ? session.selectedItemIds
                    : session.items.map(i => i.id);
                shelfDelete(idsToDelete);
            }
        }

        setSessions(prev => {
            const session = prev[toolId];
            if (!session) return prev;
            const hasSelection = session.selectedItemIds.length > 0;

            if (!hasSelection) {
                if (expandedToolId === toolId) setExpandedToolId(null);
                if (toolId === 'remover') unloadRemoverModels();
                return { ...prev, [toolId]: undefined };
            } else {
                const newItems = session.items.filter(item => !session.selectedItemIds.includes(item.id));
                if (newItems.length === 0) {
                    if (expandedToolId === toolId) setExpandedToolId(null);
                    if (toolId === 'remover') unloadRemoverModels();
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
        if (id === 'remover') unloadRemoverModels();
    };

    const handleReorderTools = (newOrder: ToolId[]) => {
        dispatch('REORDER_TOOLS', newOrder);
    };

    const handleAddTool = (toolId: ToolId, atIndex?: number) => {
        if (atIndex !== undefined) {
            const newOrder = [...activeToolIds];
            if (!newOrder.includes(toolId)) {
                newOrder.splice(atIndex, 0, toolId);
                dispatch('REORDER_TOOLS', newOrder);
            }
        } else {
            dispatch('ADD_TOOL', toolId);
        }
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
                externalDragId={externalDragId}
                proposedIndex={proposedIndex}
                onProposeIndex={setProposedIndex}
                onToolDragToGallery={(toolId) => {
                    if (toolId) {
                        startDockToolDrag(toolId);
                    } else {
                        endDockToolDrag();
                    }
                }}
                onMouseEnter={handleInteractiveEnter}
                onMouseLeave={handleInteractiveLeave}
                onOpenGallery={openGallery}

                onUpdateItem={handleUpdateItem}
                pdfDroppedFiles={pdfDroppedFiles}
                pdfDropGen={pdfDropGen}
                converterDroppedFiles={converterDroppedFiles}
                converterDropGen={converterDropGen}
                upscalerDroppedFiles={upscalerDroppedFiles}
                upscalerDropGen={upscalerDropGen}
                metadataDroppedFiles={metadataDroppedFiles}
                metadataDropGen={metadataDropGen}
                watermarkDroppedFiles={watermarkDroppedFiles}
                watermarkDropGen={watermarkDropGen}
                paletteDroppedFiles={paletteDroppedFiles}
                paletteDropGen={paletteDropGen}
                vectorizerDroppedFiles={vectorizerDroppedFiles}
                vectorizerDropGen={vectorizerDropGen}
                clearGen={clearGen}
                removerOptions={removerOptions}
                removerModelLoading={removerModelLoading}
                onRemoverModeChange={handleRemoverModeChange}
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
