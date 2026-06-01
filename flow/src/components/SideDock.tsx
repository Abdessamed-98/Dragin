
import React, { useState, useEffect, Component, ErrorInfo } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion';
import { ToolWidget } from './ToolWidget';
import { ActiveSession, ToolId, SessionItem } from '../types';
import { useLocalizedTools } from '../i18n/useLocalizedTools';
import { useI18n } from '../i18n/I18nContext';
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
  onAddTool: (toolId: ToolId) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onOpenGallery?: () => void;
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
  ocrDroppedFiles?: File[];
  ocrDropGen?: number;
  clearGen?: number;
  compressorQuality?: number;
  onRecompress?: (quality: number) => void;
  removerOptions?: import('../services/api').RemoverOptions;
  removerModelLoading?: boolean;
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
  onOpenGallery,
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
  ocrDroppedFiles,
  ocrDropGen,
  clearGen,
  compressorQuality,
  onRecompress,
  removerOptions,
  removerModelLoading,
  onRemoverModeChange,
  onSelfItemCountChange,
}) => {
  const { t } = useI18n();
  const ALL_TOOLS = useLocalizedTools();

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

  const draggingId = internalDraggingId; // only in-tongue reorder now
  const effectiveToolIds = localOrder || activeToolIds;

  const activeTools = effectiveToolIds
    .map(id => ALL_TOOLS.find(t => t.id === id))
    .filter((t): t is typeof ALL_TOOLS[0] => t !== undefined);

  // ── RECOMPUTE ON RESIZE ─────────────────────────────────────────────────────
  // Re-render when the window resizes so the expanded panel size tracks viewport.
  const [, setViewportTick] = useState(0);
  useEffect(() => {
    const onResize = () => setViewportTick(n => n + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Debug "sensing zones" overlays — toggled from Settings, off by default.
  const [showZones, setShowZones] = useState(false);
  useEffect(() => {
    window.electron?.getSetting?.('debugZones').then((v: any) => setShowZones(!!v));
    window.electron?.onSettingChange?.(({ key, value }) => {
      if (key === 'debugZones') setShowZones(!!value);
    });
  }, []);

  // ── TONGUE PANEL GEOMETRY ───────────────────────────────────────────────────
  // The dock is one edge-attached "tongue" panel. In rail mode it holds the
  // stacked tool tiles; when a tool is active it grows to host that tool's UI.
  const PAD = 8;          // padding around the rail tiles
  const GAP = 10;         // vertical gap between rail tiles
  const TILE = 80;        // rail tile size
  const OUTER_R = 24;     // "corner value" R = tile radius (16) + PAD (8) → concentric with tiles

  const tileCount = activeTools.length;
  const railW = TILE + PAD * 2;
  const railH = tileCount > 0
    ? tileCount * TILE + (tileCount - 1) * GAP + PAD * 2
    : TILE + PAD * 2;
  const expW = Math.min(420, window.innerWidth - 20);
  const expH = Math.round(expW * 5 / 4);

  const panelW = expandedToolId ? expW : railW;
  const panelH = expandedToolId ? expH : railH;

  // ── Width-driven reveal ─────────────────────────────────────────────────────
  // Animate the panel WIDTH via a motion value. The neck (concave fillet) size is
  // derived from the live width: 0 until the left cap completes (width = R), then
  // grows to full (R) by width = 2R, then stays pinned — exactly the 3-phase
  // behaviour. The left cap radius clamps itself via CSS as the body narrows.
  const R = OUTER_R;
  const ONE_TOOL_H = TILE + PAD * 2; // tongue height with a single tool (reveal start height)
  const REVEAL_DUR = 0.45;           // tongue open/close duration
  const REVEAL_EASE = [0.22, 1, 0.36, 1] as const; // smooth ease-out (snappy open, soft settle)
  const wMV = useMotionValue(isVisible ? panelW : 0);
  useEffect(() => {
    const cw = animate(wMV, isVisible ? panelW : 0, { duration: REVEAL_DUR, ease: REVEAL_EASE });
    return () => cw.stop();
  }, [isVisible, panelW]); // eslint-disable-line react-hooks/exhaustive-deps
  const neckMV = useTransform(wMV, (v) => Math.min(Math.max((v - R) / R, 0), 1) * R);
  // Height has its OWN tween (see effect below) rather than being derived from the
  // live width. Deriving it made height JUMP whenever expandedToolId toggled — the
  // branch returned a new constant instantly, so the frame snapped to full height
  // while the width was still growing (the "weird" expand). A dedicated animation
  // keeps width + height growing together for smooth expand/collapse.
  const hMV = useMotionValue(isVisible ? panelH : ONE_TOOL_H);

  // Stagger gated on the HEIGHT timeline: a tile waits until the height has grown
  // enough to fit its row. Height only starts growing once the cap completes
  // (at tCap), expanding from the middle outward to full at REVEAL_DUR. So the
  // middle tile starts at tCap and the OUTERMOST tile starts at REVEAL_DUR (its
  // slide therefore *ends after* the tongue finishes).
  const tCap = (R / Math.max(1, panelW)) * REVEAL_DUR; // time the left cap completes
  const STAGGER_GAP = 0.045;         // delay between successive tiles (smaller = tighter)
  // Tile slide duration: long enough that even the FIRST tile (starts at tCap)
  // ends after the tongue (REVEAL_DUR).
  const TILE_POP = (REVEAL_DUR - tCap) + REVEAL_DUR * 0.35;

  // ── HEIGHT ANIMATION ────────────────────────────────────────────────────────
  // Tween height explicitly so it grows/shrinks *with* the width on expand and
  // collapse (same duration + ease → they move together, no snap). On a fresh
  // reveal we still lag it by tCap so it begins exactly when the concave necks
  // start appearing — matching the tile stagger.
  const prevVisibleRef = React.useRef(isVisible);
  useEffect(() => {
    const justRevealed = isVisible && !prevVisibleRef.current;
    prevVisibleRef.current = isVisible;
    let target = ONE_TOOL_H, duration = REVEAL_DUR, delay = 0;
    if (isVisible && expandedToolId) {
      target = expH;                                                    // expand/collapse
    } else if (isVisible) {
      target = railH;
      if (justRevealed) { delay = tCap; duration = REVEAL_DUR - tCap; } // reveal lag only
    }
    const ctrl = animate(hMV, target, { duration, delay, ease: REVEAL_EASE });
    return () => ctrl.stop();
  }, [isVisible, expandedToolId, railH, expH]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── REORDER HANDLERS ──────────────────────────────────────────────────────
  const handleDragStart = (e: React.DragEvent, toolId: ToolId) => {
    if (expandedToolId === toolId) { e.preventDefault(); return; }

    // Build a ghost image so the drag preview is just the tile.
    const wrapper = e.currentTarget as HTMLElement;
    const ghost = wrapper.cloneNode(true) as HTMLElement;
    Object.assign(ghost.style, {
      position: 'fixed', top: '-9999px', left: '-9999px',
      width: `${wrapper.offsetWidth}px`, pointerEvents: 'none',
    });
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, (e.nativeEvent as MouseEvent).offsetX, (e.nativeEvent as MouseEvent).offsetY);
    requestAnimationFrame(() => ghost.remove());

    e.dataTransfer.setData('application/x-smart-tool-reorder', toolId);
    e.dataTransfer.effectAllowed = 'move';
    setLocalOrder([...activeToolIds]);
    requestAnimationFrame(() => setInternalDraggingId(toolId));
  };

  const handleReorderDragOver = (e: React.DragEvent, targetToolId: ToolId) => {
    if (!draggingId) return;
    // Insert dragged tile before/after the target based on cursor position.
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

    // Native OS file drop only (tool→tool moves go through copy/paste now).
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onDrop(Array.from(e.dataTransfer.files), toolId);
    }
  };

  // Tongue surface (themed): pitch-black in dark, white-glass in light.
  const glass: React.CSSProperties = {
    background: 'var(--glass)',
    backdropFilter: 'blur(20px)',
    WebkitBackdropFilter: 'blur(20px)',
  };
  // Inverted-corner fillets: a glass square with a transparent quarter-circle
  // cut, leaving an L that hugs the edge line + the panel and presents a
  // concave arc — so the panel "necks" into the line. Top cuts the top-left
  // quarter; bottom cuts the bottom-left quarter.
  // Size-independent (farthest-side) masks, so the fillet scales with neckMV.
  const filletMaskTop = 'radial-gradient(circle farthest-side at top left, #0000 98.5%, #000 99.5%)';
  const filletMaskBottom = 'radial-gradient(circle farthest-side at bottom left, #0000 98.5%, #000 99.5%)';

  return (
    // dir="ltr" overrides document dir="rtl" (Arabic) so flex layout is left→right as expected
    <div ref={contentRef} dir="ltr" className="fixed inset-0 flex flex-col items-end justify-center z-50 pointer-events-none">

      {/* DEBUG SENSING ZONES (toggled from Settings → off by default) */}
      {showZones && (<>
        {/* BLUE — reveal/keep-alive box = rail tongue + margin (right side is the
            screen edge). Only shown while the tongue is revealed (with red). The
            margin here (100) must match REVEAL_MARGIN in DockApp. */}
        {isVisible && (
          <div
            className="absolute pointer-events-none"
            style={{ zIndex: 1, right: 0, top: '50%', transform: 'translateY(-50%)', width: railW + 100, height: railH + 200, background: 'rgba(59,130,246,0.14)', outline: '2px dashed #3b82f6', outlineOffset: -2 }}
          />
        )}
        {/* GREEN — full-height 16px edge strip: reveals AND keeps the tongue
            visible (keep-alive = this green OR the blue box). */}
        <div className="absolute top-0 right-0 bottom-0 pointer-events-none" style={{ zIndex: 2, width: 16, background: 'rgba(34,197,94,0.40)' }} />
      </>)}

      {/* ── THE TONGUE: one edge-attached frame that holds the rail or the active tool ── */}
      <motion.div
        initial={false}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        data-interactive
        // Width-driven reveal via motion values; necks (neckMV) track the width.
        className="relative pointer-events-auto"
        style={{ width: wMV, height: hMV, willChange: 'width, height' }}
      >
        {/* Background surface: glass body (rounded outer corners, flush right)
            + two concave neck fillets molding it into the edge line. The whole
            group shares one drop-shadow so the necks cast shadow too. */}
        <div className="absolute inset-0" style={{ zIndex: 0, filter: 'var(--tongue-shadow)' }}>
          {/* main body — square right edge sits flush against the line */}
          <div className="absolute inset-0" style={{ ...glass, borderTopLeftRadius: OUTER_R, borderBottomLeftRadius: OUTER_R }} />
          {/* top neck fillet — size = neckMV (0 → R → pinned), tracks the width */}
          <motion.div style={{ position: 'absolute', right: 0, bottom: '100%', width: neckMV, height: neckMV, ...glass, WebkitMaskImage: filletMaskTop, maskImage: filletMaskTop }} />
          {/* bottom neck fillet */}
          <motion.div style={{ position: 'absolute', right: 0, top: '100%', width: neckMV, height: neckMV, ...glass, WebkitMaskImage: filletMaskBottom, maskImage: filletMaskBottom }} />
        </div>

        {/* RED — the tongue's interactive/sensing hit area (debug, toggled from Settings) */}
        {showZones && (
          <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 60, background: 'rgba(255,0,0,0.35)', outline: '2px solid red' }} />
        )}

        {/* Content: clipped to the panel + faded, so the retracting frame never shows squashed/clipped tiles */}
        <div
          className="absolute inset-0 overflow-hidden flex flex-col items-center justify-center"
          style={{ gap: GAP, padding: expandedToolId ? 0 : PAD }}
        >
        <AnimatePresence mode='popLayout'>
          {activeTools.map((tool, i) => {
            const isActive = expandedToolId === tool.id;
            const isFileDragHovered = fileDragHoverId === tool.id;
            const hiddenByExpand = !!expandedToolId && !isActive;
            // Stagger tiles from the middle outward; outer tile lands as the tongue completes.
            const mid = (activeTools.length - 1) / 2;
            const distFromMid = Math.abs(i - mid);
            const revealDelay = isVisible && !expandedToolId ? tCap + distFromMid * STAGGER_GAP : 0;
            // Tiles SLIDE in horizontally from the screen edge (right). No scale, no centre-slide.
            const slideFrom = railW; // start fully off past the right edge → slide to 0

            return (
              <motion.div
                layout={localOrder ? "position" : false}
                key={tool.id}
                initial={{ opacity: 0, x: slideFrom }}
                animate={{
                  opacity: !isVisible ? 0 : (draggingId === tool.id ? 0.4 : 1),
                  x: !isVisible ? slideFrom : 0,
                }}
                exit={{ opacity: 0, scale: 0.5, transition: { duration: 0.2 } }}
                transition={localOrder
                  // Reordering: snappy, no reveal stagger delay.
                  ? { type: 'spring', stiffness: 700, damping: 45, layout: { duration: 0.22 } }
                  // Revealing: staggered slide-in.
                  : { duration: TILE_POP, ease: REVEAL_EASE, delay: revealDelay, layout: { duration: 0.25 } }}
                // Drag to reorder within the tongue
                draggable={!isActive && isVisible}
                onDragStart={(e) => handleDragStart(e as unknown as React.DragEvent, tool.id)}
                onDragEnd={handleDragEnd}
                // Unified drag-over (handles both reorder + file drag)
                onDragOver={(e) => handleWrapperDragOver(e as unknown as React.DragEvent, tool.id)}
                onDragEnter={(e) => handleWrapperDragEnter(e as unknown as React.DragEvent, tool.id)}
                onDragLeave={(e) => handleWrapperDragLeave(e as unknown as React.DragEvent)}
                onDrop={(e) => handleWrapperDrop(e as unknown as React.DragEvent, tool.id)}
                onMouseEnter={onMouseEnter}
                onMouseLeave={onMouseLeave}
                className={`group/dock-item pointer-events-auto shrink-0 ${isActive ? 'absolute inset-0 z-10' : 'relative z-10'}`}
                style={hiddenByExpand ? { display: 'none' } : undefined}
                data-interactive
              >
                {/* Delete Button (rail only) */}
                {isVisible && !expandedToolId && draggingId !== tool.id && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0 }}
                    whileHover={{ scale: 1.1 }}
                    className="absolute -top-1 -left-1 opacity-0 group-hover/dock-item:opacity-100 bg-red-500/30 text-red-300 p-1 rounded-full hover:bg-red-500 hover:text-white transition-colors z-20 pointer-events-auto"
                    onClick={(e) => { e.stopPropagation(); onRemoveTool(tool.id); }}
                    onMouseEnter={onMouseEnter}
                    title="Remove Tool"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
                  </motion.button>
                )}

                {/* Tool Widget — file drag is handled by this wrapper */}
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
                  ocrDroppedFiles={tool.id === 'ocr' ? ocrDroppedFiles : undefined}
                  ocrDropGen={tool.id === 'ocr' ? ocrDropGen : undefined}
                  clearGen={clearGen}
                  compressorQuality={tool.id === 'compressor' ? compressorQuality : undefined}
                  onRecompress={tool.id === 'compressor' ? onRecompress : undefined}
                  removerOptions={tool.id === 'remover' ? removerOptions : undefined}
                  isModelLoading={tool.id === 'remover' ? removerModelLoading : undefined}
                  onRemoverModeChange={tool.id === 'remover' ? onRemoverModeChange : undefined}
                  onSelfItemCountChange={(count) => onSelfItemCountChange?.(tool.id, count)}
                />
                </ToolErrorBoundary>
              </motion.div>
            )
          })}
        </AnimatePresence>

        {activeTools.length === 0 && isVisible && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="relative z-10 w-[80px] h-[80px] rounded-2xl border-2 border-dashed border-slate-700 flex items-center justify-center text-slate-600 text-[10px] text-center p-2"
          >
            {t('dock.dragToolsHere')}
          </motion.div>
        )}
        </div>
      </motion.div>
    </div>
  );
};
