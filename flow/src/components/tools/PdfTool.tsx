
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
    FileText, Upload, Loader2, Download, Trash2, AlertCircle,
    GripVertical, X, Plus, Layers, LayoutGrid, Minimize2, Check, FileOutput,
    Copy, ClipboardPaste
} from 'lucide-react';
import { getPdfThumbnails, mergePdfs, organizePdf, compressPdf, convertPdfToWord, convertPdfToPptx } from '../../services/api';
import type { PdfCompressPreset } from '../../services/api';
import JSZip from 'jszip';

type PdfSubtool = 'merge' | 'organize' | 'compress' | 'convert' | null;

interface PdfFileItem {
    id: string;
    file: File;
    name: string;
    pageCount: number;
    sizeBytes: number;
    thumbnailUrl?: string;
}

interface PageItem {
    id: string;
    fileIndex: number;
    fileId: string;
    pageNum: number;
    thumbnailUrl: string;
    width: number;
    height: number;
}

interface PdfToolProps {
    onClose: () => void;
    droppedFiles: File[];
    dropGeneration: number;
    onItemCountChange?: (count: number) => void;
    clearGen?: number;
}

const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    return `${(kb / 1024).toFixed(1)} MB`;
};

const genId = () => Math.random().toString(36).substring(2, 11);

const isPdf = (file: File) =>
    file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');

export const PdfTool: React.FC<PdfToolProps> = ({ onClose, droppedFiles, dropGeneration, onItemCountChange, clearGen = 0 }) => {
    const [pdfFiles, setPdfFiles] = useState<PdfFileItem[]>([]);
    const [activeSubtool, setActiveSubtool] = useState<PdfSubtool>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processingLabel, setProcessingLabel] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [isLoadingFiles, setIsLoadingFiles] = useState(false);
    const [showDownload, setShowDownload] = useState(false);

    // Compress state
    const [compressPreset, setCompressPreset] = useState<PdfCompressPreset>('medium');

    // Convert state
    const [convertFormat, setConvertFormat] = useState<'word' | 'pptx'>('word');

    // Service picker popup (shown on first file drop)
    const [showServicePicker, setShowServicePicker] = useState(false);

    // Organize overlay (decoupled from service selection)
    const [isOrganizeOpen, setIsOrganizeOpen] = useState(false);

    // File list multi-select
    const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());

    // Organize overlay state
    const [organizePages, setOrganizePages] = useState<PageItem[]>([]);
    const [organizeSourceFiles, setOrganizeSourceFiles] = useState<File[]>([]);
    const [isLoadingThumbnails, setIsLoadingThumbnails] = useState(false);
    const [pendingAddFile, setPendingAddFile] = useState<File | null>(null);
    const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(new Set());

    // Drag state refs
    const dragFileIndexRef = useRef<number | null>(null);
    const pageGridRef = useRef<HTMLDivElement | null>(null);
    const dragPreviewRef = useRef<HTMLDivElement | null>(null);
    const isDraggingPageRef = useRef(false);
    const [draggingPageId, setDraggingPageId] = useState<string | null>(null);

    // Report item count to parent (for collapsed badge)
    useEffect(() => { onItemCountChange?.(pdfFiles.length); }, [pdfFiles.length, onItemCountChange]);

    // Consume dropped files forwarded from DockApp
    const lastGenRef = useRef(dropGeneration);
    useEffect(() => {
        if (dropGeneration === 0) return;
        if (dropGeneration === lastGenRef.current) return;
        lastGenRef.current = dropGeneration;
        if (droppedFiles.length === 0) return;
        addFiles(droppedFiles);
    }, [dropGeneration]); // eslint-disable-line react-hooks/exhaustive-deps

    // Clear all files when global clear is triggered
    const lastClearGen = useRef(clearGen);
    useEffect(() => {
        if (clearGen === 0 || clearGen === lastClearGen.current) return;
        lastClearGen.current = clearGen;
        setPdfFiles([]);
        setActiveSubtool(null);
        setError(null);
    }, [clearGen]);

    // Show service picker on first file drop (when no service selected)
    const prevHadFilesRef = useRef(false);
    useEffect(() => {
        if (pdfFiles.length > 0 && !prevHadFilesRef.current && !activeSubtool) {
            setShowServicePicker(true);
        }
        prevHadFilesRef.current = pdfFiles.length > 0;
    }, [pdfFiles.length]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Add files ──────────────────────────────────────────────────────
    const addFiles = useCallback(async (files: File[]) => {
        const pdfOnly = files.filter(isPdf);
        if (pdfOnly.length === 0) {
            setError('يُقبل ملفات PDF فقط');
            setTimeout(() => setError(null), 3000);
            return;
        }

        setIsLoadingFiles(true);
        setError(null);

        try {
            const newItems: PdfFileItem[] = [];
            for (const file of pdfOnly) {
                try {
                    const result = await getPdfThumbnails(file, 72);
                    newItems.push({
                        id: genId(),
                        file,
                        name: file.name,
                        pageCount: result.pageCount,
                        sizeBytes: file.size,
                        thumbnailUrl: result.thumbnails[0]?.data,
                    });
                } catch {
                    newItems.push({
                        id: genId(),
                        file,
                        name: file.name,
                        pageCount: 0,
                        sizeBytes: file.size,
                    });
                }
            }
            setPdfFiles(prev => [...prev, ...newItems]);
        } finally {
            setIsLoadingFiles(false);
        }
    }, []);

    // ── Own drop handler (intercepts before SideDock) ──────────────────
    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        if (isProcessing) return;
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) addFiles(files);
    }, [isProcessing, addFiles]);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isProcessing) setIsDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
            setIsDragOver(false);
        }
    };

    const removeFile = (id: string) => {
        setPdfFiles(prev => prev.filter(f => f.id !== id));
        setSelectedFileIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    };

    const toggleFileSelection = (id: string) => {
        setSelectedFileIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    // ── File list reorder ──────────────────────────────────────────────
    const handleFileDragStart = (e: React.DragEvent, index: number) => {
        dragFileIndexRef.current = index;
        e.dataTransfer.effectAllowed = 'move';
        const ghost = document.createElement('div');
        ghost.style.cssText = 'width:1px;height:1px;position:fixed;top:-100px';
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 0, 0);
        requestAnimationFrame(() => document.body.removeChild(ghost));
    };

    const handleFileDragOver = (e: React.DragEvent, targetIndex: number) => {
        e.preventDefault();
        if (dragFileIndexRef.current === null || dragFileIndexRef.current === targetIndex) return;
        setPdfFiles(prev => {
            const next = [...prev];
            const [moved] = next.splice(dragFileIndexRef.current!, 1);
            next.splice(targetIndex, 0, moved);
            dragFileIndexRef.current = targetIndex;
            return next;
        });
    };

    const handleFileDragEnd = () => { dragFileIndexRef.current = null; };

    // ── Merge ──────────────────────────────────────────────────────────
    const handleMerge = async () => {
        if (pdfFiles.length < 2) return;
        setIsProcessing(true);
        setProcessingLabel('جاري دمج الملفات...');
        setError(null);

        try {
            const result = await mergePdfs(pdfFiles.map(f => f.file));
            const blob = await (await fetch(result.dataUrl)).blob();
            const mergedFile = new File([blob], 'merged.pdf', { type: 'application/pdf' });

            setPdfFiles([{
                id: genId(),
                file: mergedFile,
                name: 'merged.pdf',
                pageCount: result.pageCount,
                sizeBytes: blob.size,
            }]);
            setActiveSubtool(null);
            setShowDownload(true);
        } catch (err: any) {
            setError(err?.message || 'فشل دمج الملفات');
        } finally {
            setIsProcessing(false);
        }
    };

    // ── Compress ────────────────────────────────────────────────────────
    const handleCompress = async () => {
        setIsProcessing(true);
        setError(null);

        try {
            const newFiles: PdfFileItem[] = [];
            for (let i = 0; i < pdfFiles.length; i++) {
                setProcessingLabel(`جاري ضغط ملف ${i + 1} من ${pdfFiles.length}...`);
                const result = await compressPdf(pdfFiles[i].file, compressPreset);
                const blob = await (await fetch(result.dataUrl)).blob();
                const compressed = new File([blob], pdfFiles[i].name, { type: 'application/pdf' });
                newFiles.push({
                    id: genId(),
                    file: compressed,
                    name: pdfFiles[i].name,
                    pageCount: pdfFiles[i].pageCount,
                    sizeBytes: blob.size,
                    thumbnailUrl: pdfFiles[i].thumbnailUrl,
                });
            }
            setPdfFiles(newFiles);
            setActiveSubtool(null);
            setShowDownload(true);
        } catch (err: any) {
            setError(err?.message || 'فشل ضغط الملفات');
        } finally {
            setIsProcessing(false);
        }
    };

    // ── Convert to Word / PowerPoint ─────────────────────────────────────
    const handleConvert = async () => {
        setIsProcessing(true);
        setError(null);

        try {
            const newFiles: PdfFileItem[] = [];
            for (let i = 0; i < pdfFiles.length; i++) {
                setProcessingLabel(`جاري تحويل ملف ${i + 1} من ${pdfFiles.length}...`);
                const ext = convertFormat === 'word' ? 'docx' : 'pptx';
                const mime = convertFormat === 'word'
                    ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
                    : 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

                const result = convertFormat === 'word'
                    ? await convertPdfToWord(pdfFiles[i].file)
                    : await convertPdfToPptx(pdfFiles[i].file);

                const blob = await (await fetch(result.dataUrl)).blob();
                const baseName = pdfFiles[i].name.replace(/\.pdf$/i, '');
                const outFile = new File([blob], `${baseName}.${ext}`, { type: mime });

                newFiles.push({
                    id: genId(),
                    file: outFile,
                    name: `${baseName}.${ext}`,
                    pageCount: pdfFiles[i].pageCount,
                    sizeBytes: blob.size,
                });
            }
            setPdfFiles(newFiles);
            setActiveSubtool(null);
            setShowDownload(true);
        } catch (err: any) {
            setError(err?.message || 'فشل تحويل الملفات');
        } finally {
            setIsProcessing(false);
        }
    };

    // ── Organize ────────────────────────────────────────────────────────
    const handleOpenOrganize = async () => {
        setIsOrganizeOpen(true);
        setIsLoadingThumbnails(true);
        setSelectedPageIds(new Set());

        try {
            const allPages: PageItem[] = [];
            const sourceFiles: File[] = [];

            for (let fi = 0; fi < pdfFiles.length; fi++) {
                const file = pdfFiles[fi].file;
                sourceFiles.push(file);
                const result = await getPdfThumbnails(file, 96);
                for (const thumb of result.thumbnails) {
                    allPages.push({
                        id: `${pdfFiles[fi].id}-p${thumb.pageNum}`,
                        fileIndex: fi,
                        fileId: pdfFiles[fi].id,
                        pageNum: thumb.pageNum,
                        thumbnailUrl: thumb.data,
                        width: thumb.width,
                        height: thumb.height,
                    });
                }
            }

            setOrganizePages(allPages);
            setOrganizeSourceFiles(sourceFiles);
        } catch (err: any) {
            setError(err?.message || 'فشل تحميل الصفحات');
            setIsOrganizeOpen(false);
        } finally {
            setIsLoadingThumbnails(false);
        }
    };

    const handleOrganizeSave = async () => {
        if (organizePages.length === 0) return;
        setIsProcessing(true);
        setProcessingLabel('جاري حفظ التعديلات...');

        try {
            const pageOrder = organizePages.map(p => ({ fileIndex: p.fileIndex, pageNum: p.pageNum }));
            const result = await organizePdf(organizeSourceFiles, pageOrder);
            const blob = await (await fetch(result.dataUrl)).blob();
            const resultFile = new File([blob], 'organized.pdf', { type: 'application/pdf' });

            setPdfFiles([{
                id: genId(),
                file: resultFile,
                name: 'organized.pdf',
                pageCount: result.pageCount,
                sizeBytes: blob.size,
            }]);
            setIsOrganizeOpen(false);
            setActiveSubtool(null);
            setOrganizePages([]);
            setOrganizeSourceFiles([]);
        } catch (err: any) {
            setError(err?.message || 'فشل حفظ التعديلات');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleOrganizeDeletePages = () => {
        setOrganizePages(prev => prev.filter(p => !selectedPageIds.has(p.id)));
        setSelectedPageIds(new Set());
    };

    const togglePageSelection = (pageId: string) => {
        setSelectedPageIds(prev => {
            const next = new Set(prev);
            if (next.has(pageId)) next.delete(pageId);
            else next.add(pageId);
            return next;
        });
    };

    // Page drag reorder (pointer-based for smooth multi-position drags + drag preview)
    const handlePagePointerDown = (e: React.PointerEvent, index: number, pageId: string) => {
        if (e.button !== 0) return;
        e.preventDefault();

        const grid = pageGridRef.current;
        if (!grid) return;
        const sourceEl = grid.children[index] as HTMLElement;
        if (!sourceEl) return;
        const cellRect = sourceEl.getBoundingClientRect();
        const offsetX = e.clientX - cellRect.left;
        const offsetY = e.clientY - cellRect.top;
        const startX = e.clientX;
        const startY = e.clientY;

        isDraggingPageRef.current = false;
        let active = true;
        let lastTarget = index;

        const onMove = (ev: PointerEvent) => {
            if (!active) return;

            // Start drag after 5px threshold
            if (!isDraggingPageRef.current) {
                if (Math.abs(ev.clientX - startX) < 5 && Math.abs(ev.clientY - startY) < 5) return;
                isDraggingPageRef.current = true;
                setDraggingPageId(pageId);

                // Create floating preview clone
                const preview = sourceEl.cloneNode(true) as HTMLDivElement;
                preview.style.cssText = `
                    position:fixed; z-index:9999; pointer-events:none;
                    width:${cellRect.width}px; height:${cellRect.height}px;
                    opacity:0.9; border-radius:8px; overflow:hidden;
                    box-shadow:0 10px 40px rgba(0,0,0,0.5);
                    transition:none; will-change:transform;
                `;
                document.body.appendChild(preview);
                dragPreviewRef.current = preview;
            }

            // Move floating preview
            if (dragPreviewRef.current) {
                dragPreviewRef.current.style.left = `${ev.clientX - offsetX}px`;
                dragPreviewRef.current.style.top = `${ev.clientY - offsetY}px`;
            }

            // Calculate target index from cursor position
            const g = pageGridRef.current;
            if (!g || g.children.length === 0) return;
            const first = g.children[0] as HTMLElement;
            const gridRect = g.getBoundingClientRect();
            const cellW = first.offsetWidth;
            const cellH = first.offsetHeight;
            const gap = 8;
            const cols = 3;

            const gx = ev.clientX - gridRect.left;
            const gy = ev.clientY - gridRect.top;
            const col = Math.min(Math.max(Math.floor(gx / (cellW + gap)), 0), cols - 1);
            const row = Math.max(Math.floor(gy / (cellH + gap)), 0);
            const targetIndex = Math.min(Math.max(row * cols + col, 0), g.children.length - 1);

            if (targetIndex === lastTarget) return;
            lastTarget = targetIndex;

            // Use findIndex by ID — immune to batching/stale-index issues
            setOrganizePages(prev => {
                const fromIndex = prev.findIndex(p => p.id === pageId);
                if (fromIndex === -1 || fromIndex === targetIndex) return prev;
                const next = [...prev];
                const [moved] = next.splice(fromIndex, 1);
                next.splice(targetIndex, 0, moved);
                return next;
            });
        };

        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);

            const wasDragging = isDraggingPageRef.current;
            active = false;
            isDraggingPageRef.current = false;
            setDraggingPageId(null);

            if (dragPreviewRef.current) {
                document.body.removeChild(dragPreviewRef.current);
                dragPreviewRef.current = null;
            }

            // If no drag happened, treat as click → toggle selection
            if (!wasDragging) {
                togglePageSelection(pageId);
            }
        };

        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    };

    // Add new PDF in organize overlay
    const handleOrganizeFileDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const files = Array.from(e.dataTransfer.files);
        const pdfFile = files.find(isPdf);
        if (pdfFile) setPendingAddFile(pdfFile);
    };

    const handleConfirmAddFile = async () => {
        if (!pendingAddFile) return;
        const file = pendingAddFile;
        setPendingAddFile(null);
        setIsLoadingThumbnails(true);

        try {
            const newFileIndex = organizeSourceFiles.length;
            const result = await getPdfThumbnails(file, 96);
            const newPages = result.thumbnails.map(thumb => ({
                id: `add-${genId()}-p${thumb.pageNum}`,
                fileIndex: newFileIndex,
                fileId: genId(),
                pageNum: thumb.pageNum,
                thumbnailUrl: thumb.data,
                width: thumb.width,
                height: thumb.height,
            }));

            setOrganizeSourceFiles(prev => [...prev, file]);
            setOrganizePages(prev => [...prev, ...newPages]);
        } catch (err: any) {
            setError(err?.message || 'فشل إضافة الملف');
        } finally {
            setIsLoadingThumbnails(false);
        }
    };

    // ── Download ────────────────────────────────────────────────────────
    const handleDownload = async () => {
        if (pdfFiles.length === 0) return;

        if (pdfFiles.length === 1) {
            const link = document.createElement('a');
            const url = URL.createObjectURL(pdfFiles[0].file);
            link.href = url;
            link.download = pdfFiles[0].name;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } else {
            const zip = new JSZip();
            pdfFiles.forEach(pf => zip.file(pf.name, pf.file));
            const blob = await zip.generateAsync({ type: 'blob' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.href = url;
            link.download = `pdf-tools-${Date.now()}.zip`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
    };

    // ── Render ──────────────────────────────────────────────────────────

    const hasFiles = pdfFiles.length > 0;
    const showFileList = hasFiles && !isOrganizeOpen;

    return (
        <div
            className="absolute inset-0 flex flex-col rounded-2xl overflow-hidden"
            onDrop={!isOrganizeOpen ? handleDrop : undefined}
            onDragOver={!isOrganizeOpen ? handleDragOver : undefined}
            onDragLeave={!isOrganizeOpen ? handleDragLeave : undefined}
        >
            {/* ── Header ──────────────────────────────────────────── */}
            <div className="flex items-center px-4 py-3 border-b border-white/5 shrink-0">
                <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-teal-400" />
                    <span className="text-sm font-bold text-white">أدوات PDF</span>
                    {hasFiles && (
                        <span className="text-xs bg-slate-700 px-2 py-0.5 rounded-full text-slate-300">
                            {pdfFiles.length} {pdfFiles.length === 1 ? 'ملف' : 'ملفات'}
                        </span>
                    )}
                </div>
                <div className="flex-1" />
                <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1">
                    <X className="w-4 h-4" />
                </button>
            </div>

            {/* ── Error banner ────────────────────────────────────── */}
            {error && (
                <div className="mx-3 mt-2 px-3 py-2 bg-red-900/30 border border-red-500/20 rounded-lg flex items-center gap-2 shrink-0">
                    <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
                    <span className="text-xs text-red-300 flex-1">{error}</span>
                    <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300">
                        <X className="w-3 h-3" />
                    </button>
                </div>
            )}

            {/* ── Body ────────────────────────────────────────────── */}
            <div className="flex-1 flex flex-col min-h-0 p-3 gap-2">
                <AnimatePresence mode="wait">

                    {/* EMPTY: Drop zone */}
                    {!hasFiles && !isProcessing && !isLoadingFiles && (
                        <motion.label
                            key="empty"
                            htmlFor="pdf-file-input"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className={`
                                flex-1 flex flex-col items-center justify-center gap-4 rounded-xl
                                border-2 border-dashed transition-all duration-200 cursor-pointer
                                ${isDragOver
                                    ? 'border-teal-400 bg-teal-500/10 scale-[0.99]'
                                    : 'border-slate-700 bg-slate-800/30 hover:border-slate-500 hover:bg-slate-800/50'
                                }
                            `}
                        >
                            <div className={`p-4 rounded-2xl transition-colors ${isDragOver ? 'bg-teal-500/20' : 'bg-slate-800'}`}>
                                {isDragOver
                                    ? <Upload className="w-8 h-8 text-teal-400" />
                                    : <FileText className="w-8 h-8 text-slate-500" />
                                }
                            </div>
                            <div className="text-center px-4">
                                <p className="text-sm font-semibold text-slate-300">
                                    {isDragOver ? 'أفلت الملفات هنا' : 'اسحب ملفات PDF هنا'}
                                </p>
                                <p className="text-xs text-slate-500 mt-1">أو اضغط للاختيار يدويًا</p>
                            </div>
                            <input
                                id="pdf-file-input"
                                type="file"
                                accept=".pdf,application/pdf"
                                multiple
                                className="sr-only"
                                onChange={(e) => {
                                    if (e.target.files) addFiles(Array.from(e.target.files));
                                    e.target.value = '';
                                }}
                            />
                        </motion.label>
                    )}

                    {/* LOADING FILES */}
                    {isLoadingFiles && !hasFiles && (
                        <motion.div
                            key="loading-files"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex-1 flex flex-col items-center justify-center gap-3"
                        >
                            <Loader2 className="w-8 h-8 text-teal-400 animate-spin" />
                            <p className="text-xs text-slate-400">جاري تحميل الملفات...</p>
                        </motion.div>
                    )}

                    {/* FILE LIST */}
                    {showFileList && !isProcessing && (
                        <motion.div
                            key="file-list"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex-1 flex flex-col gap-2 min-h-0"
                        >
                            {/* Service selector row */}
                            <div className="flex gap-1.5 shrink-0">
                                {([
                                    { id: 'merge' as PdfSubtool, label: 'دمج', Icon: Layers },
                                    { id: 'organize' as PdfSubtool, label: 'تنظيم', Icon: LayoutGrid },
                                    { id: 'compress' as PdfSubtool, label: 'ضغط', Icon: Minimize2 },
                                    { id: 'convert' as PdfSubtool, label: 'تحويل', Icon: FileOutput },
                                ]).map(s => (
                                    <button
                                        key={s.id}
                                        onClick={() => { setActiveSubtool(s.id); setShowDownload(false); }}
                                        className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
                                            activeSubtool === s.id
                                                ? 'bg-teal-600/20 text-teal-300 border-teal-500/30'
                                                : 'bg-slate-800/60 text-slate-400 hover:text-white border-white/5 hover:border-white/10'
                                        }`}
                                    >
                                        <s.Icon className="w-3.5 h-3.5" />
                                        {s.label}
                                    </button>
                                ))}
                            </div>

                            {/* Compress presets (shown when compress selected) */}
                            {activeSubtool === 'compress' && (
                                <div className="shrink-0 space-y-1.5">
                                    <p className="text-[11px] text-slate-500 font-semibold">مستوى الضغط</p>
                                    <div className="flex gap-1.5">
                                        {(['low', 'medium', 'high'] as const).map(preset => (
                                            <button
                                                key={preset}
                                                onClick={() => setCompressPreset(preset)}
                                                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                                    compressPreset === preset
                                                        ? 'bg-teal-600 border-teal-500 text-white'
                                                        : 'bg-slate-800 border-white/5 text-slate-400 hover:bg-slate-700 hover:text-white'
                                                }`}
                                            >
                                                {preset === 'low' ? 'منخفض' : preset === 'medium' ? 'متوسط' : 'عالي'}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Convert format selector (shown when convert selected) */}
                            {activeSubtool === 'convert' && (
                                <div className="shrink-0 space-y-1.5">
                                    <p className="text-[11px] text-slate-500 font-semibold">صيغة التحويل</p>
                                    <div className="flex gap-1.5">
                                        {(['word', 'pptx'] as const).map(fmt => (
                                            <button
                                                key={fmt}
                                                onClick={() => setConvertFormat(fmt)}
                                                className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all border ${
                                                    convertFormat === fmt
                                                        ? 'bg-teal-600 border-teal-500 text-white'
                                                        : 'bg-slate-800 border-white/5 text-slate-400 hover:bg-slate-700 hover:text-white'
                                                }`}
                                            >
                                                {fmt === 'word' ? 'Word' : 'PowerPoint'}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="flex-1 overflow-y-auto space-y-1">
                                {pdfFiles.map((pf, index) => (
                                    <div
                                        key={pf.id}
                                        draggable
                                        onDragStart={(e) => handleFileDragStart(e, index)}
                                        onDragOver={(e) => handleFileDragOver(e, index)}
                                        onDragEnd={handleFileDragEnd}
                                        onClick={() => toggleFileSelection(pf.id)}
                                        className={`flex items-center gap-2 px-2 py-2 bg-slate-800/60 rounded-lg border transition-colors cursor-pointer group ${
                                            selectedFileIds.has(pf.id)
                                                ? 'border-teal-400 ring-1 ring-teal-400/30'
                                                : 'border-white/5 hover:border-teal-500/20'
                                        }`}
                                    >
                                        <GripVertical className="w-3.5 h-3.5 text-slate-600 cursor-grab shrink-0" />
                                        <div className="w-10 h-[52px] rounded overflow-hidden bg-slate-900 shrink-0 flex items-center justify-center relative">
                                            {pf.thumbnailUrl ? (
                                                <img src={pf.thumbnailUrl} className="w-full h-full object-contain" alt="" draggable={false} />
                                            ) : (
                                                <FileText className="w-4 h-4 text-teal-400" />
                                            )}
                                            {selectedFileIds.has(pf.id) && (
                                                <div className="absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-teal-500 rounded-full flex items-center justify-center">
                                                    <Check className="w-2 h-2 text-white" />
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs text-slate-200 truncate">{pf.name}</p>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                {pf.pageCount > 0 && (
                                                    <span className="text-[10px] text-slate-500">
                                                        {pf.pageCount} {pf.pageCount === 1 ? 'صفحة' : 'صفحات'}
                                                    </span>
                                                )}
                                                <span className="text-[10px] text-slate-600">{formatSize(pf.sizeBytes)}</span>
                                            </div>
                                        </div>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); removeFile(pf.id); }}
                                            className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-red-400 transition-all p-0.5"
                                        >
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            {/* Add more files */}
                            <label
                                htmlFor="pdf-add-input"
                                className={`
                                    flex items-center justify-center gap-2 py-2.5 rounded-lg border border-dashed cursor-pointer transition-all shrink-0
                                    ${isDragOver
                                        ? 'border-teal-400 bg-teal-500/10'
                                        : 'border-slate-700 hover:border-slate-500 bg-slate-800/20 hover:bg-slate-800/40'
                                    }
                                `}
                            >
                                <Plus className="w-3.5 h-3.5 text-slate-500" />
                                <span className="text-xs text-slate-500">إضافة ملفات</span>
                                <input
                                    id="pdf-add-input"
                                    type="file"
                                    accept=".pdf,application/pdf"
                                    multiple
                                    className="sr-only"
                                    onChange={(e) => {
                                        if (e.target.files) addFiles(Array.from(e.target.files));
                                        e.target.value = '';
                                    }}
                                />
                            </label>

                        </motion.div>
                    )}

                    {/* PROCESSING */}
                    {isProcessing && !isOrganizeOpen && (
                        <motion.div
                            key="processing"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="flex-1 flex flex-col items-center justify-center gap-4"
                        >
                            <div className="relative">
                                <div className="absolute inset-0 bg-teal-500 blur-2xl opacity-20 animate-pulse rounded-full" />
                                <div className="w-16 h-16 rounded-2xl bg-slate-800 border border-teal-500/20 flex items-center justify-center relative">
                                    <Loader2 className="w-8 h-8 text-teal-400 animate-spin" />
                                </div>
                            </div>
                            <p className="text-sm font-semibold text-slate-200">{processingLabel}</p>
                        </motion.div>
                    )}

                </AnimatePresence>
            </div>

            {/* ── Footer: [Action/Download] | [Copy][Paste][Delete] ── */}
            {!isOrganizeOpen && (
                <div className="flex items-center gap-1.5 px-3 pb-3 shrink-0">
                    {/* Left: Action / Download */}
                    {isProcessing ? (
                        <button
                            disabled
                            className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold bg-teal-600/50 text-white/60 cursor-not-allowed"
                        >
                            <Loader2 className="w-4 h-4 animate-spin" />
                            جاري المعالجة...
                        </button>
                    ) : showDownload && hasFiles ? (
                        <button
                            onClick={handleDownload}
                            className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all bg-emerald-600 hover:bg-emerald-500 text-white"
                        >
                            <Download className="w-4 h-4" />
                            تحميل
                        </button>
                    ) : hasFiles && activeSubtool === 'merge' ? (
                        <button
                            onClick={handleMerge}
                            disabled={pdfFiles.length < 2}
                            className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all bg-teal-600 hover:bg-teal-500 disabled:opacity-40 disabled:hover:bg-teal-600 text-white"
                        >
                            <Layers className="w-4 h-4" />
                            دمج
                        </button>
                    ) : hasFiles && activeSubtool === 'organize' ? (
                        <button
                            onClick={handleOpenOrganize}
                            className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all bg-teal-600 hover:bg-teal-500 text-white"
                        >
                            <LayoutGrid className="w-4 h-4" />
                            تنظيم
                        </button>
                    ) : hasFiles && activeSubtool === 'compress' ? (
                        <button
                            onClick={handleCompress}
                            className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all bg-teal-600 hover:bg-teal-500 text-white"
                        >
                            <Minimize2 className="w-4 h-4" />
                            ضغط الملفات
                        </button>
                    ) : hasFiles && activeSubtool === 'convert' ? (
                        <button
                            onClick={handleConvert}
                            className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold transition-all bg-teal-600 hover:bg-teal-500 text-white"
                        >
                            <FileOutput className="w-4 h-4" />
                            تحويل الملفات
                        </button>
                    ) : (
                        <button
                            disabled
                            className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold bg-slate-800/50 text-slate-600 cursor-not-allowed"
                        >
                            <FileText className="w-4 h-4" />
                            أدوات PDF
                        </button>
                    )}

                    {/* Right: Copy | Paste | Delete */}
                    <div className="flex-1 flex items-center gap-1.5">
                        <button
                            disabled={!hasFiles || isProcessing}
                            className="flex-1 flex items-center justify-center h-10 rounded-xl transition-colors bg-white/[0.04] hover:bg-white/[0.1] text-slate-400 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                            title="نسخ"
                        >
                            <Copy className="w-4 h-4" />
                        </button>
                        <label
                            htmlFor="pdf-paste-input"
                            className={`flex-1 flex items-center justify-center h-10 rounded-xl transition-colors cursor-pointer ${
                                isProcessing
                                    ? 'bg-white/[0.02] text-slate-600 cursor-not-allowed pointer-events-none'
                                    : 'bg-white/[0.04] hover:bg-white/[0.1] text-slate-400 hover:text-white'
                            }`}
                            title="لصق / إضافة ملفات"
                        >
                            <ClipboardPaste className="w-4 h-4" />
                            <input
                                id="pdf-paste-input"
                                type="file"
                                accept=".pdf,application/pdf"
                                multiple
                                className="sr-only"
                                onChange={(e) => {
                                    if (e.target.files) addFiles(Array.from(e.target.files));
                                    e.target.value = '';
                                }}
                            />
                        </label>
                        <button
                            onClick={() => {
                                if (selectedFileIds.size > 0) {
                                    setPdfFiles(prev => prev.filter(f => !selectedFileIds.has(f.id)));
                                    setSelectedFileIds(new Set());
                                } else {
                                    setPdfFiles([]); setActiveSubtool(null); setError(null); setShowDownload(false);
                                }
                            }}
                            disabled={!hasFiles || isProcessing}
                            className={`flex-1 flex items-center justify-center h-10 rounded-xl transition-colors ${
                                !hasFiles || isProcessing
                                    ? 'bg-slate-800/50 text-slate-600 cursor-not-allowed'
                                    : 'bg-red-900/20 hover:bg-red-900/40 text-red-400 hover:text-red-300'
                            }`}
                            title={selectedFileIds.size > 0 ? `حذف المحدد (${selectedFileIds.size})` : 'مسح الكل'}
                        >
                            <Trash2 className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}

            {/* ── ORGANIZE OVERLAY ────────────────────────────────── */}
            {isOrganizeOpen && (
                <div className="absolute inset-0 z-[100] bg-slate-950 flex flex-col rounded-2xl overflow-hidden">
                    {/* Organize header */}
                    <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 shrink-0">
                        <div className="flex items-center gap-2">
                            <LayoutGrid className="w-4 h-4 text-teal-400" />
                            <span className="text-sm font-bold text-white">تنظيم الصفحات</span>
                            <span className="text-xs bg-slate-700 px-2 py-0.5 rounded-full text-slate-300">
                                {organizePages.length} صفحة
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            {selectedPageIds.size > 0 && (
                                <button
                                    onClick={handleOrganizeDeletePages}
                                    className="flex items-center gap-1 px-2 py-1 bg-red-600/20 hover:bg-red-600/30 text-red-400 text-xs rounded-lg transition-colors"
                                >
                                    <Trash2 className="w-3 h-3" />
                                    حذف ({selectedPageIds.size})
                                </button>
                            )}
                            <button
                                onClick={handleOrganizeSave}
                                disabled={organizePages.length === 0 || isProcessing}
                                className="px-3 py-1 bg-teal-600 hover:bg-teal-500 disabled:opacity-40 text-white text-xs font-bold rounded-lg transition-colors"
                            >
                                حفظ
                            </button>
                            <button
                                onClick={() => {
                                    setIsOrganizeOpen(false);
                                    setOrganizePages([]);
                                    setOrganizeSourceFiles([]);
                                    setSelectedPageIds(new Set());
                                }}
                                className="text-slate-500 hover:text-white transition-colors p-1"
                            >
                                <span className="text-lg leading-none">×</span>
                            </button>
                        </div>
                    </div>

                    {/* Page grid */}
                    <div className="flex-1 overflow-y-auto p-3 min-h-0">
                        {isLoadingThumbnails && organizePages.length === 0 ? (
                            <div className="flex flex-col items-center justify-center gap-3 h-full">
                                <Loader2 className="w-8 h-8 text-teal-400 animate-spin" />
                                <p className="text-xs text-slate-400">جاري تحميل الصفحات...</p>
                            </div>
                        ) : (
                            <div
                                ref={pageGridRef}
                                className="grid grid-cols-3 gap-2"
                            >
                                {organizePages.map((page, index) => (
                                    <div
                                        key={page.id}
                                        onPointerDown={(e) => handlePagePointerDown(e, index, page.id)}
                                        className={`
                                            group relative aspect-[3/4] rounded-lg border overflow-hidden cursor-grab select-none
                                            transition-all duration-150
                                            ${draggingPageId === page.id ? 'opacity-30' : ''}
                                            ${selectedPageIds.has(page.id)
                                                ? 'border-teal-400 ring-1 ring-teal-400/50 bg-teal-500/10'
                                                : 'border-white/10 bg-slate-800/50 hover:border-teal-500/30'
                                            }
                                        `}
                                    >
                                        <img
                                            src={page.thumbnailUrl}
                                            className="w-full h-full object-contain pointer-events-none"
                                            draggable={false}
                                        />
                                        {/* Page number */}
                                        <div className="absolute bottom-1 left-1 bg-black/70 text-[9px] text-slate-300 px-1.5 py-0.5 rounded">
                                            {index + 1}
                                        </div>
                                        {/* Selection indicator */}
                                        {selectedPageIds.has(page.id) && (
                                            <div className="absolute top-1 left-1 w-4 h-4 bg-teal-500 rounded-full flex items-center justify-center">
                                                <Check className="w-2.5 h-2.5 text-white" />
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Drop zone for adding new PDFs */}
                    <div
                        className="px-3 pb-3 shrink-0"
                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onDrop={handleOrganizeFileDrop}
                    >
                        <div className="h-12 border-2 border-dashed border-slate-700 rounded-xl flex items-center justify-center hover:border-teal-500/30 transition-colors">
                            <span className="text-[11px] text-slate-500">اسحب ملف PDF لإضافة صفحاته</span>
                        </div>
                    </div>

                    {/* Confirmation dialog for adding file */}
                    {pendingAddFile && (
                        <div className="absolute inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center">
                            <div className="bg-slate-800 rounded-xl p-5 max-w-[260px] text-center border border-white/10 shadow-2xl">
                                <FileText className="w-8 h-8 text-teal-400 mx-auto mb-3" />
                                <p className="text-sm text-white font-semibold mb-1">إضافة صفحات</p>
                                <p className="text-xs text-slate-400 mb-4 break-all">
                                    هل تريد إضافة صفحات من "{pendingAddFile.name}"؟
                                </p>
                                <div className="flex gap-2">
                                    <button
                                        onClick={handleConfirmAddFile}
                                        className="flex-1 py-2 bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold rounded-lg transition-colors"
                                    >
                                        إضافة
                                    </button>
                                    <button
                                        onClick={() => setPendingAddFile(null)}
                                        className="flex-1 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs rounded-lg transition-colors"
                                    >
                                        إلغاء
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Processing overlay within organize */}
                    {isProcessing && (
                        <div className="absolute inset-0 z-[150] bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-4">
                            <Loader2 className="w-10 h-10 text-teal-400 animate-spin" />
                            <p className="text-sm font-semibold text-slate-200">{processingLabel}</p>
                        </div>
                    )}
                </div>
            )}

            {/* ── SERVICE PICKER POPUP (on first file drop) ──────── */}
            {showServicePicker && (
                <div
                    className="absolute inset-0 z-[200] bg-black/50 backdrop-blur-sm flex items-center justify-center rounded-2xl"
                    onClick={() => setShowServicePicker(false)}
                >
                    <div
                        className="bg-slate-800 rounded-2xl p-5 w-[240px] border border-white/10 shadow-2xl"
                        onClick={e => e.stopPropagation()}
                    >
                        <p className="text-sm text-white font-bold text-center mb-4">اختر الخدمة</p>
                        <div className="grid grid-cols-2 gap-2">
                            {([
                                { id: 'merge' as PdfSubtool, label: 'دمج', Icon: Layers },
                                { id: 'organize' as PdfSubtool, label: 'تنظيم', Icon: LayoutGrid },
                                { id: 'compress' as PdfSubtool, label: 'ضغط', Icon: Minimize2 },
                                { id: 'convert' as PdfSubtool, label: 'تحويل', Icon: FileOutput },
                            ]).map(s => (
                                <button
                                    key={s.id}
                                    onClick={() => {
                                        setActiveSubtool(s.id);
                                        setShowServicePicker(false);
                                        if (s.id === 'organize') handleOpenOrganize();
                                    }}
                                    className="flex flex-col items-center gap-2 p-3 rounded-xl bg-slate-700/50 hover:bg-teal-600/20 border border-white/5 hover:border-teal-500/30 text-slate-300 hover:text-teal-300 transition-all"
                                >
                                    <s.Icon className="w-5 h-5" />
                                    <span className="text-xs font-bold">{s.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Drag-over block overlay when processing */}
            {isProcessing && isDragOver && !isOrganizeOpen && (
                <div className="absolute inset-0 bg-slate-900/80 backdrop-blur-sm flex items-center justify-center rounded-2xl pointer-events-none">
                    <p className="text-sm text-slate-400">يُرجى الانتظار حتى اكتمال المعالجة</p>
                </div>
            )}
        </div>
    );
};
