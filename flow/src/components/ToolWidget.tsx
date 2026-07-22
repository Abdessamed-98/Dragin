
import React, { DragEvent, useState, useEffect, useRef, MouseEvent } from 'react';
import { motion } from 'framer-motion';
import { LucideIcon, Download, Loader2, CheckCircle2, Eye, EyeOff, Scissors, Trash2, Copy, Check, Crop as CropIcon, File as FileIcon, ClipboardPaste, Brush, Ban } from 'lucide-react';
import { ActiveSession, ToolId, SessionItem } from '../types';
import { CropperTool } from './tools/CropperTool';
import { VectorizerTool } from './tools/VectorizerTool';
import { OcrTool } from './tools/OcrTool';
// CompressorTool overlay removed — quality slider is now inline
import { PdfTool } from './tools/PdfTool';
import { ConverterTool } from './tools/ConverterTool';
import { UpscalerTool } from './tools/UpscalerTool';
import { MetadataTool } from './tools/MetadataTool';
import { WatermarkTool } from './tools/WatermarkTool';
import { PaletteTool } from './tools/PaletteTool';
import { MagicBrushTool } from './tools/MagicBrushTool';
import { ResizeTool } from './tools/ResizeTool';
import { ZipTool } from './tools/ZipTool';
import { clipboardState } from '../state/clipboardState';
import { ToolHeader } from './ToolHeader';
import { getFileThumbnail } from '../services/api';
import { saveOutputs } from '../services/saveOutput';
import { useI18n } from '../i18n/I18nContext';

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
    /** Process carried (idle) items — wired to the action button. */
    onProcessIdle?: () => void;
    /** Count shown on the collapsed tile (session badge, computed by DockApp). */
    badgeCount?: number;
    /** Rail switch with the panel already open — show content instantly (no fade). */
    instantContent?: boolean;
    onOpenSettings?: () => void;
    externalDragHover?: boolean;
    /** When true, the parent SideDock wrapper handles all file drag events.
     *  ToolWidget's own dragEnter/Leave/Drop are skipped to avoid double-handling. */
    externalDragHandled?: boolean;
    /** Number of other (non-expanded) tools in the dock — used to reserve vertical space. */
    otherToolCount?: number;
    /** Clear signal — incremented when user confirms "clear all data" */
    clearGen?: number;
    /** Compressor tool: quality level (0-100) */
    compressorQuality?: number;
    /** Compressor tool: re-compress all items at new quality */
    onRecompress?: (quality: number) => void;
    /** Whether the remover (BEN2) model is currently being loaded into memory */
    isModelLoading?: boolean;
    onCancelProcessing?: () => void;
    emptyHint?: string;
    emptySubHint?: string;
    formatLines?: string[];
    /** Called when the self-contained tool's file count changes — lets DockApp keep the dock visible */
    onSelfItemCountChange?: (count: number) => void;
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
                    <FileIcon className="w-8 h-8 text-[var(--text-2)]" />
                    <span className="text-[10px] text-[var(--text-2)] text-center break-all line-clamp-2 px-1 leading-tight">{name}</span>
                </div>
            )}
            {/* File name label at bottom */}
            {showImage && (
                <div className="absolute bottom-0 left-0 right-0 bg-black/50 px-1 py-0.5 pointer-events-none">
                    <p className="text-[9px] text-[var(--text-2)] truncate text-center leading-tight">{name}</p>
                </div>
            )}
        </>
    );
};

export const ToolWidget: React.FC<ToolWidgetProps> = ({
    id,
    title,
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
    isReordering = false,
    onUpdateItem,
    onProcessIdle,
    badgeCount = 0,
    instantContent = false,
    onOpenSettings,
    externalDragHover = false,
    externalDragHandled = false,
    otherToolCount: _otherToolCount = 0,
    clearGen,
    isModelLoading,
    onCancelProcessing,
    emptyHint,
    emptySubHint,
    formatLines,
    onSelfItemCountChange,
}) => {
    const { t } = useI18n();
    const [cancelHover, setCancelHover] = useState(false);
    const [showOriginal, setShowOriginal] = useState(false);
    const [, forceUpdate] = useState(0);
    const [selfItemCount, setSelfItemCount] = useState(0); // count from self-contained tools (always mounted)

    // Propagate self-contained item count up to DockApp for dock visibility
    useEffect(() => { onSelfItemCountChange?.(selfItemCount); }, [selfItemCount, onSelfItemCountChange]);

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
    // isCompressing removed — compressor now uses inline quality slider
    const [isBrushing, setIsBrushing] = useState(false); // Magic brush overlay for remover

    const isActive = isExpanded;
    const items = activeSession?.items || [];
    const itemCount = items.length;
    const isMultiple = items.length > 1;
    // Idle primary-button label: an action verb per tool (falls back to the title).
    const _actionKeys: Record<string, string> = { compressor: 'widget.action.compressor', remover: 'widget.action.remover', cropper: 'widget.action.cropper', shelf: 'widget.action.shelf' };
    const idleActionLabel = _actionKeys[id] ? t(_actionKeys[id] as any) : title;

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
    // Carried items (rail switch) wait for a manual run via the action button.
    const hasIdle = items.some(i => i.status === 'idle');
    const hasOverlay = id === 'cropper';
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

    // ── SIZE OWNERSHIP ───────────────────────────────────────────────────────
    // The size of the dock is now owned by the single "tongue" panel in SideDock.
    // The widget simply fills the panel when active, or renders as a fixed rail
    // tile (80×80) when collapsed. A file dragged over a tile gives a highlight
    // ring — it no longer expands into a catch-frame.

    const handleDragEnter = (e: DragEvent) => {
        if (externalDragHandled) return; // parent wrapper handles this
        e.preventDefault();
    };

    const handleDragLeave = (e: DragEvent) => {
        if (externalDragHandled) return; // parent wrapper handles this
        e.preventDefault();
    };

    const handleDrop = (e: DragEvent) => {
        if (externalDragHandled) return; // parent wrapper handles drops
        e.stopPropagation();
        if (e.dataTransfer.types.includes('application/x-smart-tool-reorder')) return;
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            onDrop(Array.from(e.dataTransfer.files), id);
        }
    };

    const handleItemDragStart = (e: DragEvent, itemId: string) => {
        // Default Electron native file drag-out: prevent the HTML5 drag and hand the
        // files straight to the OS via startDrag. Supports multi-select.
        e.preventDefault();

        let idsToDrag = [itemId];
        if (selectedIds.includes(itemId) && selectedIds.length > 1) idsToDrag = selectedIds;

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

        window.electron?.startNativeDrag?.({ items: exportItems });
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

    // Auto-crop: trim transparent margins off completed item(s). Shared by the
    // bg-remover and the cropper tool.
    const handleAutoCrop = async () => {
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
    };

    const handleDownload = async () => {
        if (isZipping) return;
        const itemsToDownload = (hasSelection ? items.filter(i => selectedIds.includes(i.id)) : items)
            .filter(i => i.processedUrl);
        if (itemsToDownload.length === 0) return;
        try {
            setIsZipping(true);
            await saveOutputs(
                itemsToDownload.map(i => ({
                    name: getOutputFileName(i.file.name, id),
                    url: i.processedUrl!,
                    originalPath: (i.file as any).path ?? null,
                })),
                toolSuffixMap[id] || 'processed'
            );
        } catch (error) {
            console.error('Save failed', error);
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
            style={{
                width: isActive ? '100%' : 80,
                height: isActive ? '100%' : 80,
                pointerEvents: 'auto',
                cursor: isActive ? 'default' : 'pointer',
            }}
            data-interactive
            className={`relative flex flex-col items-center justify-center overflow-hidden transition-colors duration-200
        ${isActive
                    ? 'rounded-[20px]'
                    : `rounded-2xl border ${externalDragHover
                        ? 'bg-[var(--tile-hover)] border-[var(--accent)] ring-2 ring-[var(--accent)]'
                        : 'bg-[var(--tile)] border-[var(--border)] hover:bg-[var(--tile-hover)]'}`}
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
            {!isActive && (
                <div className="relative flex items-center justify-center w-full h-full text-[var(--text-2)]">
                    <Icon className={`w-8 h-8 text-${colorClass}-400`} />
                    {badgeCount > 0 && (
                        <div className="absolute top-4 right-4 translate-x-1/2 -translate-y-1/2 bg-red-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center border border-[var(--bg)] shadow-sm animate-in zoom-in">
                            {badgeCount}
                        </div>
                    )}
                </div>
            )}

            {/* --- STATE: ACTIVE / EXPANDED --- */}
            {isActive && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={instantContent ? { duration: 0 } : { duration: 0.15, delay: 0.14 }}
                    className="absolute inset-0 flex flex-col w-full h-full cursor-default select-none"
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

                    {/* Magic Brush overlay — remover-specific (both remover variants) */}
                    {(id === 'remover') && isBrushing && focusedItem?.status === 'completed' && focusedItem.processedUrl && (
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

                    {/* Hide ToolWidget content when an overlay tool covers it */}
                    {!(['ocr', 'pdf', 'converter', 'upscaler', 'metadata', 'watermark', 'vectorizer', 'palette', 'resize', 'zip'].includes(id)
                        || (id === 'cropper' && isCropping)
                        || ((id === 'remover') && isBrushing)) && (<>
                    {/* Header — shared ToolHeader so session tools match every
                        other tool's chrome (full-bleed separator, px-4 py-3). */}
                    <ToolHeader
                        icon={<Icon className={`w-4 h-4 text-${colorClass}-400`} />}
                        title={title}
                        count={itemCount}
                        onClose={onClose}
                        onSettings={onOpenSettings}
                    />

                    {/* Content Body — padded to match the shared p-3 body inset. */}
                    <div className="flex-1 flex flex-col min-h-0 p-3">
                    <div className="flex-1 relative rounded-xl overflow-hidden bg-black/20 min-h-0 border border-[var(--separator)]"
                        onClick={(e) => { if (e.target === e.currentTarget && isMultiple) { /* Deselect logic optional */ } }}>

                        {!items.length ? (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed border-[var(--border)] bg-[var(--surface-2)]">
                                <div className="p-4 rounded-2xl bg-[var(--surface)]">
                                    <Icon className="w-8 h-8 text-[var(--text-3)]" />
                                </div>
                                <div className="text-center px-4">
                                    <p className="text-sm font-semibold text-[var(--text-2)]">
                                        {emptyHint || t('widget.defaultEmptyHint')}
                                    </p>
                                    {emptySubHint && (
                                        <p className="text-xs text-[var(--text-3)] mt-1">{emptySubHint}</p>
                                    )}
                                    {formatLines && formatLines.length > 0 && (
                                        <div className="mt-2">
                                            {formatLines.map((line, i) => (
                                                <p key={i} className="text-[10px] text-[var(--text-3)]">{line}</p>
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
                                                onDragStart={(e) => handleItemDragStart(e, singleItem.id)}                                            >
                                                <GridItemPreview item={singleItem} colorClass={colorClass} />
                                            </div>
                                        ) : (
                                            <img
                                                src={currentImageSrc}
                                                className="w-full h-full object-contain cursor-grab active:cursor-grabbing"
                                                alt="preview"
                                                draggable={!isSingleProcessing}
                                                onDragStart={(e) => handleItemDragStart(e, singleItem.id)}                                            />
                                        )}

                                        {isSingleProcessing && (
                                            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center">
                                                <Loader2 className={`w-8 h-8 text-${colorClass}-400 animate-spin mb-2`} />
                                                <span className="text-xs text-[var(--text-2)]">{isModelLoading ? t('widget.loadingModel') : t('widget.processing')}</span>
                                            </div>
                                        )}

                                        {isSingleCompleted && singleItem.metadata && (
                                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-3 pt-6 pointer-events-none">
                                                <div className="flex justify-between text-xs text-[var(--text-2)]">
                                                    <span>{singleItem.metadata.newSize || 'Done'}</span>
                                                    {singleItem.metadata.savedPercentage && <span className="text-[var(--green)]">{singleItem.metadata.savedPercentage} saved</span>}
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
                                                        className={`
                                                group relative aspect-square rounded-lg border overflow-hidden flex items-center justify-center p-2 transition-all duration-200
                                                ${item.status !== 'processing' ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}
                                                ${isSelected
                                                                ? `bg-${colorClass}-500/20 border-${colorClass}-500 ring-1 ring-${colorClass}-500`
                                                                : 'bg-[var(--surface-2)] border-[var(--separator)] hover:bg-[var(--surface-3)]'
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
                    </div>

                    {/* Actions Footer */}
                    <div className="flex flex-col gap-1.5 shrink-0 w-full px-3 pb-3">
                        {/* Row 1: Extra tool-specific buttons (only when present) */}
                        {(id === 'remover') && (
                            <>
                            <div className="flex items-center gap-1.5 w-full">
                                <button
                                    onClick={() => setShowOriginal(!showOriginal)}
                                    disabled={!isFocusedCompleted || isMultiple}
                                    className={`flex-1 flex items-center justify-center h-10 rounded-xl transition-colors ${
                                        !isFocusedCompleted || isMultiple ? 'bg-[var(--surface-2)] text-[var(--text-3)] cursor-not-allowed' :
                                            showOriginal ? 'bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent-soft)]' :
                                                'bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-2)] hover:text-[var(--text)]'
                                    }`}
                                    title={showOriginal ? t('widget.showResult') : t('widget.showOriginal')}
                                >
                                    {showOriginal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                </button>
                                <button
                                    onClick={() => setIsBrushing(true)}
                                    disabled={!isFocusedCompleted}
                                    className={`flex-1 flex items-center justify-center h-10 rounded-xl transition-colors ${
                                        !isFocusedCompleted
                                            ? 'bg-[var(--surface-2)] text-[var(--text-3)] cursor-not-allowed'
                                            : 'bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-2)] hover:text-[var(--text)]'
                                    }`}
                                    title={t('widget.magicBrush')}
                                >
                                    <Brush className="w-4 h-4" />
                                </button>
                                <button
                                    onClick={handleAutoCrop}
                                    disabled={!hasCompleted || showOriginal || isTrimming}
                                    className={`flex-1 flex items-center justify-center h-10 rounded-xl transition-colors ${
                                        !hasCompleted || showOriginal
                                            ? 'bg-[var(--surface-2)] text-[var(--text-3)] cursor-not-allowed'
                                            : 'bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-2)] hover:text-[var(--text)]'
                                    }`}
                                    title={t('widget.autoCrop')}
                                >
                                    {isTrimming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
                                </button>
                            </div>
                            </>
                        )}
                        {showSplit && (
                            <div className="flex items-center gap-1.5 w-full">
                                {id === 'cropper' && (
                                    <>
                                    <button
                                        onClick={() => setIsCropping(true)}
                                        className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all bg-orange-600 hover:bg-orange-500 text-white"
                                    >
                                        <CropIcon className="w-4 h-4" />
                                        {t('widget.crop')}
                                    </button>
                                    {/* Auto-crop: trim transparent margins (e.g. after a bg removal) */}
                                    <button
                                        onClick={handleAutoCrop}
                                        disabled={!hasCompleted || showOriginal || isTrimming}
                                        className={`shrink-0 w-12 flex items-center justify-center h-10 rounded-xl transition-colors ${
                                            !hasCompleted || showOriginal
                                                ? 'bg-[var(--surface-2)] text-[var(--text-3)] cursor-not-allowed'
                                                : 'bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-2)] hover:text-[var(--text)]'
                                        }`}
                                        title={t('widget.autoCrop')}
                                    >
                                        {isTrimming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
                                    </button>
                                    </>
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
                                        ? <><Ban className="w-4 h-4" />{t('widget.cancel')}</>
                                        : <><Loader2 className="w-4 h-4 animate-spin" />{isModelLoading ? t('widget.loadingModel') : t('widget.processing')}</>
                                    }
                                </button>
                            ) : hasIdle && onProcessIdle ? (
                                <button
                                    onClick={onProcessIdle}
                                    className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all bg-${colorClass}-600 hover:bg-${colorClass}-500 text-white`}
                                >
                                    <Icon className="w-4 h-4" />
                                    {idleActionLabel}
                                </button>
                            ) : hasCompleted ? (
                                <button
                                    onClick={handleDownload}
                                    disabled={isZipping}
                                    className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white disabled:opacity-50"
                                    title={hasSelection ? t('widget.downloadSelected', { count: selectionCount }) : t('widget.download')}
                                >
                                    {isZipping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                    {t('widget.download')}
                                </button>
                            ) : (
                                <button
                                    disabled
                                    className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold bg-[var(--surface-2)] text-[var(--text-3)] cursor-not-allowed"
                                >
                                    <Icon className="w-4 h-4" />
                                    {idleActionLabel}
                                </button>
                            )}

                            {/* Right half: Copy | Paste | Delete */}
                            <div className="flex-1 flex items-center gap-1">
                                <button
                                    onClick={handleCopy}
                                    disabled={isCopying || items.length === 0}
                                    className="flex-1 flex items-center justify-center h-10 rounded-xl transition-colors bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-2)] hover:text-[var(--text)] disabled:opacity-40 disabled:cursor-not-allowed"
                                    title={t('widget.copy')}
                                >
                                    {isCopying ? <Loader2 className="w-4 h-4 animate-spin" /> :
                                        showCopySuccess ? <Check className="w-4 h-4 text-[var(--green)]" /> :
                                            <Copy className="w-4 h-4" />}
                                </button>
                                <button
                                    onClick={handlePaste}
                                    disabled={isPasting}
                                    className="flex-1 flex items-center justify-center h-10 rounded-xl transition-colors bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-2)] hover:text-[var(--text)] disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={t('widget.paste')}
                                >
                                    {isPasting ? <Loader2 className="w-4 h-4 animate-spin" /> :
                                        showPasteSuccess ? <Check className="w-4 h-4 text-[var(--green)]" /> :
                                            <ClipboardPaste className="w-4 h-4" />}
                                </button>
                                <button
                                    onClick={onDelete}
                                    disabled={items.length === 0}
                                    className={`flex-1 flex items-center justify-center h-10 rounded-xl transition-colors bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-3)] hover:text-[var(--red)] ${
                                        items.length === 0 ? 'cursor-not-allowed opacity-40' : ''
                                    }`}
                                    title={hasSelection ? t('widget.deleteSelected', { count: selectionCount }) : t('widget.clearAll')}
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </div>
                    </div>

                    </>)}
                </motion.div>
            )}

            {/* Self-contained tools — always mounted, fade in/out to match container
                expand animation. They ingest files from the shared session store
                while `active` (see useSessionIngest). */}
            {(() => {
                const SELF_TOOL_COMPONENTS: Partial<Record<ToolId, React.ComponentType<{
                    onClose: () => void; active: boolean; onItemCountChange?: (n: number) => void; clearGen?: number;
                }>>> = {
                    pdf: PdfTool, converter: ConverterTool, upscaler: UpscalerTool,
                    metadata: MetadataTool, watermark: WatermarkTool, palette: PaletteTool,
                    resize: ResizeTool, zip: ZipTool, vectorizer: VectorizerTool, ocr: OcrTool,
                };
                const SelfTool = SELF_TOOL_COMPONENTS[id];
                if (!SelfTool) return null;
                return (
                    <motion.div
                        className="absolute inset-0 z-50 rounded-2xl overflow-hidden"
                        animate={{ opacity: isActive ? 1 : 0 }}
                        transition={instantContent ? { duration: 0 } : { duration: 0.15, delay: isActive ? 0.14 : 0 }}
                        style={{ pointerEvents: isActive ? 'auto' : 'none' }}
                    >
                        <SelfTool
                            onClose={onClose}
                            active={isActive}
                            onItemCountChange={setSelfItemCount}
                            clearGen={clearGen || 0}
                        />
                    </motion.div>
                );
            })()}
        </motion.div>
    );
};
