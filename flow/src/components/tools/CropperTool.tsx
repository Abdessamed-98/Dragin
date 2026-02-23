import React, { useState, useRef, useEffect, useCallback, MouseEvent as ReactMouseEvent } from 'react';
import { Check, X, Square, Monitor, Smartphone, GripHorizontal } from 'lucide-react';

interface CropperToolProps {
    imageSrc: string;
    onSave: (newImageSrc: string) => void;
    onCancel: () => void;
}

type AspectRatio = 'free' | '1:1' | '16:9' | '4:3' | '9:16';

export const CropperTool: React.FC<CropperToolProps> = ({ imageSrc, onSave, onCancel }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);

    // Image rect: position relative to canvasContainer, plus rendered size
    const [imgLayout, setImgLayout] = useState<{
        offsetX: number, offsetY: number, width: number, height: number, naturalWidth: number, naturalHeight: number
    } | null>(null);

    const [crop, setCrop] = useState({ x: 10, y: 10, width: 80, height: 80 });
    const [aspect, setAspect] = useState<AspectRatio>('free');

    const [dragState, setDragState] = useState<{
        active: boolean,
        type: 'move' | 'nw' | 'ne' | 'sw' | 'se' | null,
        startX: number,
        startY: number,
        startCrop: typeof crop
    }>({ active: false, type: null, startX: 0, startY: 0, startCrop: { ...crop } });

    // Measure image position relative to the canvas container
    const updateImageLayout = useCallback(() => {
        if (imageRef.current && containerRef.current) {
            const containerRect = containerRef.current.getBoundingClientRect();
            const imgRect = imageRef.current.getBoundingClientRect();

            // Only update if dimensions are valid (prevents "shrink to corner" bug)
            if (imgRect.width > 0 && imgRect.height > 0) {
                setImgLayout({
                    offsetX: imgRect.left - containerRect.left,
                    offsetY: imgRect.top - containerRect.top,
                    width: imgRect.width,
                    height: imgRect.height,
                    naturalWidth: imageRef.current.naturalWidth,
                    naturalHeight: imageRef.current.naturalHeight
                });
            }
        }
    }, []);

    // Use ResizeObserver for robust layout tracking
    useEffect(() => {
        const imgEl = imageRef.current;
        const containerEl = containerRef.current;

        if (!imgEl || !containerEl) return;

        const observer = new ResizeObserver(() => {
            // Using requestAnimationFrame to debounce and align with render
            requestAnimationFrame(updateImageLayout);
        });

        observer.observe(imgEl);
        observer.observe(containerEl);

        // Initial check if image is already complete
        if (imgEl.complete) {
            updateImageLayout();
        }

        return () => observer.disconnect();
    }, [updateImageLayout]);

    // Handle image load event specifically for first render
    const handleImageLoad = () => {
        updateImageLayout();
        // Reset crop to default centered box on new image load
        setCrop({ x: 10, y: 10, width: 80, height: 80 });
    };

    // Aspect Ratio Logic
    useEffect(() => {
        if (aspect === 'free' || !imgLayout) return;

        let targetRatioVal = 1;
        if (aspect === '16:9') targetRatioVal = 16 / 9;
        if (aspect === '4:3') targetRatioVal = 4 / 3;
        if (aspect === '9:16') targetRatioVal = 9 / 16;

        const ratioFactor = (imgLayout.width / imgLayout.height) / targetRatioVal;
        let newH = crop.width * ratioFactor;
        if (newH > 100) newH = 100;
        let newW = newH / ratioFactor;

        setCrop(prev => ({
            ...prev,
            x: Math.max(0, 50 - newW / 2),
            y: Math.max(0, 50 - newH / 2),
            width: newW,
            height: newH
        }));
    }, [aspect, imgLayout]);

    // Global Mouse Handlers for Dragging
    useEffect(() => {
        if (!dragState.active || !imgLayout) return;

        const handleWindowMouseMove = (e: MouseEvent) => {
            e.preventDefault();

            // Calculate delta relative to image dimensions
            const deltaX_pct = ((e.clientX - dragState.startX) / imgLayout.width) * 100;
            const deltaY_pct = ((e.clientY - dragState.startY) / imgLayout.height) * 100;

            let newCrop = { ...dragState.startCrop };
            const sc = dragState.startCrop;

            const getRatioFactor = () => {
                const tv = aspect === '16:9' ? 16 / 9 : aspect === '4:3' ? 4 / 3 : aspect === '9:16' ? 9 / 16 : 1;
                return (imgLayout.width / imgLayout.height) / tv;
            };

            if (dragState.type === 'move') {
                newCrop.x = Math.min(Math.max(sc.x + deltaX_pct, 0), 100 - sc.width);
                newCrop.y = Math.min(Math.max(sc.y + deltaY_pct, 0), 100 - sc.height);
            } else if (dragState.type === 'se') {
                let w = Math.max(5, Math.min(sc.width + deltaX_pct, 100 - sc.x));
                let h = Math.max(5, Math.min(sc.height + deltaY_pct, 100 - sc.y));
                if (aspect !== 'free') {
                    const rf = getRatioFactor();
                    h = w * rf;
                    if (sc.y + h > 100) { h = 100 - sc.y; w = h / rf; }
                    if (sc.x + w > 100) { w = 100 - sc.x; h = w * rf; }
                }
                newCrop.width = w;
                newCrop.height = h;
            } else if (dragState.type === 'sw') {
                // Fixed point: Top-Right (sc.x + sc.width)
                const right = sc.x + sc.width;

                // Calculate new X (checking bounds 0)
                let px = sc.x + deltaX_pct;
                px = Math.max(0, Math.min(px, right - 5));

                let pw = right - px;
                let ph = Math.max(5, Math.min(sc.height + deltaY_pct, 100 - sc.y));

                if (aspect !== 'free') {
                    const rf = getRatioFactor();
                    ph = pw * rf;
                    // Check bottom bound (y + h <= 100)
                    if (sc.y + ph > 100) {
                        ph = 100 - sc.y;
                        pw = ph / rf;
                        px = right - pw;
                    }
                }

                newCrop.x = px;
                newCrop.width = pw;
                newCrop.height = ph;
            } else if (dragState.type === 'nw') {
                // Fixed point: Bottom-Right (sc.x + sc.width, sc.y + sc.height)
                const right = sc.x + sc.width;
                const bottom = sc.y + sc.height;

                let px = sc.x + deltaX_pct;
                let py = sc.y + deltaY_pct;

                // Clamp top-left
                px = Math.max(0, Math.min(px, right - 5));
                py = Math.max(0, Math.min(py, bottom - 5));

                let pw = right - px;
                let ph = bottom - py;

                if (aspect !== 'free') {
                    const rf = getRatioFactor();
                    ph = pw * rf;

                    // Check top bound (py = bottom - ph >= 0)
                    if (bottom - ph < 0) {
                        ph = bottom;
                        pw = ph / rf;
                        px = right - pw;
                        py = 0;
                    } else {
                        py = bottom - ph;
                    }
                }

                newCrop.x = px;
                newCrop.y = py;
                newCrop.width = pw;
                newCrop.height = ph;
            } else if (dragState.type === 'ne') {
                // Fixed point: Bottom-Left (sc.x, sc.y + sc.height)
                const bottom = sc.y + sc.height;

                // Handle Width (expanding right)
                let pw = sc.width + deltaX_pct;
                pw = Math.max(5, Math.min(pw, 100 - sc.x));

                // Handle Height (expanding up) - calc potential py
                let py = sc.y + deltaY_pct;
                py = Math.max(0, Math.min(py, bottom - 5));
                let ph = bottom - py;

                if (aspect !== 'free') {
                    const rf = getRatioFactor();
                    ph = pw * rf;

                    // Check top bound (py = bottom - ph >= 0)
                    if (bottom - ph < 0) {
                        ph = bottom;
                        pw = ph / rf;
                        py = 0;
                    } else {
                        py = bottom - ph;
                    }
                }

                newCrop.width = pw;
                newCrop.height = ph;
                newCrop.y = py;
            }
            setCrop(newCrop);
        };

        const handleWindowMouseUp = () => {
            setDragState(prev => ({ ...prev, active: false }));
        };

        window.addEventListener('mousemove', handleWindowMouseMove);
        window.addEventListener('mouseup', handleWindowMouseUp);

        return () => {
            window.removeEventListener('mousemove', handleWindowMouseMove);
            window.removeEventListener('mouseup', handleWindowMouseUp);
        };
    }, [dragState.active, dragState.type, dragState.startX, dragState.startY, dragState.startCrop, imgLayout, aspect]);

    const handleMouseDown = (e: ReactMouseEvent, type: 'move' | 'nw' | 'ne' | 'sw' | 'se') => {
        e.preventDefault();
        e.stopPropagation();
        setDragState({
            active: true,
            type,
            startX: e.clientX,
            startY: e.clientY,
            startCrop: { ...crop }
        });
    };

    const handleSave = () => {
        if (!imageRef.current || !imgLayout) return;
        const canvas = document.createElement('canvas');
        const img = imageRef.current;
        // Use natural dimensions
        const natW = img.naturalWidth;
        const natH = img.naturalHeight;

        // Ensure crop is valid
        const x = (crop.x / 100) * natW;
        const y = (crop.y / 100) * natH;
        const w = (crop.width / 100) * natW;
        const h = (crop.height / 100) * natH;

        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, x, y, w, h, 0, 0, w, h);
        onSave(canvas.toDataURL());
    };

    const aspectOptions = [
        { id: 'free', icon: <GripHorizontal className="w-3 h-3" />, label: 'حر' },
        { id: '1:1', icon: <Square className="w-3 h-3" />, label: '1:1' },
        { id: '16:9', icon: <Monitor className="w-3 h-3" />, label: '16:9' },
        { id: '4:3', icon: <Monitor className="w-2.5 h-2.5" />, label: '4:3' },
        { id: '9:16', icon: <Smartphone className="w-3 h-3" />, label: '9:16' },
    ];

    return (
        <div
            className="absolute inset-0 flex flex-col z-[100] rounded-2xl overflow-hidden"
        // Container no longer handles mouse events directly for drag logic, 
        // except to possibly stop propagation if needed, but we used window listeners.
        >
            {/* Compact Toolbar */}
            <div className="h-9 bg-slate-900/90 border-b border-white/5 flex items-center justify-between px-2 shrink-0 z-20">
                <div className="flex items-center gap-px bg-slate-800/60 p-0.5 rounded-md border border-white/5">
                    {aspectOptions.map(opt => (
                        <button
                            key={opt.id}
                            onClick={() => setAspect(opt.id as AspectRatio)}
                            className={`
                                flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium transition-all
                                ${aspect === opt.id
                                    ? 'bg-orange-500 text-white shadow-sm'
                                    : 'text-slate-400 hover:bg-slate-700/50 hover:text-slate-200'
                                }
                            `}
                            title={opt.label}
                        >
                            {opt.icon}
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-1">
                    <button
                        onClick={onCancel}
                        className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                        title="إلغاء"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                    <button
                        onClick={handleSave}
                        className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-orange-600 hover:bg-orange-500 text-white text-[10px] font-bold shadow-sm transition-all active:scale-95"
                    >
                        <Check className="w-3 h-3" />
                        <span>قص</span>
                    </button>
                </div>
            </div>

            {/* Canvas Area - min-h-0 is critical for flex shrinking */}
            <div
                className="flex-1 relative overflow-hidden flex items-center justify-center p-2 min-h-0"
                ref={containerRef}
            >
                {/* Image as direct flex child - max-w/h-full properly constrains it */}
                <img
                    ref={imageRef}
                    src={imageSrc}
                    onLoad={handleImageLoad}
                    className="max-w-full max-h-full object-contain block pointer-events-none select-none"
                    style={{ maxHeight: '100%', maxWidth: '100%' }}
                />

                {/* Crop Overlay - only render if we have valid layout */}
                {imgLayout && imgLayout.width > 0 && imgLayout.height > 0 && (
                    <div
                        className="absolute pointer-events-none"
                        style={{
                            left: imgLayout.offsetX,
                            top: imgLayout.offsetY,
                            width: imgLayout.width,
                            height: imgLayout.height,
                        }}
                    >
                        {/* Dim outside crop */}
                        <div className="absolute inset-0">
                            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: `${crop.y}%`, background: 'rgba(0,0,0,0.55)' }} />
                            <div style={{ position: 'absolute', top: `${crop.y + crop.height}%`, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.55)' }} />
                            <div style={{ position: 'absolute', top: `${crop.y}%`, left: 0, width: `${crop.x}%`, height: `${crop.height}%`, background: 'rgba(0,0,0,0.55)' }} />
                            <div style={{ position: 'absolute', top: `${crop.y}%`, right: 0, width: `${100 - (crop.x + crop.width)}%`, height: `${crop.height}%`, background: 'rgba(0,0,0,0.55)' }} />
                        </div>

                        {/* Crop Box */}
                        <div
                            className="absolute border border-white/80 pointer-events-auto cursor-move shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
                            style={{
                                left: `${crop.x}%`,
                                top: `${crop.y}%`,
                                width: `${crop.width}%`,
                                height: `${crop.height}%`,
                            }}
                            onMouseDown={(e) => handleMouseDown(e, 'move')}
                        >
                            {/* Rule of thirds */}
                            <div className="absolute inset-0 pointer-events-none">
                                <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/30" />
                                <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/30" />
                                <div className="absolute top-1/3 left-0 right-0 h-px bg-white/30" />
                                <div className="absolute top-2/3 left-0 right-0 h-px bg-white/30" />
                            </div>

                            {/* Corner handles - increased touch area */}
                            <div className="absolute -bottom-1.5 -right-1.5 w-3.5 h-3.5 bg-orange-500 border-2 border-white rounded-full cursor-se-resize z-50 hover:scale-125 transition-transform shadow-sm"
                                onMouseDown={(e) => handleMouseDown(e, 'se')} />
                            <div className="absolute -bottom-1.5 -left-1.5 w-3.5 h-3.5 bg-white border border-slate-400 rounded-full cursor-sw-resize z-50 hover:scale-125 transition-transform shadow-sm"
                                onMouseDown={(e) => handleMouseDown(e, 'sw')} />
                            <div className="absolute -top-1.5 -left-1.5 w-3.5 h-3.5 bg-white border border-slate-400 rounded-full cursor-nw-resize z-50 hover:scale-125 transition-transform shadow-sm"
                                onMouseDown={(e) => handleMouseDown(e, 'nw')} />
                            <div className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 bg-white border border-slate-400 rounded-full cursor-ne-resize z-50 hover:scale-125 transition-transform shadow-sm"
                                onMouseDown={(e) => handleMouseDown(e, 'ne')} />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
