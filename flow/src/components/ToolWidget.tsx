
import React, { DragEvent, useState, useEffect, useRef, MouseEvent } from 'react';
import { motion } from 'framer-motion';
import { LucideIcon, X, Download, Loader2, CheckCircle2, Eye, EyeOff, Scissors, Trash2, Copy, Check, Crop as CropIcon, PenTool, Minimize2, Settings, File as FileIcon, ClipboardPaste, Paintbrush, Zap, Crosshair, Ban } from 'lucide-react';
import { ActiveSession, ToolId, SessionItem } from '../types';
import JSZip from 'jszip';
import { CropperTool } from './tools/CropperTool';
import { VectorizerTool } from './tools/VectorizerTool';
import { OcrTool } from './tools/OcrTool';
import { CompressorTool } from './tools/CompressorTool';
import { PdfTool } from './tools/PdfTool';
import { ConverterTool } from './tools/ConverterTool';
import { UpscalerTool } from './tools/UpscalerTool';
import { MetadataTool } from './tools/MetadataTool';
import { WatermarkTool } from './tools/WatermarkTool';
import { PaletteTool } from './tools/PaletteTool';
import { MagicBrushTool } from './tools/MagicBrushTool';
import { dragState } from '../state/dragState';
import { clipboardState } from '../state/clipboardState';
import { getFileThumbnail } from '../services/api';

interface ToolWidgetProps {
    id: ToolId;
    title: string;
    description: string;
    icon: LucideIcon;
    colorClass: string;
    isDockVisible: boolean;
    isExpanded: boolean;
    activeSession: ActiveSession | null;
    onDrop: (files: File[], toolId: ToolId) => void;
    onInternalDrop: (sourceToolId: ToolId, targetToolId: ToolId, itemIds: string[]) => void;
    onDelete: () => void;
    onClose: () => void;
    onExpand: () => void;
    onSelectItem: (itemId: string, multi: boolean, range: boolean) => void;
    isToolDragging: boolean;
    isReordering?: boolean;
    onUpdateItem?: (itemId: string, updates: Partial<SessionItem>) => void;
    onOpenSettings?: () => void;
    externalDragHover?: boolean;
    /** When true, the parent SideDock wrapper handles all file drag events.
     *  ToolWidget's own dragEnter/Leave/Drop are skipped to avoid double-handling. */
    externalDragHandled?: boolean;
    /** Number of other (non-expanded) tools in the dock — used to reserve vertical space. */
    otherToolCount?: number;
    /** PDF tool: files forwarded from DockApp drop handler */
    pdfDroppedFiles?: File[];
    pdfDropGen?: number;
    /** Converter tool: files forwarded from DockApp drop handler */
    converterDroppedFiles?: File[];
    converterDropGen?: number;
    /** Upscaler tool: files forwarded from DockApp drop handler */
    upscalerDroppedFiles?: File[];
    upscalerDropGen?: number;
    /** Metadata tool: files forwarded from DockApp drop handler */
    metadataDroppedFiles?: File[];
    metadataDropGen?: number;
    /** Watermark tool: files forwarded from DockApp drop handler */
    watermarkDroppedFiles?: File[];
    watermarkDropGen?: number;
    /** Palette tool: files forwarded from DockApp drop handler */
    paletteDroppedFiles?: File[];
    paletteDropGen?: number;
    /** Clear signal — incremented when user confirms "clear all data" */
    clearGen?: number;
    /** Remover tool: processing options */
    removerOptions?: import('../services/api').RemoverOptions;
    onRemoverModeChange?: (mode: import('../services/api').RemoverMode) => void;
    onCancelProcessing?: () => void;
    emptyHint?: string;
    emptySubHint?: string;
    formatLines?: string[];
}

// Extract a still frame from a video URL as a data-URL thumbnail
const VIDEO_EXTS = /\.(mp4|webm|mov|avi|mkv|ogv)$/i;

function useVideoThumbnail(src: string | undefined, name: string) {
    const [thumb, setThumb] = useState<string | null>(null);
    const attempted = useRef(false);
    const isVideo = VIDEO_EXTS.test(name);

    useEffect(() => {
        if (!isVideo || !src || attempted.current) return;
        attempted.current = true;
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.muted = true;
        video.preload = 'metadata';
        video.src = src;
        video.currentTime = 1; // seek to 1s for a meaningful frame
        video.addEventListener('seeked', () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                canvas.getContext('2d')!.drawImage(video, 0, 0);
                setThumb(canvas.toDataURL('image/jpeg', 0.8));
            } catch { /* CORS or other error — fall back */ }
            video.src = '';
        }, { once: true });
        video.addEventListener('error', () => { /* no thumbnail */ }, { once: true });
    }, [isVideo, src]);

    return { isVideo, thumb };
}

// Small helper rendered inside each shelf grid cell
const GridItemPreview: React.FC<{
    item: SessionItem;
    colorClass: string;
}> = ({ item }) => {
    const [imgError, setImgError] = useState(false);
    const [thumbUrl, setThumbUrl] = useState<string | null>(null);
    const src = item.status === 'completed' ? (item.processedUrl || item.originalUrl) : item.originalUrl;
    const name = item.file.name;
    const opacity = item.status === 'processing' ? 'opacity-50' : 'opacity-100';
    const { isVideo, thumb } = useVideoThumbnail(src, name);
    const displaySrc = isVideo ? (thumb || null) : src;

    // When the primary <img> fails, try generating a backend thumbnail
    useEffect(() => {
        if (!imgError || thumbUrl) return;
        if (item.file.size === 0) return; // loaded items have empty File — can't thumbnail
        let cancelled = false;
        getFileThumbnail(item.file, 128).then(result => {
            if (!cancelled && result) setThumbUrl(result.url);
        }).catch(() => {});
        return () => { cancelled = true; };
    }, [imgError]); // eslint-disable-line react-hooks/exhaustive-deps

    const finalSrc = imgError ? thumbUrl : displaySrc;
    const showImage = finalSrc != null;

    return (
        <>
            {showImage ? (
                <img
                    src={finalSrc}
                    className={`w-full h-full object-contain select-none ${opacity}`}
                    alt={name}
                    draggable={false}
                    onError={() => { if (!imgError) setImgError(true); }}
                />
            ) : (
                <div className={`flex flex-col items-center justify-center gap-1 w-full h-full ${opacity} pointer-events-none select-none`}>
                    <FileIcon className="w-8 h-8 text-slate-400" />
                    <span className="text-[10px] text-slate-400 text-center break-all line-clamp-2 px-1 leading-tight">{name}</span>
                </div>
            )}
            {/* File name label at bottom */}
            {showImage && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1 py-0.5 pointer-events-none">
                    <p className="text-[9px] text-slate-300 truncate text-center leading-tight">{name}</p>
                </div>
            )}
        </>
    );
};

export const ToolWidget: React.FC<ToolWidgetProps> = ({
    id,
    title,
    description,
    icon: Icon,
    colorClass,
    isDockVisible,
    isExpanded,
    activeSession,
    onDrop,
    onInternalDrop,
    onDelete,
    onClose,
    onExpand,
    onSelectItem,
    isToolDragging,
    isReordering = false,
    onUpdateItem,
    onOpenSettings,
    externalDragHover = false,
    externalDragHandled = false,
    otherToolCount: _otherToolCount = 0,
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
    clearGen,
    removerOptions,
    onRemoverModeChange,
    onCancelProcessing,
    emptyHint,
    emptySubHint,
    formatLines,
}) => {
    const [isDragHover, setIsDragHover] = useState(false);
    const [cancelHover, setCancelHover] = useState(false);
    const [showOriginal, setShowOriginal] = useState(false);
    const [, forceUpdate] = useState(0);
    const [selfItemCount, setSelfItemCount] = useState(0); // count from self-contained tools (always mounted)

    // Keep dimensions fresh when the Electron window is resized
    useEffect(() => {
        const onResize = () => forceUpdate(n => n + 1);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);
    const [isTrimming, setIsTrimming] = useState(false); // Add loading state for trim
    const [isZipping, setIsZipping] = useState(false);
    const [isCopying, setIsCopying] = useState(false);
    const [showCopySuccess, setShowCopySuccess] = useState(false);
    const [isPasting, setIsPasting] = useState(false);
    const [showPasteSuccess, setShowPasteSuccess] = useState(false);
    const [isCropping, setIsCropping] = useState(false); // Cropper specific state
    const [isVectorizing, setIsVectorizing] = useState(false); // Vectorizer specific state
    const [vectorSvgString, setVectorSvgString] = useState<string | null>(null);
    const [isCompressing, setIsCompressing] = useState(false); // Compressor specific state
    const [isBrushing, setIsBrushing] = useState(false); // Magic brush overlay for remover

    const isActive = isExpanded;
    const items = activeSession?.items || [];
    const itemCount = items.length;
    const isMultiple = items.length > 1;

    // Single Item Shortcuts
    const singleItem = items.length === 1 ? items[0] : null;
    const isSingleCompleted = singleItem?.status === 'completed';
    const isSingleProcessing = singleItem?.status === 'processing';

    // Focused item: single item OR the one selected item in multi mode
    const selectedIds = activeSession?.selectedItemIds || [];
    const focusedItem = singleItem || (selectedIds.length === 1 ? items.find(i => i.id === selectedIds[0]) : null) || null;
    const isFocusedCompleted = focusedItem?.status === 'completed';

    // Footer main-button state
    const anyProcessing = items.some(i => i.status === 'processing' || i.status === 'pending');
    const hasCompleted = items.some(i => i.status === 'completed');
    const hasOverlay = id === 'cropper' || id === 'vectorizer' || id === 'compressor';
    const showSplit = isSingleCompleted && !isMultiple && hasOverlay;

    // Auto-enter crop mode if it's the cropper tool and we haven't processed yet (or just force it initially)
    // Actually, "status=completed" happens instantly for cropper (mock service).
    // So if processedUrl === originalUrl (which the mock does), we can consider it "un-cropped" or just default to true.
    useEffect(() => {
        if (isActive && id === 'cropper' && isSingleCompleted && !isCropping) {
            // Only auto-open if we haven't "saved" yet? 
            // Hard to track "saved" state without extra metadata.
            // But for UX, let's just default to open if tool is just opened? No.
            // Let's rely on user clicking "Crop" if they want to re-crop, but for FIRST drop, we should open it.
            // We can check if processedUrl is significantly different or same as original? 
            // With the mock service, they are identical.
            // Let's just default isCropping to true when `singleItem` appears?
            // We can use a ref to track if we've auto-opened for this item?
        }
    }, [isActive, id, isSingleCompleted]);

    // Better: Helper to force open crop logic on drop?
    // Let's just add a button for now, or default `isCropping` to true when `activeSession` changes?
    useEffect(() => {
        if (id === 'cropper' && activeSession?.items.length === 1) {
            setIsCropping(true);
        } else {
            setIsCropping(false);
        }
        if (id === 'vectorizer' && activeSession?.items.length === 1) {
            setIsVectorizing(true);
            setVectorSvgString(null);
        } else {
            setIsVectorizing(false);
        }
        if (id === 'compressor' && activeSession?.items.length === 1) {
            setIsCompressing(true);
        } else {
            setIsCompressing(false);
        }
    }, [activeSession?.id, id]); // Reset when session changes

    // Selection logic
    const selectionCount = selectedIds.length;
    const hasSelection = selectionCount > 0;

    // Reset showOriginal state when session changes
    useEffect(() => {
        if (!activeSession) setShowOriginal(false);
    }, [activeSession]);

    useEffect(() => {
        if (showCopySuccess) {
            const timer = setTimeout(() => setShowCopySuccess(false), 2000);
            return () => clearTimeout(timer);
        }
    }, [showCopySuccess]);

    // Global paste event listener (Ctrl+V / Cmd+V) when this tool is expanded
    useEffect(() => {
        if (!isExpanded) return;
        const handler = (e: ClipboardEvent) => {
            // Files from Explorer/Finder
            if (e.clipboardData?.files?.length) {
                e.preventDefault();
                onDrop(Array.from(e.clipboardData.files), id);
                return;
            }
            // Image data copied from browser
            const clipItems = Array.from(e.clipboardData?.items || []);
            const imageItem = clipItems.find(item => item.type.startsWith('image/'));
            if (imageItem) {
                e.preventDefault();
                const file = imageItem.getAsFile();
                if (file) onDrop([file], id);
            }
        };
        window.addEventListener('paste', handler);
        return () => window.removeEventListener('paste', handler);
    }, [isExpanded, id, onDrop]);

    // --- DIMENSION LOGIC MOVED TO JS VARIABLES ---
    let targetWidth = 80;
    let targetHeight = 80;
    let targetOpacity = 0;
    let targetX = 100; // Translate X
    let pointerEvents = 'none';
    let cursor = 'default';

    if (isActive) {
        const availableWidth = window.innerWidth - 20;
        // All expanded tools: fixed width, 4:5 aspect ratio (width:height)
        targetWidth = Math.min(420, availableWidth);
        targetHeight = Math.round(targetWidth * 5 / 4);
        targetOpacity = 1;
        targetX = 0;
        pointerEvents = 'auto';
    } else if (isDragHover || externalDragHover) {
        // Expand on drag hover. When externalDragHandled=true the parent wrapper
        // covers both the tool box AND the pill, so expanding is safe (cursor stays
        // within the wrapper even after the tool grows in size).
        targetWidth = 300;
        targetHeight = 220;
        targetOpacity = 1;
        targetX = 0;
        pointerEvents = 'auto';
    } else if (isDockVisible) {
        targetWidth = 80;
        targetHeight = 80;
        targetOpacity = 1;
        targetX = 0;
        pointerEvents = 'auto';
        cursor = 'pointer';
    }

    // Dynamic colors
    const bgGradient = isActive || isDragHover || externalDragHover
        ? `bg-slate-900 border-${colorClass}-500/30`
        : `bg-slate-800 border-white/10`;

    const handleDragEnter = (e: DragEvent) => {
        if (externalDragHandled) return; // parent wrapper handles this
        e.preventDefault();
        if (isReordering) return;
        if (e.dataTransfer.types.includes('application/x-smart-tool-reorder')) return;
        if (isDockVisible && !isActive && !isToolDragging) setIsDragHover(true);
    };

    const handleDragLeave = (e: DragEvent) => {
        if (externalDragHandled) return; // parent wrapper handles this
        e.preventDefault();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        if (
            e.clientX < rect.left ||
            e.clientX >= rect.right ||
            e.clientY < rect.top ||
            e.clientY >= rect.bottom
        ) {
            setIsDragHover(false);
        }
    };

    const handleDrop = (e: DragEvent) => {
        if (externalDragHandled) {
            // Parent wrapper already processes the drop — just clear local state
            setIsDragHover(false);
            return;
        }

        e.stopPropagation();
        setIsDragHover(false);

        if (e.dataTransfer.types.includes('application/x-smart-tool-reorder')) return;

        // Check shared drag state first (survives startDrag overriding dataTransfer)
        const ds = dragState.get();
        if (ds && ds.sourceToolId !== id) {
            dragState.clear();
            onInternalDrop(ds.sourceToolId, id, ds.itemIds);
            return;
        }
        dragState.clear();

        const internalData = e.dataTransfer.getData('application/app-internal-transfer');
        if (internalData) {
            try {
                const { sourceToolId, itemIds } = JSON.parse(internalData);
                if (sourceToolId && itemIds && itemIds.length > 0) {
                    onInternalDrop(sourceToolId, id, itemIds);
                    return;
                }
            } catch (err) {
                console.error("Failed to parse internal drop data");
            }
        }

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const files: File[] = [];
            for (let i = 0; i < e.dataTransfer.files.length; i++) {
                files.push(e.dataTransfer.files[i]);
            }
            onDrop(files, id);
        }
    };

    const handleItemDragStart = (e: DragEvent, itemId: string) => {
        e.stopPropagation();

        // Replace the browser's default ghost (a large card snapshot) with a transparent 1×1 canvas.
        // This prevents the ghost from getting stuck on screen when the OS native drag takes over.
        const ghostCanvas = document.createElement('canvas');
        ghostCanvas.width = 1;
        ghostCanvas.height = 1;
        e.dataTransfer.setDragImage(ghostCanvas, 0, 0);

        let idsToDrag = [itemId];
        if (selectedIds.includes(itemId) && selectedIds.length > 1) idsToDrag = selectedIds;

        // Build export payload for potential OS drag-out
        const exportItems = items
            .filter(i => idsToDrag.includes(i.id))
            .map(i => {
                if (id === 'shelf') return { id: i.id, name: i.file.name, dataUrl: null as string | null, filePath: null as string | null };
                const url = (i.status === 'completed' ? i.processedUrl : null) || i.originalUrl;
                return {
                    id: i.id,
                    name: i.file.name,
                    dataUrl: url?.startsWith('data:') ? url : null,
                    filePath: (i.file as any).path ?? null,
                };
            });

        // Listener: when drag leaves the Electron window, initiate native OS file drag
        // We do NOT call startNativeDrag here — doing so blocks the renderer and prevents
        // browser drop events from firing, breaking tool-to-tool transfers.
        const onLeaveWindow = (ev: Event) => {
            const de = ev as globalThis.DragEvent;
            if (de.relatedTarget === null) {
                dragState.clear(); // also removes this listener via cleanupFn
                window.electron?.startNativeDrag?.({ items: exportItems });
            }
        };
        document.documentElement.addEventListener('dragleave', onLeaveWindow);

        // Store shared state: used by handleWrapperDrop in SideDock for in-app transfers
        dragState.set(
            { sourceToolId: id, itemIds: idsToDrag, exportItems },
            () => document.documentElement.removeEventListener('dragleave', onLeaveWindow)
        );

        // dataTransfer fallback (works when startDrag is not in effect)
        e.dataTransfer.setData('application/app-internal-transfer', JSON.stringify({
            sourceToolId: id,
            itemIds: idsToDrag
        }));
    };

    const handleItemClick = (e: MouseEvent, itemId: string) => {
        e.stopPropagation();
        const isMulti = e.ctrlKey || e.metaKey;
        const isRange = e.shiftKey;
        onSelectItem(itemId, isMulti, isRange);
    }

    const handleCopy = async () => {
        if (isCopying) return;
        setIsCopying(true);

        const candidates = hasSelection
            ? items.filter(i => selectedIds.includes(i.id))
            : items;

        if (candidates.length === 0) {
            setIsCopying(false);
            return;
        }

        // Store ALL candidates in in-app clipboard for tool-to-tool paste
        clipboardState.set({ sourceToolId: id, itemIds: candidates.map(i => i.id) });

        // Write ALL items to system clipboard as CF_HDROP (like Windows Explorer)
        // This lets Figma, Explorer, and every other Windows app paste all files at once
        try {
            const clipItems = await Promise.all(candidates.map(async (item) => {
                const url = (item.status === 'completed' && item.processedUrl)
                    ? item.processedUrl
                    : item.originalUrl;
                const response = await fetch(url);
                const blob = await response.blob();
                const dataUrl = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
                return { dataUrl, name: item.file.name };
            }));

            if (window.electron?.clipboardWrite) {
                await window.electron.clipboardWrite(clipItems);
            } else {
                // Web clipboard API fallback — single image only (browser/non-Electron)
                const first = clipItems[0];
                const res = await fetch(first.dataUrl);
                const blob = await res.blob();
                if (blob.type.startsWith('image/')) {
                    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
                }
            }
            setShowCopySuccess(true);
        } catch (err) {
            console.error('Failed to copy to system clipboard', err);
            setShowCopySuccess(true);
        } finally {
            setIsCopying(false);
        }
    };

    const handlePaste = async () => {
        if (isPasting) return;

        // 1. In-app clipboard — tool-to-tool paste (uses processed output)
        const cb = clipboardState.get();
        if (cb && cb.sourceToolId !== id) {
            clipboardState.clear();
            onInternalDrop(cb.sourceToolId, id, cb.itemIds);
            setShowPasteSuccess(true);
            setTimeout(() => setShowPasteSuccess(false), 2000);
            return;
        }
        clipboardState.clear();

        // 2. System clipboard — image or files from Windows/Mac app or browser
        setIsPasting(true);
        try {
            if (window.electron?.clipboardRead) {
                // Electron: reads image data OR CF_HDROP files (Explorer copies)
                const clipItems = await window.electron.clipboardRead();
                if (clipItems.length > 0) {
                    const files = await Promise.all(clipItems.map(async ({ dataUrl, name }) => {
                        const res = await fetch(dataUrl);
                        const blob = await res.blob();
                        return new File([blob], name, { type: blob.type || 'application/octet-stream' });
                    }));
                    onDrop(files, id);
                    setShowPasteSuccess(true);
                    setTimeout(() => setShowPasteSuccess(false), 2000);
                    return;
                }
            } else {
                // Web clipboard API fallback (non-Electron / browser)
                const clipItems = await navigator.clipboard.read();
                for (const clipItem of clipItems) {
                    const imageType = clipItem.types.find(t => t.startsWith('image/'));
                    if (imageType) {
                        const blob = await clipItem.getType(imageType);
                        const ext = imageType.split('/')[1] || 'png';
                        const file = new File([blob], `pasted.${ext}`, { type: imageType });
                        onDrop([file], id);
                        setShowPasteSuccess(true);
                        setTimeout(() => setShowPasteSuccess(false), 2000);
                        return;
                    }
                }
            }
        } catch (err) {
            console.warn('Clipboard read failed:', err);
        } finally {
            setIsPasting(false);
        }
    };

    // Map tool IDs to descriptive filename suffixes
    const toolSuffixMap: Record<string, string> = {
        remover: 'BGremoved',
        compressor: 'compressed',
        shelf: 'shelved',
        cropper: 'cropped',
        upscaler: 'upscaled',
        colorizer: 'colorized',
        pdf: 'pdf',
        metadata: 'scrubbed',
        watermark: 'watermarked',
        converter: 'converted',
        vectorizer: 'vectorized',
        ocr: 'OCR',
        palette: 'palette',
    };

    const getOutputFileName = (originalName: string, toolId: string): string => {
        const suffix = toolSuffixMap[toolId] || 'processed';
        const lastDot = originalName.lastIndexOf('.');
        if (lastDot === -1) return `${originalName}-${suffix}`;
        const baseName = originalName.substring(0, lastDot);
        // For vectorizer, always output .svg extension
        if (toolId === 'vectorizer') return `${baseName}-${suffix}.svg`;
        const ext = originalName.substring(lastDot);
        return `${baseName}-${suffix}${ext}`;
    };

    const handleDownload = async () => {
        if (isZipping) return;

        const itemsToDownload = hasSelection
            ? items.filter(i => selectedIds.includes(i.id))
            : items;

        if (itemsToDownload.length === 0) return;

        // SINGLE FILE DOWNLOAD
        if (itemsToDownload.length === 1) {
            const item = itemsToDownload[0];
            if (item.processedUrl) {
                // For vectorizer with SVG string, download the raw SVG
                if (id === 'vectorizer' && vectorSvgString) {
                    const svgBlob = new Blob([vectorSvgString], { type: 'image/svg+xml' });
                    const svgUrl = URL.createObjectURL(svgBlob);
                    const link = document.createElement('a');
                    link.href = svgUrl;
                    link.download = getOutputFileName(item.file.name, id);
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(svgUrl), 1000);
                } else {
                    const link = document.createElement('a');
                    link.href = item.processedUrl;
                    link.download = getOutputFileName(item.file.name, id);
                    link.click();
                }
            }
            return;
        }

        // MULTIPLE FILES DOWNLOAD (ZIP)
        try {
            setIsZipping(true);
            const zip = new JSZip();
            const suffix = toolSuffixMap[id] || 'processed';
            const folderName = `${suffix}-${Date.now()}`;

            // Process files in parallel
            await Promise.all(itemsToDownload.map(async (item) => {
                if (item.processedUrl) {
                    // Fetch the blob content
                    const response = await fetch(item.processedUrl);
                    const blob = await response.blob();

                    // Create a descriptive filename
                    const fileName = getOutputFileName(item.file.name, id);

                    // Add to zip
                    zip.file(fileName, blob);
                }
            }));

            // Generate zip file
            const content = await zip.generateAsync({ type: "blob" });

            // Trigger download
            const link = document.createElement('a');
            link.href = URL.createObjectURL(content);
            link.download = `${folderName}.zip`;
            link.click();

            // Cleanup
            setTimeout(() => URL.revokeObjectURL(link.href), 1000);

        } catch (error) {
            console.error("Failed to zip files", error);
            alert("حدث خطأ أثناء ضغط الملفات");
        } finally {
            setIsZipping(false);
        }
    };

    const currentImageSrc = (singleItem && (isSingleCompleted && !showOriginal
        ? singleItem.processedUrl
        : singleItem.originalUrl)) || undefined;

    const handleContainerClick = () => {
        if (isDockVisible && !isActive) {
            onExpand();
        }
    }

    return (
        <motion.div
            initial={false}
            animate={{
                width: targetWidth,
                height: targetHeight,
                opacity: targetOpacity,
                x: targetX,
            }}
            transition={{
                type: "spring",
                stiffness: 400,
                damping: 30,
            }}
            style={{
                pointerEvents: pointerEvents as any,
                cursor
            }}
            data-interactive
            className={`relative flex flex-col items-center justify-center 
        backdrop-blur-xl border rounded-2xl shadow-2xl transition-colors duration-300
        overflow-hidden
        ${bgGradient}
      `}
            onDragEnter={handleDragEnter}
            onDragOver={(e) => {
                e.preventDefault();
                if (!isReordering) e.dataTransfer.dropEffect = 'copy';
            }}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleContainerClick}
        >
            {/* --- STATE: IDLE / MINI (Dock Icon) --- */}
            {!isActive && !isDragHover && !externalDragHover && (
                <div className="relative flex items-center justify-center w-full h-full text-slate-400">
                    <Icon className={`w-8 h-8 text-${colorClass}-400`} />
                    {(itemCount || selfItemCount) > 0 && (
                        <div className="absolute top-4 right-4 translate-x-1/2 -translate-y-1/2 bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border border-slate-900 shadow-sm animate-in zoom-in">
                            {itemCount || selfItemCount}
                        </div>
                    )}
                </div>
            )}

            {/* --- STATE: DRAG HOVER (Expanded, file dragged over tool or pill) --- */}
            {!isActive && (isDragHover || externalDragHover) && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center pointer-events-none"
                >
                    <div className={`p-3 rounded-full bg-${colorClass}-500/20 mb-3`}>
                        <Icon className={`w-8 h-8 text-${colorClass}-400`} />
                    </div>
                    <h3 className="text-white font-bold text-lg">{title}</h3>
                    <p className="text-xs text-slate-400 mt-1">{description}</p>

                    <div className={`mt-4 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider bg-${colorClass}-500/10 text-${colorClass}-300 border border-${colorClass}-500/20`}>
                        أفلت الملفات هنا
                    </div>
                </motion.div>
            )}

            {/* --- STATE: ACTIVE / EXPANDED --- */}
            {isActive && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.15, delay: 0.14 }}
                    className="absolute inset-0 flex flex-col p-4 w-full h-full cursor-default select-none"
                    onClick={(e) => e.stopPropagation()}
                >
                    {/* Crop overlay - takes over entire widget when active */}
                    {id === 'cropper' && isCropping && singleItem && (
                        <div className="absolute inset-0 z-50 rounded-2xl overflow-hidden">
                            <CropperTool
                                imageSrc={singleItem.processedUrl || singleItem.originalUrl}
                                onSave={(newUrl) => {
                                    if (onUpdateItem) onUpdateItem(singleItem.id, { processedUrl: newUrl });
                                    setIsCropping(false);
                                }}
                                onCancel={() => setIsCropping(false)}
                            />
                        </div>
                    )}

                    {/* Vectorizer overlay */}
                    {id === 'vectorizer' && isVectorizing && singleItem && (
                        <div className="absolute inset-0 z-50 rounded-2xl overflow-hidden">
                            <VectorizerTool
                                file={singleItem.file}
                                originalUrl={singleItem.originalUrl}
                                onSave={(svgDataUrl, svgStr) => {
                                    if (onUpdateItem) onUpdateItem(singleItem.id, { processedUrl: svgDataUrl });
                                    setVectorSvgString(svgStr);
                                    setIsVectorizing(false);
                                }}
                                onCancel={() => setIsVectorizing(false)}
                            />
                        </div>
                    )}

                    {/* Compressor overlay */}
                    {id === 'compressor' && isCompressing && singleItem?.status === 'completed' && singleItem.metadata && (
                        <div className="absolute inset-0 z-50 rounded-2xl overflow-hidden">
                            <CompressorTool
                                file={singleItem.file}
                                initialResult={{
                                    url: singleItem.processedUrl || singleItem.originalUrl,
                                    originalSize: singleItem.metadata.originalSize || '',
                                    newSize: singleItem.metadata.newSize || '',
                                    saved: singleItem.metadata.savedPercentage || '0%',
                                }}
                                onSave={(url, meta) => {
                                    if (onUpdateItem) onUpdateItem(singleItem.id, {
                                        processedUrl: url,
                                        metadata: meta,
                                    });
                                    setIsCompressing(false);
                                }}
                                onCancel={() => setIsCompressing(false)}
                            />
                        </div>
                    )}

                    {/* Magic Brush overlay — remover-specific */}
                    {id === 'remover' && isBrushing && focusedItem?.status === 'completed' && focusedItem.processedUrl && (
                        <div className="absolute inset-0 z-50 rounded-2xl overflow-hidden">
                            <MagicBrushTool
                                originalImageSrc={focusedItem.originalUrl}
                                processedImageSrc={focusedItem.processedUrl}
                                onSave={(newUrl) => {
                                    if (onUpdateItem) onUpdateItem(focusedItem.id, { processedUrl: newUrl });
                                    setIsBrushing(false);
                                }}
                                onCancel={() => setIsBrushing(false)}
                            />
                        </div>
                    )}

                    {/* OCR overlay — manages its own file-drop, no image preview */}
                    {id === 'ocr' && (
                        <div className="absolute inset-0 z-50 rounded-2xl overflow-hidden">
                            <OcrTool onClose={onClose} />
                        </div>
                    )}

                    {/* Hide ToolWidget content when an overlay tool covers it */}
                    {!(['ocr', 'pdf', 'converter', 'upscaler', 'metadata', 'watermark'].includes(id)
                        || (id === 'cropper' && isCropping)
                        || (id === 'vectorizer' && isVectorizing)
                        || (id === 'compressor' && isCompressing)
                        || (id === 'remover' && isBrushing)) && (<>
                    <div className="flex items-center pb-3 border-b border-white/5 mb-3 shrink-0">
                        {/* Left: Title + count */}
                        <div className="flex items-center gap-2">
                            <Icon className={`w-4 h-4 text-${colorClass}-400`} />
                            <span className="text-sm font-bold text-white">{title}</span>
                            {isMultiple && <span className="text-xs bg-slate-700 px-2 py-0.5 rounded-full text-slate-300">{itemCount}</span>}
                        </div>

                        <div className="flex-1" />

                        {/* Right: Settings + close */}
                        <div className="flex items-center gap-0.5">
                            {onOpenSettings && (
                                <button onClick={onOpenSettings} className="text-slate-500 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/5" title="الإعدادات">
                                    <Settings className="w-4 h-4" />
                                </button>
                            )}
                            <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Remover mode toggle */}
                    {id === 'remover' && items.length > 0 && onRemoverModeChange && (
                        <div className="flex justify-center shrink-0 mb-2">
                            <div className="inline-flex rounded-lg bg-slate-800/80 border border-white/5 p-0.5">
                                {([
                                    { mode: 'speed' as const, label: 'سرعة', Icon: Zap },
                                    { mode: 'precision' as const, label: 'دقة', Icon: Crosshair },
                                ] as const).map(({ mode, label, Icon }) => {
                                    const active = (removerOptions?.mode || 'speed') === mode;
                                    return (
                                        <button
                                            key={mode}
                                            onClick={() => onRemoverModeChange(mode)}
                                            className={`flex items-center justify-center gap-1.5 w-20 py-1 rounded-md text-xs font-bold transition-all ${
                                                active
                                                    ? 'bg-indigo-600 text-white shadow-sm'
                                                    : 'text-slate-400 hover:text-white'
                                            }`}
                                        >
                                            <Icon className="w-3.5 h-3.5" />
                                            {label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {/* Content Body */}
                    <div className="flex-1 relative rounded-xl overflow-hidden bg-black/20 mb-3 min-h-0 border border-white/5"
                        onClick={(e) => { if (e.target === e.currentTarget && isMultiple) { /* Deselect logic optional */ } }}>

                        {!items.length ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-slate-700 bg-slate-800/30">
                                <div className="p-4 rounded-2xl bg-slate-800">
                                    <Icon className="w-8 h-8 text-slate-500" />
                                </div>
                                <div className="text-center px-4">
                                    <p className="text-sm font-semibold text-slate-300">
                                        {emptyHint || 'اسحب ملفات هنا'}
                                    </p>
                                    {emptySubHint && (
                                        <p className="text-xs text-slate-500 mt-1">{emptySubHint}</p>
                                    )}
                                    {formatLines && formatLines.length > 0 && (
                                        <div className="mt-2">
                                            {formatLines.map((line, i) => (
                                                <p key={i} className="text-[10px] text-slate-600">{line}</p>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ) : (
                            <>
                                {/* === SINGLE VIEW === */}
                                {!isMultiple && singleItem && (
                                    <>
                                        {id === 'shelf' ? (
                                            <div
                                                className="w-full h-full flex items-center justify-center cursor-grab active:cursor-grabbing"
                                                draggable={!isSingleProcessing}
                                                onDragStart={(e) => handleItemDragStart(e, singleItem.id)}
                                                onDragEnd={() => { dragState.clear(); }}
                                            >
                                                <GridItemPreview item={singleItem} colorClass={colorClass} />
                                            </div>
                                        ) : (
                                            <img
                                                src={currentImageSrc}
                                                className="w-full h-full object-contain cursor-grab active:cursor-grabbing"
                                                alt="preview"
                                                draggable={!isSingleProcessing}
                                                onDragStart={(e) => handleItemDragStart(e, singleItem.id)}
                                                onDragEnd={() => { dragState.clear(); }}
                                            />
                                        )}

                                        {isSingleProcessing && (
                                            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center">
                                                <Loader2 className={`w-8 h-8 text-${colorClass}-400 animate-spin mb-2`} />
                                                <span className="text-xs text-slate-300">جاري المعالجة...</span>
                                            </div>
                                        )}

                                        {isSingleCompleted && singleItem.metadata && (
                                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-3 pt-6 pointer-events-none">
                                                <div className="flex justify-between text-xs text-slate-300">
                                                    <span>{singleItem.metadata.newSize || 'Done'}</span>
                                                    {singleItem.metadata.savedPercentage && <span className="text-green-400">{singleItem.metadata.savedPercentage} saved</span>}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                )}

                                {/* === MULTIPLE VIEW (GRID) === */}
                                {isMultiple && (
                                    <div className="h-full overflow-y-auto p-2">
                                        <div className="grid grid-cols-2 gap-2">
                                            {items.map((item) => {
                                                const isSelected = selectedIds.includes(item.id);
                                                return (
                                                    <div
                                                        key={item.id}
                                                        onClick={(e) => handleItemClick(e, item.id)}
                                                        draggable={item.status !== 'processing'}
                                                        onDragStart={item.status !== 'processing' ? (e) => handleItemDragStart(e, item.id) : undefined}
                                                        onDragEnd={() => { dragState.clear(); }}
                                                        className={`
                                                group relative aspect-square rounded-lg border overflow-hidden flex items-center justify-center p-2 transition-all duration-200
                                                ${item.status !== 'processing' ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}
                                                ${isSelected
                                                                ? `bg-${colorClass}-500/20 border-${colorClass}-500 ring-1 ring-${colorClass}-500`
                                                                : 'bg-slate-800/50 border-white/5 hover:bg-slate-700/50'
                                                            }
                                            `}
                                                    >
                                                        {id === 'shelf' ? (
                                                            <GridItemPreview
                                                                item={item}
                                                                colorClass={colorClass}
                                                            />
                                                        ) : (
                                                            <img
                                                                src={item.status === 'completed' ? (item.processedUrl || item.originalUrl) : item.originalUrl}
                                                                className={`w-full h-full object-contain select-none pointer-events-none ${item.status === 'processing' ? 'opacity-50' : 'opacity-100'}`}
                                                                alt="item"
                                                                draggable={false}
                                                            />
                                                        )}
                                                        {item.status === 'processing' && (
                                                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                                <Loader2 className={`w-6 h-6 text-${colorClass}-400 animate-spin`} />
                                                            </div>
                                                        )}
                                                        {isSelected && (
                                                            <div className={`absolute top-1 right-1 bg-${colorClass}-500 text-white rounded-full p-0.5 shadow-sm`}>
                                                                <CheckCircle2 className="w-3 h-3" />
                                                            </div>
                                                        )}
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </div>

                    {/* Actions Footer */}
                    <div className="flex flex-col gap-1.5 shrink-0 w-full px-1">
                        {/* Row 1: Extra tool-specific buttons (only when present) */}
                        {id === 'remover' && (
                            <>
                            <div className="flex items-center gap-1.5 w-full">
                                <button
                                    onClick={() => setShowOriginal(!showOriginal)}
                                    disabled={!isFocusedCompleted || isMultiple}
                                    className={`flex-1 flex items-center justify-center h-10 rounded-xl transition-colors ${
                                        !isFocusedCompleted || isMultiple ? 'bg-slate-800/50 text-slate-600 cursor-not-allowed' :
                                            showOriginal ? 'bg-indigo-900/30 text-indigo-300 hover:bg-indigo-900/40' :
                                                'bg-white/[0.04] hover:bg-white/[0.1] text-slate-400 hover:text-white'
                                    }`}
                                    title={showOriginal ? "عرض النتيجة" : "عرض الأصل"}
                                >
                                    {showOriginal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                                <button
                                    onClick={() => setIsBrushing(true)}
                                    disabled={!isFocusedCompleted}
                                    className={`flex-1 flex items-center justify-center h-10 rounded-xl transition-colors ${
                                        !isFocusedCompleted
                                            ? 'bg-slate-800/50 text-slate-600 cursor-not-allowed'
                                            : 'bg-white/[0.04] hover:bg-white/[0.1] text-slate-400 hover:text-white'
                                    }`}
                                    title="فرشاة التعديل"
                                >
                                    <Paintbrush className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={async () => {
                                        if (!onUpdateItem) return;
                                        setIsTrimming(true);
                                        try {
                                            const { trimTransparency } = await import('../services/api');
                                            const itemsToTrim = focusedItem?.status === 'completed'
                                                ? [focusedItem]
                                                : items.filter(i => i.status === 'completed');
                                            await Promise.all(itemsToTrim.map(async (item) => {
                                                if (!item.processedUrl) return;
                                                const trimmed = await trimTransparency(item.processedUrl);
                                                onUpdateItem(item.id, { processedUrl: trimmed });
                                            }));
                                        } catch (err) {
                                            console.error('Failed to trim:', err);
                                        } finally {
                                            setIsTrimming(false);
                                        }
                                    }}
                                    disabled={!hasCompleted || showOriginal || isTrimming}
                                    className={`flex-1 flex items-center justify-center h-10 rounded-xl transition-colors ${
                                        !hasCompleted || showOriginal
                                            ? 'bg-slate-800/50 text-slate-600 cursor-not-allowed'
                                            : 'bg-white/[0.04] hover:bg-white/[0.1] text-slate-400 hover:text-white'
                                    }`}
                                    title="قص الفراغ"
                                >
                                    {isTrimming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
                                </button>
                            </div>
                            </>
                        )}
                        {showSplit && (
                            <div className="flex items-center gap-1.5 w-full">
                                {id === 'cropper' && (
                                    <button
                                        onClick={() => setIsCropping(true)}
                                        className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all bg-orange-600 hover:bg-orange-500 text-white"
                                    >
                                        <CropIcon className="w-4 h-4" />
                                        قص
                                    </button>
                                )}
                                {id === 'vectorizer' && (
                                    <button
                                        onClick={() => { setIsVectorizing(true); setVectorSvgString(null); }}
                                        className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all bg-rose-600 hover:bg-rose-500 text-white"
                                    >
                                        <PenTool className="w-4 h-4" />
                                        Vector
                                    </button>
                                )}
                                {id === 'compressor' && (
                                    <button
                                        onClick={() => setIsCompressing(true)}
                                        className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all bg-emerald-600 hover:bg-emerald-500 text-white"
                                    >
                                        <Minimize2 className="w-4 h-4" />
                                        ضغط
                                    </button>
                                )}
                            </div>
                        )}

                        {/* Row 2: [Main button] | [Copy][Paste][Delete] */}
                        <div className="flex items-center gap-1.5 w-full">
                            {/* Left half: Main action / download */}
                            {anyProcessing ? (
                                <button
                                    onMouseEnter={() => setCancelHover(true)}
                                    onMouseLeave={() => setCancelHover(false)}
                                    onClick={cancelHover && onCancelProcessing ? onCancelProcessing : undefined}
                                    className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all ${
                                        cancelHover && onCancelProcessing
                                            ? 'bg-red-600 hover:bg-red-500 text-white cursor-pointer'
                                            : `bg-${colorClass}-600/50 text-white/60`
                                    }`}
                                >
                                    {cancelHover && onCancelProcessing
                                        ? <><Ban className="w-4 h-4" />إلغاء</>
                                        : <><Loader2 className="w-4 h-4 animate-spin" />جاري المعالجة...</>
                                    }
                                </button>
                            ) : hasCompleted ? (
                                <button
                                    onClick={handleDownload}
                                    disabled={isZipping}
                                    className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
                                    title={hasSelection ? `تحميل المحدد (${selectionCount})` : 'تحميل'}
                                >
                                    {isZipping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                    تحميل
                                </button>
                            ) : (
                                <button
                                    disabled
                                    className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold bg-slate-800/50 text-slate-600 cursor-not-allowed"
                                >
                                    <Icon className="w-4 h-4" />
                                    {title}
                                </button>
                            )}

                            {/* Right half: Copy | Paste | Delete */}
                            <div className="flex-1 flex items-center gap-1.5">
                                <button
                                    onClick={handleCopy}
                                    disabled={isCopying || items.length === 0}
                                    className="flex-1 flex items-center justify-center h-10 rounded-xl transition-colors bg-white/[0.04] hover:bg-white/[0.1] text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                                    title="نسخ"
                                >
                                    {isCopying ? <Loader2 className="w-4 h-4 animate-spin" /> :
                                        showCopySuccess ? <Check className="w-4 h-4 text-green-400" /> :
                                            <Copy className="w-4 h-4" />}
                                </button>
                                <button
                                    onClick={handlePaste}
                                    disabled={isPasting}
                                    className="flex-1 flex items-center justify-center h-10 rounded-xl transition-colors bg-white/[0.04] hover:bg-white/[0.1] text-slate-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                                    title="لصق (Ctrl+V)"
                                >
                                    {isPasting ? <Loader2 className="w-4 h-4 animate-spin" /> :
                                        showPasteSuccess ? <Check className="w-4 h-4 text-green-400" /> :
                                            <ClipboardPaste className="w-4 h-4" />}
                                </button>
                                <button
                                    onClick={onDelete}
                                    disabled={items.length === 0}
                                    className={`flex-1 flex items-center justify-center h-10 rounded-xl transition-colors ${
                                        items.length === 0
                                            ? 'bg-slate-800/50 text-slate-600 cursor-not-allowed'
                                            : 'bg-red-900/20 hover:bg-red-900/40 text-red-400 hover:text-red-300'
                                    }`}
                                    title={hasSelection ? `حذف المحدد (${selectionCount})` : 'مسح الكل'}
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>

                    </>)}
                </motion.div>
            )}

            {/* Self-contained tools — always mounted, fade in/out to match container expand animation */}
            {id === 'pdf' && (
                <motion.div
                    className="absolute inset-0 z-50 rounded-2xl overflow-hidden"
                    animate={{ opacity: isActive ? 1 : 0 }}
                    transition={{ duration: 0.15, delay: isActive ? 0.14 : 0 }}
                    style={{ pointerEvents: isActive ? 'auto' : 'none' }}
                >
                    <PdfTool
                        onClose={onClose}
                        droppedFiles={pdfDroppedFiles || []}
                        dropGeneration={pdfDropGen || 0}
                        onItemCountChange={setSelfItemCount}
                        clearGen={clearGen || 0}
                    />
                </motion.div>
            )}
            {id === 'converter' && (
                <motion.div
                    className="absolute inset-0 z-50 rounded-2xl overflow-hidden"
                    animate={{ opacity: isActive ? 1 : 0 }}
                    transition={{ duration: 0.15, delay: isActive ? 0.14 : 0 }}
                    style={{ pointerEvents: isActive ? 'auto' : 'none' }}
                >
                    <ConverterTool
                        onClose={onClose}
                        droppedFiles={converterDroppedFiles || []}
                        dropGeneration={converterDropGen || 0}
                        onItemCountChange={setSelfItemCount}
                        clearGen={clearGen || 0}
                    />
                </motion.div>
            )}
            {id === 'upscaler' && (
                <motion.div
                    className="absolute inset-0 z-50 rounded-2xl overflow-hidden"
                    animate={{ opacity: isActive ? 1 : 0 }}
                    transition={{ duration: 0.15, delay: isActive ? 0.14 : 0 }}
                    style={{ pointerEvents: isActive ? 'auto' : 'none' }}
                >
                    <UpscalerTool
                        onClose={onClose}
                        droppedFiles={upscalerDroppedFiles || []}
                        dropGeneration={upscalerDropGen || 0}
                        onItemCountChange={setSelfItemCount}
                        clearGen={clearGen || 0}
                    />
                </motion.div>
            )}
            {id === 'metadata' && (
                <motion.div
                    className="absolute inset-0 z-50 rounded-2xl overflow-hidden"
                    animate={{ opacity: isActive ? 1 : 0 }}
                    transition={{ duration: 0.15, delay: isActive ? 0.14 : 0 }}
                    style={{ pointerEvents: isActive ? 'auto' : 'none' }}
                >
                    <MetadataTool
                        onClose={onClose}
                        droppedFiles={metadataDroppedFiles || []}
                        dropGeneration={metadataDropGen || 0}
                        onItemCountChange={setSelfItemCount}
                        clearGen={clearGen || 0}
                    />
                </motion.div>
            )}
            {id === 'watermark' && (
                <motion.div
                    className="absolute inset-0 z-50 rounded-2xl overflow-hidden"
                    animate={{ opacity: isActive ? 1 : 0 }}
                    transition={{ duration: 0.15, delay: isActive ? 0.14 : 0 }}
                    style={{ pointerEvents: isActive ? 'auto' : 'none' }}
                >
                    <WatermarkTool
                        onClose={onClose}
                        droppedFiles={watermarkDroppedFiles || []}
                        dropGeneration={watermarkDropGen || 0}
                        onItemCountChange={setSelfItemCount}
                        clearGen={clearGen || 0}
                    />
                </motion.div>
            )}
            {id === 'palette' && (
                <motion.div
                    className="absolute inset-0 z-50 rounded-2xl overflow-hidden"
                    animate={{ opacity: isActive ? 1 : 0 }}
                    transition={{ duration: 0.15, delay: isActive ? 0.14 : 0 }}
                    style={{ pointerEvents: isActive ? 'auto' : 'none' }}
                >
                    <PaletteTool
                        onClose={onClose}
                        droppedFiles={paletteDroppedFiles || []}
                        dropGeneration={paletteDropGen || 0}
                        onItemCountChange={setSelfItemCount}
                        clearGen={clearGen || 0}
                    />
                </motion.div>
            )}
        </motion.div>
    );
};
