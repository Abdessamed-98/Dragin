
import React, { useState, useEffect, useMemo, Component, ErrorInfo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ToolWidget } from './ToolWidget';
import { ActiveSession, ToolId, SessionItem } from '../types';
import { ALL_TOOLS } from '../data/tools';
import { dragState } from '../state/dragState';
import { dlog } from '../utils/dockLogger';

// ── Error Boundary ─────────────────────────────────────────────────────────
class ToolErrorBoundary extends Component<
  { toolId: string; children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    dlog('ERROR_BOUNDARY', {
      toolId: this.props.toolId,
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5),
      componentStack: info.componentStack?.split('\n').slice(0, 8),
    });
  }

  render() {
    if (this.state.error) {
      return (
        <div className="w-full flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-red-950/40 border border-red-800/40 text-red-300 text-xs">
          <span className="font-bold">Tool crashed</span>
          <span className="text-red-400/70 text-center max-w-[200px] break-words">{this.state.error.message}</span>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-3 py-1 rounded-lg bg-red-800/40 hover:bg-red-700/50 text-red-200 text-xs"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Map colorClass names → real hex colours (avoids Tailwind purge)
const COLOR_MAP: Record<string, string> = {
  indigo: '#818cf8',
  emerald: '#34d399',
  amber: '#fbbf24',
  pink: '#f472b6',
  teal: '#2dd4bf',
  blue: '#60a5fa',
  red: '#f87171',
  cyan: '#22d3ee',
  rose: '#fb7185',
  fuchsia: '#e879f9',
  violet: '#a78bfa',
  orange: '#fb923c',
};

interface SideDockProps {
  contentRef?: React.RefObject<HTMLDivElement | null>;
  isVisible: boolean;
  activeToolIds: ToolId[];
  sessions: Record<string, ActiveSession | undefined>;
  expandedToolId: ToolId | null;
  onDrop: (files: File[], toolId: ToolId) => void;
  onInternalDrop: (sourceToolId: ToolId, targetToolId: ToolId, itemIds: string[]) => void;
  onDeleteSession: (toolId: ToolId) => void;
  onCloseSession: (toolId: ToolId) => void;
  onExpandSession: (toolId: ToolId) => void;
  onSelect: (toolId: ToolId, itemId: string, multi: boolean, range: boolean) => void;
  onRemoveTool: (toolId: ToolId) => void;
  isToolDragging: boolean;
  onReorderTools: (newOrder: ToolId[]) => void;
  onAddTool: (toolId: ToolId, atIndex?: number) => void;
  externalDragId?: ToolId | null;
  proposedIndex?: number | null;
  onProposeIndex?: (index: number) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onOpenGallery?: () => void;
  onToolDragToGallery?: (toolId: ToolId | null) => void;
  onUpdateItem: (toolId: ToolId, itemId: string, updates: Partial<SessionItem>) => void;
  pdfDroppedFiles?: File[];
  pdfDropGen?: number;
  converterDroppedFiles?: File[];
  converterDropGen?: number;
  upscalerDroppedFiles?: File[];
  upscalerDropGen?: number;
  metadataDroppedFiles?: File[];
  metadataDropGen?: number;
  watermarkDroppedFiles?: File[];
  watermarkDropGen?: number;
  paletteDroppedFiles?: File[];
  paletteDropGen?: number;
  vectorizerDroppedFiles?: File[];
  vectorizerDropGen?: number;
  clearGen?: number;
  removerOptions?: import('../services/api').RemoverOptions;
  onRemoverModeChange?: (mode: import('../services/api').RemoverMode) => void;
  onSelfItemCountChange?: (toolId: ToolId, count: number) => void;
}

export const SideDock: React.FC<SideDockProps> = ({
  contentRef,
  isVisible,
  activeToolIds,
  sessions,
  expandedToolId,
  onDrop,
  onInternalDrop,
  onDeleteSession,
  onCloseSession,
  onExpandSession,
  onSelect,
  onRemoveTool,
  isToolDragging,
  onReorderTools,
  onAddTool: _onAddTool,
  externalDragId,
  proposedIndex,
  onProposeIndex,
  onOpenGallery,
  onToolDragToGallery,
  onMouseEnter,
  onMouseLeave,
  onUpdateItem,
  pdfDroppedFiles,
  pdfDropGen,
  converterDroppedFiles,
  converterDropGen,
  upscalerDroppedFiles,
  upscalerDropGen,
  metadataDroppedFiles,
  metadataDropGen,
  watermarkDroppedFiles,
  watermarkDropGen,
  paletteDroppedFiles,
  paletteDropGen,
  vectorizerDroppedFiles,
  vectorizerDropGen,
  clearGen,
  removerOptions,
  onRemoverModeChange,
  onSelfItemCountChange,
}) => {

  // --- REORDER STATE ---
  const [localOrder, setLocalOrder] = useState<ToolId[] | null>(null);
  const [internalDraggingId, setInternalDraggingId] = useState<ToolId | null>(null);

  // --- UNIFIED FILE-DRAG STATE ---
  // Which tool wrapper is currently being dragged over with a file.
  // The wrapper covers BOTH the tool box AND the pill — one entity, one listener.
  const [fileDragHoverId, setFileDragHoverId] = useState<ToolId | null>(null);

  // Clear stale drag hover when a tool expands/collapses — the self-contained
  // tool overlay may have swallowed the drop event (stopPropagation), leaving
  // fileDragHoverId stuck.
  useEffect(() => { setFileDragHoverId(null); }, [expandedToolId]);

  const draggingId = externalDragId || internalDraggingId;
  const effectiveToolIds = localOrder || activeToolIds;
  const displayToolIds = [...effectiveToolIds];

  if (externalDragId && !displayToolIds.includes(externalDragId) && isVisible && proposedIndex !== null && proposedIndex !== undefined) {
    const safeIndex = Math.max(0, Math.min(proposedIndex, displayToolIds.length));
    displayToolIds.splice(safeIndex, 0, externalDragId);
  }

  const activeTools = displayToolIds
    .map(id => ALL_TOOLS.find(t => t.id === id))
    .filter((t): t is typeof ALL_TOOLS[0] => t !== undefined);

  // ── VERTICAL CENTERING ─────────────────────────────────────────────────────
  // When a tool is expanded, shift the column so that tool is vertically centered.
  const [viewportH, setViewportH] = useState(window.innerHeight);
  useEffect(() => {
    const onResize = () => setViewportH(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Compute a translateY shift to center the expanded tool in the viewport.
  // When collapsed, shift = 0 and the outer justify-center handles centering.
  const centerTransform = useMemo<string>(() => {
    if (!expandedToolId) return '';

    const collapsedH = 80;
    const gap = 16;
    const pad = 8;
    const n = activeTools.length;

    const idx = activeTools.findIndex(t => t.id === expandedToolId);
    if (idx === -1 || n === 0) return '';

    const expandedW = Math.min(420, window.innerWidth - 20);
    const expandedH = Math.round(expandedW * 5 / 4);
    const totalH = (n - 1) * (collapsedH + gap) + expandedH;

    // Center of expanded tool within the column
    const centerOfExpanded = idx * (collapsedH + gap) + expandedH / 2;

    // Shift needed to move from column-center to expanded-tool-center
    // (justify-center already puts column-center at viewport center)
    let shift = totalH / 2 - centerOfExpanded;

    // Clamp so expanded tool stays within viewport
    const baseTop = (viewportH - totalH) / 2; // column top from justify-center
    const expandedTop = baseTop + idx * (collapsedH + gap);
    // After shift: expandedTop + shift >= pad
    shift = Math.max(pad - expandedTop, shift);
    // After shift: expandedTop + expandedH + shift <= viewportH - pad
    shift = Math.min(viewportH - pad - expandedTop - expandedH, shift);

    return `translateY(${shift}px)`;
  }, [expandedToolId, activeTools, viewportH]);

  // ── REORDER HANDLERS ──────────────────────────────────────────────────────
  const handleDragStart = (e: React.DragEvent, toolId: ToolId) => {
    if (expandedToolId === toolId) { e.preventDefault(); return; }

    // Build a ghost image that omits the pill — the browser captures the ghost
    // at dragstart before requestAnimationFrame hides the element, so the pill
    // would otherwise be visible during the entire drag.
    const wrapper = e.currentTarget as HTMLElement;
    const ghost = wrapper.cloneNode(true) as HTMLElement;
    Object.assign(ghost.style, {
      position: 'fixed', top: '-9999px', left: '-9999px',
      width: `${wrapper.offsetWidth}px`, pointerEvents: 'none',
    });
    // The pill is always the last child of the wrapper
    ghost.lastElementChild?.remove();
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, (e.nativeEvent as MouseEvent).offsetX, (e.nativeEvent as MouseEvent).offsetY);
    requestAnimationFrame(() => ghost.remove());

    e.dataTransfer.setData('application/x-smart-tool-reorder', toolId);
    e.dataTransfer.effectAllowed = 'move';
    setLocalOrder([...activeToolIds]);
    requestAnimationFrame(() => setInternalDraggingId(toolId));
    onToolDragToGallery?.(toolId);
  };

  const handleReorderDragOver = (e: React.DragEvent, targetToolId: ToolId) => {
    if (!draggingId) return;

    // External drag (gallery → dock): propose an insertion index
    if (externalDragId === draggingId && onProposeIndex) {
      const targetIndex = effectiveToolIds.indexOf(targetToolId);
      if (targetIndex === -1) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const newIndex = e.clientY > rect.top + rect.height / 2 ? targetIndex + 1 : targetIndex;
      if (proposedIndex !== newIndex) onProposeIndex(newIndex);
      return;
    }

    // Internal reorder: insert dragged item before/after target based on cursor position.
    // Insert-based (not swap-based) so behaviour is identical dragging up or down.
    if (!localOrder || draggingId === targetToolId) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const insertAfter = e.clientY > rect.top + rect.height / 2;
    const withoutDragged = localOrder.filter(id => id !== draggingId);
    const insertAt = withoutDragged.indexOf(targetToolId);
    if (insertAt === -1) return;
    withoutDragged.splice(insertAfter ? insertAt + 1 : insertAt, 0, draggingId);
    if (withoutDragged.join() !== localOrder.join()) setLocalOrder(withoutDragged);
  };

  const handleDragEnd = () => {
    if (localOrder && internalDraggingId) onReorderTools(localOrder);
    setInternalDraggingId(null);
    setLocalOrder(null);
    onToolDragToGallery?.(null);
  };

  // ── UNIFIED FILE-DRAG HANDLERS (one listener per wrapper) ─────────────────
  const isFileDrag = (e: React.DragEvent) =>
    !e.dataTransfer.types.includes('application/x-smart-tool-reorder') &&
    !e.dataTransfer.types.includes('application/x-smart-tool-install');

  const handleWrapperDragEnter = (e: React.DragEvent, toolId: ToolId) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    setFileDragHoverId(toolId);
  };

  // Combined dragOver: handles both reorder positioning and file drag feedback
  const handleWrapperDragOver = (e: React.DragEvent, toolId: ToolId) => {
    e.preventDefault();
    if (isFileDrag(e)) {
      e.dataTransfer.dropEffect = 'copy';
    } else {
      e.dataTransfer.dropEffect = 'move';
      handleReorderDragOver(e, toolId);
    }
  };

  const handleWrapperDragLeave = (e: React.DragEvent) => {
    if (!isFileDrag(e)) return;
    // Only clear when truly leaving the wrapper — not when moving between pill ↔ tool box
    if ((e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) return;
    setFileDragHoverId(null);
  };

  const handleWrapperDrop = (e: React.DragEvent, toolId: ToolId) => {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setFileDragHoverId(null);

    // Check shared drag state first — survives startDrag overriding dataTransfer
    const ds = dragState.get();
    if (ds && ds.sourceToolId !== toolId) {
      dragState.clear();
      onInternalDrop(ds.sourceToolId, toolId, ds.itemIds);
      return;
    }
    dragState.clear();

    // Fallback: dataTransfer internal data (when startDrag is not in effect)
    const internalData = e.dataTransfer.getData('application/app-internal-transfer');
    if (internalData) {
      try {
        const { sourceToolId, itemIds } = JSON.parse(internalData);
        if (sourceToolId && itemIds?.length > 0) {
          onInternalDrop(sourceToolId, toolId, itemIds);
          return;
        }
      } catch { /* ignore */ }
    }

    // File drop
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onDrop(Array.from(e.dataTransfer.files), toolId);
    }
  };

  return (
    // dir="ltr" overrides document dir="rtl" (Arabic) so flex layout is left→right as expected
    <div ref={contentRef} dir="ltr" className="fixed inset-0 flex flex-col items-end justify-center z-50 pointer-events-none">

      <div
        className="relative flex flex-col items-end gap-4 pointer-events-none transition-transform duration-500 ease-out"
        style={{ transform: `translateX(${isVisible ? 0 : 200}px) ${centerTransform}` }}
      >
        <AnimatePresence mode='popLayout'>
          {activeTools.map(tool => {
            const isPreview = tool.id === externalDragId;
            const color = COLOR_MAP[tool.colorClass] ?? '#818cf8';
            const isActive = expandedToolId === tool.id;
            const isFileDragHovered = fileDragHoverId === tool.id;

            return (
              // ┌─ ONE wrapper = ONE drag entity (tool box + pill) ──────────────┐
              // │ All file drag events are caught here.                           │
              // │ Moving between pill and tool box stays INSIDE this wrapper,    │
              // │ so no spurious dragLeave fires.                                 │
              // └────────────────────────────────────────────────────────────────┘
              <motion.div
                layout={localOrder ? "position" : false}
                key={tool.id}
                initial={{ opacity: 0, x: 50, scale: 0.8 }}
                animate={{
                  opacity: draggingId === tool.id ? 0 : (isPreview ? 0.6 : 1),
                  x: 0,
                  scale: 1,
                  zIndex: draggingId === tool.id ? 0 : 1,
                  filter: isPreview ? 'grayscale(100%)' : 'none'
                }}
                exit={{ opacity: 0, scale: 0.5, transition: { duration: 0.2 } }}
                transition={{ type: "spring", stiffness: 500, damping: 40, layout: { duration: 0.25 } }}
                // Reorder dragging (this tool being dragged out)
                draggable={expandedToolId !== tool.id && isVisible && !isPreview}
                onDragStart={(e) => handleDragStart(e as unknown as React.DragEvent, tool.id)}
                onDragEnd={handleDragEnd}
                // Unified drag-over (handles both reorder + file drag)
                onDragOver={(e) => handleWrapperDragOver(e as unknown as React.DragEvent, tool.id)}
                // Unified file-drag enter/leave/drop — covers pill AND tool box
                onDragEnter={(e) => handleWrapperDragEnter(e as unknown as React.DragEvent, tool.id)}
                onDragLeave={(e) => handleWrapperDragLeave(e as unknown as React.DragEvent)}
                onDrop={(e) => handleWrapperDrop(e as unknown as React.DragEvent, tool.id)}
                onMouseEnter={onMouseEnter}
                onMouseLeave={onMouseLeave}
                // items-stretch: pill container auto-matches ToolWidget's exact height
                className="relative group/dock-item pointer-events-auto flex flex-row items-stretch"
                data-interactive
              >
                {/* Delete Button */}
                {isVisible && expandedToolId !== tool.id && draggingId !== tool.id && !isPreview && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0 }}
                    whileHover={{ scale: 1.1 }}
                    className="absolute -left-2 top-0 -translate-x-full opacity-0 group-hover/dock-item:opacity-100 bg-red-500/20 text-red-400 p-1.5 rounded-full hover:bg-red-500 hover:text-white transition-colors z-10 pointer-events-auto"
                    onClick={(e) => { e.stopPropagation(); onRemoveTool(tool.id); }}
                    onMouseEnter={onMouseEnter}
                    title="Remove Tool"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                  </motion.button>
                )}

                {/* Tool Widget — file drag is now handled by the parent wrapper */}
                <ToolErrorBoundary toolId={tool.id}>
                <ToolWidget
                  id={tool.id}
                  title={tool.title}
                  description={tool.description}
                  icon={tool.icon}
                  colorClass={tool.colorClass}
                  emptyHint={tool.emptyHint}
                  emptySubHint={tool.emptySubHint}
                  formatLines={tool.formatLines}
                  isDockVisible={isVisible}
                  isExpanded={isActive}
                  activeSession={sessions[tool.id] || null}
                  onDrop={onDrop}
                  onInternalDrop={onInternalDrop}
                  onDelete={() => onDeleteSession(tool.id)}
                  onClose={() => onCloseSession(tool.id)}
                  onExpand={() => onExpandSession(tool.id)}
                  onSelectItem={(itemId, multi, range) => onSelect(tool.id, itemId, multi, range)}
                  isToolDragging={isToolDragging}
                  isReordering={draggingId !== null}
                  onUpdateItem={(itemId, updates) => onUpdateItem(tool.id, itemId, updates)}
                  onOpenSettings={onOpenGallery}
                  externalDragHover={isFileDragHovered}
                  externalDragHandled={true}
                  otherToolCount={activeToolIds.length - 1}
                  pdfDroppedFiles={tool.id === 'pdf' ? pdfDroppedFiles : undefined}
                  pdfDropGen={tool.id === 'pdf' ? pdfDropGen : undefined}
                  converterDroppedFiles={tool.id === 'converter' ? converterDroppedFiles : undefined}
                  converterDropGen={tool.id === 'converter' ? converterDropGen : undefined}
                  upscalerDroppedFiles={tool.id === 'upscaler' ? upscalerDroppedFiles : undefined}
                  upscalerDropGen={tool.id === 'upscaler' ? upscalerDropGen : undefined}
                  metadataDroppedFiles={tool.id === 'metadata' ? metadataDroppedFiles : undefined}
                  metadataDropGen={tool.id === 'metadata' ? metadataDropGen : undefined}
                  watermarkDroppedFiles={tool.id === 'watermark' ? watermarkDroppedFiles : undefined}
                  watermarkDropGen={tool.id === 'watermark' ? watermarkDropGen : undefined}
                  paletteDroppedFiles={tool.id === 'palette' ? paletteDroppedFiles : undefined}
                  paletteDropGen={tool.id === 'palette' ? paletteDropGen : undefined}
                  vectorizerDroppedFiles={tool.id === 'vectorizer' ? vectorizerDroppedFiles : undefined}
                  vectorizerDropGen={tool.id === 'vectorizer' ? vectorizerDropGen : undefined}
                  clearGen={clearGen}
                  removerOptions={tool.id === 'remover' ? removerOptions : undefined}
                  onRemoverModeChange={tool.id === 'remover' ? onRemoverModeChange : undefined}
                  onSelfItemCountChange={(count) => onSelfItemCountChange?.(tool.id, count)}
                />
                </ToolErrorBoundary>

                {/* Pill — PURELY VISUAL, no drag listeners (parent wrapper handles all drag) */}
                {!isPreview && draggingId !== tool.id && (
                  <div
                    // opacity-0 by default; shows on mouse hover (group-hover) OR file drag hover (inline override)
                    className="flex-shrink-0 flex items-center opacity-0 group-hover/dock-item:opacity-100 transition-opacity duration-200"
                    style={{
                      alignSelf: 'stretch',
                      width: 9,              // 4px gap + 5px pill
                      paddingLeft: 4,
                      // Override CSS opacity when a file is being dragged over the wrapper
                      ...(isFileDragHovered ? { opacity: 1 } : {}),
                    }}
                  >
                    <div style={{
                      width: 5,
                      height: '55%',
                      minHeight: 28,
                      maxHeight: 120,
                      borderRadius: '99px',
                      background: color,
                      boxShadow: isFileDragHovered
                        ? `0 0 14px 4px ${color}99`
                        : `0 0 6px 1px ${color}55`,
                      transition: 'box-shadow 0.2s ease',
                      flexShrink: 0,
                    }} />
                  </div>
                )}

              </motion.div>
            )
          })}
        </AnimatePresence>

        {activeTools.length === 0 && isVisible && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="w-[80px] h-[80px] rounded-2xl border-2 border-dashed border-slate-700 flex items-center justify-center text-slate-600 text-xs text-center p-2"
          >
            اسحب الأدوات هنا
          </motion.div>
        )}
      </div>
    </div>
  );
};
