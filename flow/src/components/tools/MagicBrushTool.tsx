import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Check, X, Loader2, Eraser, Paintbrush, Sparkles, Undo2, Redo2 } from 'lucide-react';

interface MagicBrushToolProps {
    originalImageSrc: string;
    processedImageSrc: string;
    onSave: (newImageSrc: string) => void;
    onCancel: () => void;
}

export const MagicBrushTool: React.FC<MagicBrushToolProps> = ({
    originalImageSrc,
    processedImageSrc,
    onSave,
    onCancel
}) => {
    // --- State ---
    const [brushMode, setBrushMode] = useState<'erase' | 'restore'>('erase');
    const [brushSize, setBrushSize] = useState(30);
    const [isMagicBrush, setIsMagicBrush] = useState(true);
    const [isLoading, setIsLoading] = useState(true);
    const [cursorPos, setCursorPos] = useState<{ x: number; y: number }>({ x: -100, y: -100 });
    const [cursorVisible, setCursorVisible] = useState(false);
    const [isAdjustingSize, setIsAdjustingSize] = useState(false);
    const adjustTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // --- Refs ---
    const containerRef = useRef<HTMLDivElement>(null);
    const displayCanvasRef = useRef<HTMLCanvasElement>(null);
    const originalCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const workingCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const originalDataRef = useRef<ImageData | null>(null);
    const processedDataRef = useRef<ImageData | null>(null); // AI result (for restore BFS)
    const isDrawingRef = useRef(false);
    const lastPointRef = useRef<{ x: number; y: number } | null>(null);
    const scaleRef = useRef(1);
    const offsetRef = useRef({ x: 0, y: 0 });
    const undoStackRef = useRef<ImageData[]>([]);
    const redoStackRef = useRef<ImageData[]>([]);
    const [undoCount, setUndoCount] = useState(0);
    const [redoCount, setRedoCount] = useState(0);
    const naturalSizeRef = useRef({ w: 0, h: 0 });

    // Smart selection refs
    const selectionMaskRef = useRef<HTMLCanvasElement | null>(null);
    const magicActiveRef = useRef(false);

    // State refs for stable callbacks
    const isMagicBrushRef = useRef(isMagicBrush);
    const brushModeRef = useRef(brushMode);
    const brushSizeRef = useRef(brushSize);
    useEffect(() => { isMagicBrushRef.current = isMagicBrush; }, [isMagicBrush]);
    useEffect(() => { brushModeRef.current = brushMode; }, [brushMode]);
    useEffect(() => { brushSizeRef.current = brushSize; }, [brushSize]);

    const MAX_UNDO = 20;
    const ALPHA_THRESHOLD = 10;

    // --- Initialize canvases ---
    useEffect(() => {
        let cancelled = false;

        const init = async () => {
            const loadImg = (src: string): Promise<HTMLImageElement> =>
                new Promise((resolve, reject) => {
                    const img = new Image();
                    img.crossOrigin = 'anonymous';
                    img.onload = () => resolve(img);
                    img.onerror = reject;
                    img.src = src;
                });

            try {
                const [origImg, procImg] = await Promise.all([
                    loadImg(originalImageSrc),
                    loadImg(processedImageSrc)
                ]);

                if (cancelled) return;

                const w = procImg.naturalWidth;
                const h = procImg.naturalHeight;
                naturalSizeRef.current = { w, h };

                // Original canvas (full photo)
                const origCanvas = document.createElement('canvas');
                origCanvas.width = w;
                origCanvas.height = h;
                const origCtx = origCanvas.getContext('2d')!;
                origCtx.drawImage(origImg, 0, 0, w, h);
                originalCanvasRef.current = origCanvas;
                originalDataRef.current = origCtx.getImageData(0, 0, w, h);

                // Working canvas (starts from processed result)
                const workCanvas = document.createElement('canvas');
                workCanvas.width = w;
                workCanvas.height = h;
                const workCtx = workCanvas.getContext('2d')!;
                workCtx.drawImage(procImg, 0, 0, w, h);
                workingCanvasRef.current = workCanvas;

                // Store processed image data (AI result with per-object alpha blobs)
                processedDataRef.current = workCtx.getImageData(0, 0, w, h);

                // Selection mask canvas (for smart magic brush)
                const selCanvas = document.createElement('canvas');
                selCanvas.width = w;
                selCanvas.height = h;
                selectionMaskRef.current = selCanvas;

                setIsLoading(false);
                requestAnimationFrame(renderDisplay);
            } catch (err) {
                console.error('MagicBrush init failed:', err);
            }
        };

        init();
        return () => { cancelled = true; };
    }, [originalImageSrc, processedImageSrc]);

    // --- Render display canvas ---
    const renderDisplay = useCallback(() => {
        const displayCanvas = displayCanvasRef.current;
        const workingCanvas = workingCanvasRef.current;
        const container = containerRef.current;
        if (!displayCanvas || !workingCanvas || !container) return;

        const containerRect = container.getBoundingClientRect();
        const cw = containerRect.width;
        const ch = containerRect.height;

        const { w: nw, h: nh } = naturalSizeRef.current;
        if (nw === 0 || nh === 0) return;

        const pad = 16;
        const availW = cw - pad * 2;
        const availH = ch - pad * 2;
        const scale = Math.min(availW / nw, availH / nh, 1);
        const dw = Math.round(nw * scale);
        const dh = Math.round(nh * scale);

        displayCanvas.width = dw;
        displayCanvas.height = dh;
        scaleRef.current = scale;
        offsetRef.current = { x: (cw - dw) / 2, y: (ch - dh) / 2 };

        displayCanvas.style.width = `${dw}px`;
        displayCanvas.style.height = `${dh}px`;

        const ctx = displayCanvas.getContext('2d')!;
        ctx.clearRect(0, 0, dw, dh);

        // Checkerboard
        const tileSize = 10;
        for (let y = 0; y < dh; y += tileSize) {
            for (let x = 0; x < dw; x += tileSize) {
                const isLight = ((x / tileSize) + (y / tileSize)) % 2 === 0;
                ctx.fillStyle = isLight ? '#2a2a3a' : '#1e1e2e';
                ctx.fillRect(x, y, tileSize, tileSize);
            }
        }

        // Ghost layer: original image at low opacity (helps see what can be restored)
        const origCanvas = originalCanvasRef.current;
        if (origCanvas) {
            ctx.globalAlpha = 0.12;
            ctx.drawImage(origCanvas, 0, 0, dw, dh);
            ctx.globalAlpha = 1.0;
        }

        // Working image
        ctx.drawImage(workingCanvas, 0, 0, dw, dh);

        // Selection overlay (red tint while magic brush selection is active)
        const selMask = selectionMaskRef.current;
        if (selMask && magicActiveRef.current) {
            ctx.drawImage(selMask, 0, 0, dw, dh);
        }
    }, []);

    // --- Resize handling ---
    useEffect(() => {
        if (isLoading) return;

        const observer = new ResizeObserver(() => {
            requestAnimationFrame(renderDisplay);
        });

        if (containerRef.current) {
            observer.observe(containerRef.current);
        }

        renderDisplay();

        return () => observer.disconnect();
    }, [isLoading, renderDisplay]);

    // --- Convert pointer event to natural image coords ---
    const getImageCoords = useCallback((e: React.PointerEvent): { x: number; y: number } => {
        const canvas = displayCanvasRef.current;
        if (!canvas) return { x: 0, y: 0 };

        const rect = canvas.getBoundingClientRect();
        const displayX = e.clientX - rect.left;
        const displayY = e.clientY - rect.top;
        const scale = scaleRef.current;

        return {
            x: displayX / scale,
            y: displayY / scale
        };
    }, []);

    // --- Get cursor position relative to container ---
    const getCursorDisplayPos = useCallback((e: React.PointerEvent): { x: number; y: number } => {
        const container = containerRef.current;
        if (!container) return { x: 0, y: 0 };
        const rect = container.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }, []);

    // =============================================
    // STANDARD BRUSH (GPU-accelerated canvas compositing)
    // =============================================

    // Reusable temp canvas for restore brush
    const tempBrushCanvasRef = useRef<HTMLCanvasElement | null>(null);
    // rAF batching — only render once per frame
    const renderPendingRef = useRef(false);
    const requestRender = useCallback(() => {
        if (!renderPendingRef.current) {
            renderPendingRef.current = true;
            requestAnimationFrame(() => {
                renderPendingRef.current = false;
                renderDisplay();
            });
        }
    }, [renderDisplay]);

    const applyBrushAt = useCallback((cx: number, cy: number) => {
        const workingCanvas = workingCanvasRef.current;
        const originalCanvas = originalCanvasRef.current;
        if (!workingCanvas || !originalCanvas) return;

        const ctx = workingCanvas.getContext('2d')!;
        const radius = (brushSizeRef.current / (scaleRef.current || 1)) / 2;
        const innerRadius = radius * 0.6;

        if (brushModeRef.current === 'erase') {
            // Erase: use destination-out with radial gradient (GPU-accelerated)
            ctx.save();
            ctx.globalCompositeOperation = 'destination-out';
            const gradient = ctx.createRadialGradient(cx, cy, innerRadius, cx, cy, radius);
            gradient.addColorStop(0, 'rgba(0,0,0,1)');
            gradient.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        } else {
            // Restore: paint original through soft circular mask
            if (!tempBrushCanvasRef.current) {
                tempBrushCanvasRef.current = document.createElement('canvas');
            }
            const temp = tempBrushCanvasRef.current;
            const d = Math.ceil(radius * 2);
            if (d <= 0) return;
            const sx = Math.floor(cx - radius);
            const sy = Math.floor(cy - radius);
            temp.width = d;
            temp.height = d;
            const tCtx = temp.getContext('2d')!;

            // Draw original image region
            tCtx.drawImage(originalCanvas, sx, sy, d, d, 0, 0, d, d);

            // Mask with radial gradient
            tCtx.globalCompositeOperation = 'destination-in';
            const gradient = tCtx.createRadialGradient(d / 2, d / 2, innerRadius, d / 2, d / 2, radius);
            gradient.addColorStop(0, 'rgba(0,0,0,1)');
            gradient.addColorStop(1, 'rgba(0,0,0,0)');
            tCtx.fillStyle = gradient;
            tCtx.beginPath();
            tCtx.arc(d / 2, d / 2, radius, 0, Math.PI * 2);
            tCtx.fill();

            // Composite onto working canvas
            ctx.drawImage(temp, sx, sy);
        }
    }, []);

    const interpolateAndApply = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const naturalBrush = brushSizeRef.current / (scaleRef.current || 1);
        const step = Math.max(1, naturalBrush / 4);
        const steps = Math.ceil(dist / step);

        for (let i = 0; i <= steps; i++) {
            const t = steps === 0 ? 0 : i / steps;
            applyBrushAt(from.x + dx * t, from.y + dy * t);
        }
    }, [applyBrushAt]);

    // =============================================
    // MAGIC BRUSH (selection → smart detection)
    // =============================================

    const paintMaskAt = useCallback((cx: number, cy: number) => {
        const mask = selectionMaskRef.current;
        if (!mask) return;
        const ctx = mask.getContext('2d')!;
        const radius = (brushSizeRef.current / (scaleRef.current || 1)) / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(239, 68, 68, 0.45)';
        ctx.fill();
    }, []);

    const interpolateMask = useCallback((from: { x: number; y: number }, to: { x: number; y: number }) => {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const naturalBrush = brushSizeRef.current / (scaleRef.current || 1);
        const step = Math.max(1, naturalBrush / 6);
        const steps = Math.ceil(dist / step);

        for (let i = 0; i <= steps; i++) {
            const t = steps === 0 ? 0 : i / steps;
            paintMaskAt(from.x + dx * t, from.y + dy * t);
        }
    }, [paintMaskAt]);

    // BFS-based smart selection
    const processSmartSelection = useCallback(() => {
        const selMask = selectionMaskRef.current;
        const workingCanvas = workingCanvasRef.current;
        const origData = originalDataRef.current;
        const procData = processedDataRef.current;
        if (!selMask || !workingCanvas || !origData || !procData) return;

        const { w: width, h: height } = naturalSizeRef.current;
        const selCtx = selMask.getContext('2d')!;
        const selData = selCtx.getImageData(0, 0, width, height);

        const workCtx = workingCanvas.getContext('2d')!;
        const workData = workCtx.getImageData(0, 0, width, height);

        const mode = brushModeRef.current;

        // Connectivity source:
        // Erase → working canvas alpha (find current foreground blobs to remove)
        // Restore → processed image alpha (find AI-detected object blobs to bring back)
        const sourceData = mode === 'erase' ? workData.data : procData.data;

        const totalPixels = width * height;
        const visited = new Uint8Array(totalPixels);
        const toApply = new Uint8Array(totalPixels);

        // BFS from each selected foreground pixel
        for (let i = 0; i < totalPixels; i++) {
            if (selData.data[i * 4 + 3] === 0) continue;
            if (visited[i]) continue;
            if (sourceData[i * 4 + 3] < ALPHA_THRESHOLD) continue;

            const queue: number[] = [i];
            let head = 0;
            visited[i] = 1;

            while (head < queue.length) {
                const idx = queue[head++];
                toApply[idx] = 1;

                const x = idx % width;
                const y = (idx - x) / width;

                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
                        const ni = ny * width + nx;
                        if (visited[ni]) continue;
                        if (sourceData[ni * 4 + 3] < ALPHA_THRESHOLD) continue;
                        visited[ni] = 1;
                        queue.push(ni);
                    }
                }
            }
        }

        for (let i = 0; i < totalPixels; i++) {
            if (!toApply[i]) continue;
            const pi = i * 4;

            if (mode === 'erase') {
                workData.data[pi + 3] = 0;
            } else {
                // Restore from original photo
                workData.data[pi] = origData.data[pi];
                workData.data[pi + 1] = origData.data[pi + 1];
                workData.data[pi + 2] = origData.data[pi + 2];
                workData.data[pi + 3] = origData.data[pi + 3];
            }
        }

        workCtx.putImageData(workData, 0, 0);
    }, []);

    // --- Undo/Redo ---
    const saveUndoSnapshot = useCallback(() => {
        const workingCanvas = workingCanvasRef.current;
        if (!workingCanvas) return;
        const ctx = workingCanvas.getContext('2d')!;
        const { w, h } = naturalSizeRef.current;
        const snapshot = ctx.getImageData(0, 0, w, h);

        undoStackRef.current = [...undoStackRef.current.slice(-(MAX_UNDO - 1)), snapshot];
        setUndoCount(undoStackRef.current.length);

        // New action clears redo
        redoStackRef.current = [];
        setRedoCount(0);
    }, []);

    const handleUndo = useCallback(() => {
        if (undoStackRef.current.length === 0) return;
        const workCtx = workingCanvasRef.current?.getContext('2d');
        if (!workCtx) return;

        // Push current state to redo
        const { w, h } = naturalSizeRef.current;
        const currentState = workCtx.getImageData(0, 0, w, h);
        redoStackRef.current = [...redoStackRef.current.slice(-(MAX_UNDO - 1)), currentState];
        setRedoCount(redoStackRef.current.length);

        // Pop from undo
        const prev = undoStackRef.current[undoStackRef.current.length - 1];
        undoStackRef.current = undoStackRef.current.slice(0, -1);
        setUndoCount(undoStackRef.current.length);

        workCtx.putImageData(prev, 0, 0);
        renderDisplay();
    }, [renderDisplay]);

    const handleRedo = useCallback(() => {
        if (redoStackRef.current.length === 0) return;
        const workCtx = workingCanvasRef.current?.getContext('2d');
        if (!workCtx) return;

        // Push current state to undo
        const { w, h } = naturalSizeRef.current;
        const currentState = workCtx.getImageData(0, 0, w, h);
        undoStackRef.current = [...undoStackRef.current.slice(-(MAX_UNDO - 1)), currentState];
        setUndoCount(undoStackRef.current.length);

        // Pop from redo
        const next = redoStackRef.current[redoStackRef.current.length - 1];
        redoStackRef.current = redoStackRef.current.slice(0, -1);
        setRedoCount(redoStackRef.current.length);

        workCtx.putImageData(next, 0, 0);
        renderDisplay();
    }, [renderDisplay]);

    // --- Pointer events ---
    const handlePointerDown = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);

        saveUndoSnapshot();

        const point = getImageCoords(e);
        lastPointRef.current = point;
        isDrawingRef.current = true;

        if (isMagicBrushRef.current) {
            const mask = selectionMaskRef.current;
            if (mask) mask.getContext('2d')!.clearRect(0, 0, mask.width, mask.height);
            magicActiveRef.current = true;
            paintMaskAt(point.x, point.y);
        } else {
            applyBrushAt(point.x, point.y);
        }
        requestRender();
    }, [saveUndoSnapshot, getImageCoords, applyBrushAt, paintMaskAt, requestRender]);

    const handlePointerMove = useCallback((e: React.PointerEvent) => {
        setCursorPos(getCursorDisplayPos(e));
        setCursorVisible(true);

        if (!isDrawingRef.current) return;

        const point = getImageCoords(e);
        if (lastPointRef.current) {
            if (magicActiveRef.current) {
                interpolateMask(lastPointRef.current, point);
            } else {
                interpolateAndApply(lastPointRef.current, point);
            }
        }
        lastPointRef.current = point;
        requestRender();
    }, [getCursorDisplayPos, getImageCoords, interpolateAndApply, interpolateMask, requestRender]);

    const handlePointerUp = useCallback(() => {
        isDrawingRef.current = false;
        lastPointRef.current = null;

        if (magicActiveRef.current) {
            processSmartSelection();
            magicActiveRef.current = false;
            const mask = selectionMaskRef.current;
            if (mask) mask.getContext('2d')!.clearRect(0, 0, mask.width, mask.height);
            renderDisplay();
        }
    }, [processSmartSelection, renderDisplay]);

    // --- Keyboard shortcuts ---
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
                e.preventDefault();
                handleRedo();
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
                e.preventDefault();
                handleUndo();
            } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
                e.preventDefault();
                handleRedo();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [handleUndo, handleRedo]);

    // --- Save ---
    const handleSave = useCallback(() => {
        if (!workingCanvasRef.current) return;
        onSave(workingCanvasRef.current.toDataURL('image/png'));
    }, [onSave]);

    // brushSize is in display pixels (consistent on screen regardless of image size)
    const brushDisplaySize = brushSize;

    return (
        <div className="absolute inset-0 flex flex-col z-[100] rounded-2xl overflow-hidden">
            {/* Top toolbar */}
            <div className="h-10 bg-slate-900/90 border-b border-white/5 flex items-center justify-between px-3 shrink-0 z-20">
                {/* Undo / Redo (icons only) */}
                <div className="flex items-center gap-0.5">
                    <button
                        onClick={handleUndo}
                        disabled={undoCount === 0}
                        className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition-colors"
                        title="تراجع (Ctrl+Z)"
                    >
                        <Undo2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={handleRedo}
                        disabled={redoCount === 0}
                        className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-white/5 disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-slate-400 transition-colors"
                        title="إعادة (Ctrl+Shift+Z)"
                    >
                        <Redo2 className="w-3.5 h-3.5" />
                    </button>
                </div>

                {/* Cancel + Save */}
                <div className="flex items-center gap-1.5">
                    <button
                        onClick={onCancel}
                        className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                        title="إلغاء"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isLoading}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white text-[10px] font-bold shadow-sm transition-all active:scale-95"
                    >
                        <Check className="w-3 h-3" />
                        <span>حفظ</span>
                    </button>
                </div>
            </div>

            {/* Canvas area */}
            <div
                ref={containerRef}
                className="flex-1 relative overflow-hidden flex items-center justify-center min-h-0 bg-[#0c0c14]"
                onPointerLeave={() => setCursorVisible(false)}
            >
                {isLoading ? (
                    <div className="flex flex-col items-center gap-3">
                        <Loader2 className="w-8 h-8 text-indigo-400 animate-spin" />
                        <span className="text-xs text-slate-400">جاري التحميل...</span>
                    </div>
                ) : (
                    <>
                        <canvas
                            ref={displayCanvasRef}
                            onPointerDown={handlePointerDown}
                            onPointerMove={handlePointerMove}
                            onPointerUp={handlePointerUp}
                            style={{ cursor: 'none', touchAction: 'none' }}
                            className="block relative z-10"
                        />

                        {/* Custom brush cursor — fades out on leave */}
                        <div
                            className="absolute rounded-full pointer-events-none z-20"
                            style={{
                                left: cursorPos.x - brushDisplaySize / 2,
                                top: cursorPos.y - brushDisplaySize / 2,
                                width: brushDisplaySize,
                                height: brushDisplaySize,
                                border: `2px solid ${brushMode === 'erase' ? 'rgba(239,68,68,0.7)' : 'rgba(129,140,248,0.7)'}`,
                                boxShadow: `0 0 0 1px ${brushMode === 'erase' ? 'rgba(239,68,68,0.15)' : 'rgba(129,140,248,0.15)'}`,
                                opacity: cursorVisible ? 1 : 0,
                                transition: 'opacity 0.15s ease-out',
                            }}
                        />

                        {/* Brush size preview — shows centered while adjusting slider */}
                        {isAdjustingSize && (
                            <div
                                className="absolute pointer-events-none z-20 rounded-full"
                                style={{
                                    left: '50%',
                                    top: '50%',
                                    width: brushDisplaySize,
                                    height: brushDisplaySize,
                                    transform: 'translate(-50%, -50%)',
                                    border: `2px solid ${brushMode === 'erase' ? 'rgba(239,68,68,0.6)' : 'rgba(129,140,248,0.6)'}`,
                                    background: `${brushMode === 'erase' ? 'rgba(239,68,68,0.08)' : 'rgba(129,140,248,0.08)'}`,
                                }}
                            />
                        )}
                    </>
                )}
            </div>

            {/* Bottom controls */}
            <div className="bg-slate-900/95 border-t border-white/5 px-3 py-2.5 shrink-0 space-y-2.5">
                {/* Brush size slider */}
                <div className="space-y-1">
                    <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">حجم الفرشاة</span>
                        <span className="text-[10px] text-indigo-300 font-medium">{brushSize}px</span>
                    </div>
                    <div className="relative">
                        <input
                            type="range"
                            min="5"
                            max="100"
                            value={brushSize}
                            onChange={(e) => {
                                setBrushSize(Number(e.target.value));
                                setIsAdjustingSize(true);
                                if (adjustTimeoutRef.current) clearTimeout(adjustTimeoutRef.current);
                                adjustTimeoutRef.current = setTimeout(() => setIsAdjustingSize(false), 400);
                            }}
                            className="w-full h-1.5 rounded-full appearance-none cursor-pointer
                                bg-gradient-to-r from-slate-700 via-indigo-900/50 to-indigo-500
                                [&::-webkit-slider-thumb]:appearance-none
                                [&::-webkit-slider-thumb]:w-3.5
                                [&::-webkit-slider-thumb]:h-3.5
                                [&::-webkit-slider-thumb]:rounded-full
                                [&::-webkit-slider-thumb]:bg-white
                                [&::-webkit-slider-thumb]:border-2
                                [&::-webkit-slider-thumb]:border-indigo-500
                                [&::-webkit-slider-thumb]:shadow-md
                                [&::-webkit-slider-thumb]:shadow-indigo-500/30
                                [&::-webkit-slider-thumb]:transition-transform
                                [&::-webkit-slider-thumb]:hover:scale-125
                                [&::-webkit-slider-thumb]:active:scale-110
                            "
                        />
                    </div>
                </div>

                {/* Erase/Restore toggle + Magic brush switch */}
                <div className="flex items-center gap-2">
                    {/* Erase / Restore toggle */}
                    <div className="flex items-center gap-px bg-slate-800/60 p-0.5 rounded-lg border border-white/5">
                        <button
                            onClick={() => setBrushMode('erase')}
                            className={`flex items-center justify-center gap-1 w-[72px] py-1 rounded-md text-[10px] font-bold transition-all ${
                                brushMode === 'erase'
                                    ? 'bg-indigo-500 text-white shadow-sm'
                                    : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
                            }`}
                        >
                            <Eraser className="w-3 h-3" />
                            مسح
                        </button>
                        <button
                            onClick={() => setBrushMode('restore')}
                            className={`flex items-center justify-center gap-1 w-[72px] py-1 rounded-md text-[10px] font-bold transition-all ${
                                brushMode === 'restore'
                                    ? 'bg-indigo-500 text-white shadow-sm'
                                    : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
                            }`}
                        >
                            <Paintbrush className="w-3 h-3" />
                            استعادة
                        </button>
                    </div>

                    {/* Magic brush toggle switch */}
                    <button
                        onClick={() => setIsMagicBrush(!isMagicBrush)}
                        className="flex items-center gap-1.5 ml-auto"
                    >
                        <Sparkles className={`w-3 h-3 transition-colors ${isMagicBrush ? 'text-indigo-300' : 'text-slate-500'}`} />
                        <span className={`text-[10px] font-bold transition-colors ${isMagicBrush ? 'text-indigo-200' : 'text-slate-500'}`}>فرشاة ذكية</span>
                        <div className={`relative w-8 h-[18px] rounded-full transition-colors ${
                            isMagicBrush ? 'bg-indigo-500' : 'bg-slate-600'
                        }`}>
                            <div className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-sm transition-transform ${
                                isMagicBrush ? 'translate-x-[14px]' : 'translate-x-[2px]'
                            }`} />
                        </div>
                    </button>
                </div>
            </div>
        </div>
    );
};
