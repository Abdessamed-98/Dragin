
import React, { useState, useEffect, Component, ErrorInfo } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate } from 'framer-motion';
import { ToolWidget } from './ToolWidget';
import { ToolRail, RAIL_W } from './ToolRail';
import { CarryBanner } from './CarryBanner';
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

export type DockEdge = 'right' | 'left' | 'top' | 'bottom';

interface SideDockProps {
  contentRef?: React.RefObject<HTMLDivElement | null>;
  isVisible: boolean;
  edge?: DockEdge;
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
  /** Switch the open tool in place (tool rail) — session files carry over. */
  onSwitchTool: (toolId: ToolId) => void;
  /** Manually process carried (idle) items in a session tool's panel. */
  onProcessIdle?: (toolId: ToolId) => void;
  clearGen?: number;
  compressorQuality?: number;
  onRecompress?: (quality: number) => void;
  removerModelLoading?: boolean;
  onSelfItemCountChange?: (toolId: ToolId, count: number) => void;
}

export const SideDock: React.FC<SideDockProps> = ({
  contentRef,
  isVisible,
  edge = 'right',
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
  onSwitchTool,
  onProcessIdle,
  clearGen,
  compressorQuality,
  onRecompress,
  removerModelLoading,
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

  // ── TONGUE PANEL GEOMETRY (edge-generalized) ─────────────────────────────────
  // The dock is one edge-attached "tongue" panel that can live on any screen edge.
  // We reason in two axes relative to the edge instead of fixed width/height:
  //   • PERP  = perpendicular to the edge — the reveal/grow axis (0 → full).
  //   • LEN   = along the edge — where the rail tiles stack.
  // For left/right edges PERP maps to width and LEN to height; for top/bottom they
  // swap. Everything below is written once in perp/len terms, then mapped at the end.
  const isVertical = edge === 'right' || edge === 'left';
  const PAD = 8;          // padding around the rail tiles
  const GAP = 10;         // gap between rail tiles (along LEN)
  const TILE = 80;        // rail tile size
  const OUTER_R = 24;     // "corner value" R = tile radius (16) + PAD (8) → concentric with tiles
  const R = OUTER_R;

  const tileCount = activeTools.length;
  const railThickness = TILE + PAD * 2;            // PERP extent of the rail
  const railLength = tileCount > 0                 // LEN extent of the rail
    ? tileCount * TILE + (tileCount - 1) * GAP + PAD * 2
    : TILE + PAD * 2;
  // Expanded tool panel stays portrait (420×672) in SCREEN space on every edge.
  // The tool rail (RAIL_W) rides on the screen-edge side of the panel, so the
  // expanded PERP extent is panel + rail.
  const PANEL_W = Math.min(420, window.innerWidth - 20 - RAIL_W);
  const PANEL_H = Math.min(Math.round(PANEL_W * 8 / 5), window.innerHeight - 24);
  const ONE_TOOL_LEN = TILE + PAD * 2;             // LEN at one-tool reveal start
  const perpExpanded = (isVertical ? PANEL_W : PANEL_H) + RAIL_W;
  const lenExpanded = isVertical ? PANEL_H : PANEL_W;

  const perpTarget = expandedToolId ? perpExpanded : railThickness;
  const lenTarget = expandedToolId ? lenExpanded : railLength;

  // ── PERP-driven reveal ────────────────────────────────────────────────────────
  // The neck (concave fillet) size is derived from the live PERP value: 0 until the
  // rounded cap completes (perp = R), then grows to full (R) by perp = 2R, then
  // stays pinned — the 3-phase behaviour, now edge-agnostic.
  const REVEAL_DUR = 0.45;           // tongue open/close duration
  const REVEAL_EASE = [0.22, 1, 0.36, 1] as const; // smooth ease-out (snappy open, soft settle)
  const perpMV = useMotionValue(isVisible ? perpTarget : 0);
  useEffect(() => {
    const c = animate(perpMV, isVisible ? perpTarget : 0, { duration: REVEAL_DUR, ease: REVEAL_EASE });
    return () => c.stop();
  }, [isVisible, perpTarget]); // eslint-disable-line react-hooks/exhaustive-deps
  const neckMV = useTransform(perpMV, (v) => Math.min(Math.max((v - R) / R, 0), 1) * R);
  // LEN has its OWN tween (see effect below) so it grows/shrinks *with* perp on
  // expand/collapse instead of snapping.
  const lenMV = useMotionValue(isVisible ? lenTarget : ONE_TOOL_LEN);

  // Stagger gated on the LEN timeline: a tile waits until the rail has grown enough
  // to fit its row. LEN only starts growing once the cap completes (at tCap),
  // expanding from the middle outward to full at REVEAL_DUR.
  const tCap = (R / Math.max(1, perpTarget)) * REVEAL_DUR; // time the rounded cap completes
  const STAGGER_GAP = 0.045;         // delay between successive tiles (smaller = tighter)
  const TILE_POP = (REVEAL_DUR - tCap) + REVEAL_DUR * 0.35;

  // ── LEN ANIMATION ─────────────────────────────────────────────────────────────
  const prevVisibleRef = React.useRef(isVisible);
  useEffect(() => {
    const justRevealed = isVisible && !prevVisibleRef.current;
    prevVisibleRef.current = isVisible;
    let target = ONE_TOOL_LEN, duration = REVEAL_DUR, delay = 0;
    if (isVisible && expandedToolId) {
      target = lenExpanded;                                             // expand/collapse
    } else if (isVisible) {
      target = railLength;
      if (justRevealed) { delay = tCap; duration = REVEAL_DUR - tCap; } // reveal lag only
    }
    const ctrl = animate(lenMV, target, { duration, delay, ease: REVEAL_EASE });
    return () => ctrl.stop();
  }, [isVisible, expandedToolId, railLength, lenExpanded]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── EDGE → CSS MAPPING ──────────────────────────────────────────────────────
  // Map perp/len motion values onto width/height, plus the per-edge anchor, body
  // corner radii, neck fillet placement, tile slide direction and rail flex axis.
  const sizeStyle = isVertical ? { width: perpMV, height: lenMV } : { width: lenMV, height: perpMV };
  const containerAlign = ({
    right: 'justify-end items-center',
    left: 'justify-start items-center',
    top: 'justify-center items-start',
    bottom: 'justify-center items-end',
  } as const)[edge];
  const bodyRadius = ({
    right: { borderTopLeftRadius: OUTER_R, borderBottomLeftRadius: OUTER_R },
    left: { borderTopRightRadius: OUTER_R, borderBottomRightRadius: OUTER_R },
    top: { borderBottomLeftRadius: OUTER_R, borderBottomRightRadius: OUTER_R },
    bottom: { borderTopLeftRadius: OUTER_R, borderTopRightRadius: OUTER_R },
  } as const)[edge];
  // Two neck fillets sit at the panel's outer-edge corners, extending past each end
  // along LEN. `pos` anchors the fillet; `corner` is the radial-gradient origin of
  // the concave cut (transparent quarter facing the screen centre).
  const neckSpecs: { pos: React.CSSProperties; corner: string }[] = {
    right: [{ pos: { right: 0, bottom: '100%' }, corner: 'top left' }, { pos: { right: 0, top: '100%' }, corner: 'bottom left' }],
    left: [{ pos: { left: 0, bottom: '100%' }, corner: 'top right' }, { pos: { left: 0, top: '100%' }, corner: 'bottom right' }],
    top: [{ pos: { top: 0, right: '100%' }, corner: 'bottom left' }, { pos: { top: 0, left: '100%' }, corner: 'bottom right' }],
    bottom: [{ pos: { bottom: 0, right: '100%' }, corner: 'top left' }, { pos: { bottom: 0, left: '100%' }, corner: 'top right' }],
  }[edge];
  // Tiles slide IN from the screen edge (perpendicular). +dir = from right/bottom.
  const slideAxis: 'x' | 'y' = isVertical ? 'x' : 'y';
  const slideDist = railThickness * (edge === 'right' || edge === 'bottom' ? 1 : -1);
  const railFlex = isVertical ? 'flex-col' : 'flex-row';

  // Tool-rail placement: the rail strip hugs the screen edge; the expanded panel
  // is inset by RAIL_W on that side, MINUS an overlap that tucks the panel under
  // the rail's inner margin — so the visual gap between the rail tiles and the
  // tool's content matches the tile→edge gap instead of stacking the tool's own
  // inner padding on top of the strip width. (Panel bg is transparent glass and
  // the rail renders above it, so the overlap is invisible and non-interactive.)
  const RAIL_OVERLAP = 12;
  const panelInset: React.CSSProperties = ({
    right: { right: RAIL_W - RAIL_OVERLAP }, left: { left: RAIL_W - RAIL_OVERLAP },
    top: { top: RAIL_W - RAIL_OVERLAP }, bottom: { bottom: RAIL_W - RAIL_OVERLAP },
  } as const)[edge];
  const railPos: React.CSSProperties = ({
    right: { right: 0, top: 0, bottom: 0, width: RAIL_W },
    left: { left: 0, top: 0, bottom: 0, width: RAIL_W },
    top: { top: 0, left: 0, right: 0, height: RAIL_W },
    bottom: { bottom: 0, left: 0, right: 0, height: RAIL_W },
  } as const)[edge];

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
    const insertAfter = isVertical
      ? e.clientY > rect.top + rect.height / 2
      : e.clientX > rect.left + rect.width / 2;
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
  // Inverted-corner fillet: a glass square with a transparent quarter-circle cut
  // (origin = `corner`), leaving an L that hugs the edge line + the panel and
  // presents a concave arc — so the panel "necks" into the line. Size-independent
  // (farthest-side) so the fillet scales with neckMV.
  const filletMask = (corner: string) => `radial-gradient(circle farthest-side at ${corner}, #0000 98.5%, #000 99.5%)`;

  return (
    // dir="ltr" overrides document dir="rtl" (Arabic) so flex layout is predictable
    <div ref={contentRef} dir="ltr" className={`fixed inset-0 flex z-50 pointer-events-none ${containerAlign}`}>

      {/* DEBUG SENSING ZONES (toggled from Settings → off by default; right-edge layout) */}
      {showZones && (<>
        {isVisible && (
          <div
            className="absolute pointer-events-none"
            style={{ zIndex: 1, right: 0, top: '50%', transform: 'translateY(-50%)', width: railThickness + 100, height: railLength + 200, background: 'rgba(59,130,246,0.14)', outline: '2px dashed #3b82f6', outlineOffset: -2 }}
          />
        )}
        <div className="absolute top-0 right-0 bottom-0 pointer-events-none" style={{ zIndex: 2, width: 16, background: 'rgba(34,197,94,0.40)' }} />
      </>)}

      {/* ── THE TONGUE: one edge-attached frame that holds the rail or the active tool ── */}
      <motion.div
        initial={false}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
        data-interactive
        // PERP-driven reveal via motion values; necks (neckMV) track the perp axis.
        className="relative pointer-events-auto"
        style={{ ...sizeStyle, willChange: 'width, height' }}
      >
        {/* Background surface: glass body (rounded inner corners, flush to the edge)
            + two concave neck fillets molding it into the edge line. The whole
            group shares one drop-shadow so the necks cast shadow too. */}
        <div className="absolute inset-0" style={{ zIndex: 0, filter: `var(--tongue-shadow-${edge})` }}>
          {/* main body — the outer edge sits flush against the screen edge line */}
          <div className="absolute inset-0" style={{ ...glass, ...bodyRadius }} />
          {/* two neck fillets at the outer-edge corners (size = neckMV) */}
          {neckSpecs.map((n, idx) => (
            <motion.div key={idx} style={{ position: 'absolute', ...n.pos, width: neckMV, height: neckMV, ...glass, WebkitMaskImage: filletMask(n.corner), maskImage: filletMask(n.corner) }} />
          ))}
        </div>

        {/* RED — the tongue's interactive/sensing hit area (debug, toggled from Settings) */}
        {showZones && (
          <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 60, background: 'rgba(255,0,0,0.35)', outline: '2px solid red' }} />
        )}

        {/* Content: clipped to the panel + faded, so the retracting frame never shows squashed/clipped tiles */}
        <div
          className={`absolute inset-0 overflow-hidden flex ${railFlex} items-center justify-center`}
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
            // Tiles SLIDE in from the screen edge (perpendicular). No scale, no centre-slide.
            // slideAxis/slideDist flip per edge so they always enter from outside.

            return (
              <motion.div
                layout={localOrder ? "position" : false}
                key={tool.id}
                initial={{ opacity: 0, [slideAxis]: slideDist }}
                animate={{
                  opacity: !isVisible ? 0 : (draggingId === tool.id ? 0.4 : 1),
                  [slideAxis]: !isVisible ? slideDist : 0,
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
                style={hiddenByExpand ? { display: 'none' } : (isActive ? panelInset : undefined)}
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
                  onProcessIdle={onProcessIdle ? () => onProcessIdle(tool.id) : undefined}
                  onOpenSettings={onOpenGallery}
                  externalDragHover={isFileDragHovered}
                  externalDragHandled={true}
                  otherToolCount={activeToolIds.length - 1}
                  clearGen={clearGen}
                  compressorQuality={tool.id === 'compressor' ? compressorQuality : undefined}
                  onRecompress={tool.id === 'compressor' ? onRecompress : undefined}
                  isModelLoading={tool.id === 'remover' ? removerModelLoading : undefined}
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

        {/* Tool rail — switch tools in place while a panel is open (session carries) */}
        {expandedToolId && isVisible && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.15, delay: 0.18 }}
            className="absolute z-20 pointer-events-auto"
            style={railPos}
            data-interactive
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
          >
            <ToolRail
              edge={edge}
              activeToolIds={effectiveToolIds}
              expandedToolId={expandedToolId}
              onSwitch={onSwitchTool}
            />
          </motion.div>
        )}

        {/* Carry banner — floats over the open panel after a switch with results */}
        {expandedToolId && isVisible && (
          <div className="absolute inset-0 z-[70] pointer-events-none" style={panelInset}>
            <CarryBanner expandedToolId={expandedToolId} />
          </div>
        )}
      </motion.div>
    </div>
  );
};
