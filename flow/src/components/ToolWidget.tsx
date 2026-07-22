import React, { DragEvent } from 'react';
import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';
import { ActiveSession, ToolId, SessionItem } from '../types';

// Every tool now renders via the shell (ToolShell). ToolWidget is just the
// collapsed rail tile: an icon + optional badge, with file-drop + click-to-open.
// (Its old expanded/session UI was retired when the shell migration completed.)
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
    onProcessIdle?: () => void;
    /** Count shown on the collapsed tile (session badge, computed by DockApp). */
    badgeCount?: number;
    instantContent?: boolean;
    onOpenSettings?: () => void;
    externalDragHover?: boolean;
    /** When true, the parent SideDock wrapper handles all file drag events. */
    externalDragHandled?: boolean;
    otherToolCount?: number;
    clearGen?: number;
    compressorQuality?: number;
    onRecompress?: (quality: number) => void;
    isModelLoading?: boolean;
    onCancelProcessing?: () => void;
    emptyHint?: string;
    emptySubHint?: string;
    formatLines?: string[];
    onSelfItemCountChange?: (count: number) => void;
}

export const ToolWidget: React.FC<ToolWidgetProps> = ({
    id,
    icon: Icon,
    colorClass,
    isExpanded,
    isDockVisible,
    onDrop,
    onExpand,
    badgeCount = 0,
    externalDragHover = false,
    externalDragHandled = false,
    isReordering = false,
}) => {
    const isActive = isExpanded;

    // File-drop onto the tile (only when the parent wrapper isn't handling it).
    const handleDragEnter = (e: DragEvent) => { if (externalDragHandled) return; e.preventDefault(); };
    const handleDragLeave = (e: DragEvent) => { if (externalDragHandled) return; e.preventDefault(); };
    const handleDrop = (e: DragEvent) => {
        if (externalDragHandled) return;
        e.stopPropagation();
        if (e.dataTransfer.types.includes('application/x-smart-tool-reorder')) return;
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) onDrop(Array.from(e.dataTransfer.files), id);
    };
    const handleContainerClick = () => { if (isDockVisible && !isActive) onExpand(); };

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
            onDragOver={(e) => { e.preventDefault(); if (!isReordering) e.dataTransfer.dropEffect = 'copy'; }}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleContainerClick}
        >
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
        </motion.div>
    );
};
