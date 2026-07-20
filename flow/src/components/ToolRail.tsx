/**
 * Tool rail — minimized tool icons shown along the screen-edge side of the open
 * panel. Click = switch the open tool in place; the file session carries over
 * (results travel forward). Tools that can't operate on the current session
 * are dimmed. The active tool is ringed in its own color.
 */
import React from 'react';
import { ToolId } from '../types';
import type { DockEdge } from './SideDock';
import { useLocalizedTools } from '../i18n/useLocalizedTools';
import { useSession } from '../state/sessionStore';
import { canSwitchTo } from '../state/toolCompat';

interface ToolRailProps {
    edge: DockEdge;
    activeToolIds: ToolId[];
    expandedToolId: ToolId;
    onSwitch: (toolId: ToolId) => void;
}

export const RAIL_W = 48;

export const ToolRail: React.FC<ToolRailProps> = ({ edge, activeToolIds, expandedToolId, onSwitch }) => {
    const ALL_TOOLS = useLocalizedTools();
    const { files } = useSession();
    const isVertical = edge === 'right' || edge === 'left';

    const tools = activeToolIds
        .map(id => ALL_TOOLS.find(t => t.id === id))
        .filter((t): t is NonNullable<typeof t> => t != null);

    // Tooltip side faces the panel (away from the screen edge).
    const tipSide: React.CSSProperties = ({
        right: { right: RAIL_W + 4, top: '50%', transform: 'translateY(-50%)' },
        left: { left: RAIL_W + 4, top: '50%', transform: 'translateY(-50%)' },
        top: { top: RAIL_W + 4, left: '50%', transform: 'translateX(-50%)' },
        bottom: { bottom: RAIL_W + 4, left: '50%', transform: 'translateX(-50%)' },
    } as const)[edge];

    return (
        <div
            className={`flex ${isVertical ? 'flex-col' : 'flex-row'} items-center justify-center gap-1.5 h-full w-full`}
            data-interactive
        >
            {tools.map(tool => {
                const Icon = tool.icon;
                const isActive = tool.id === expandedToolId;
                const enabled = isActive || canSwitchTo(tool.id, files);
                return (
                    <button
                        key={tool.id}
                        onClick={() => { if (enabled && !isActive) onSwitch(tool.id); }}
                        className={`relative group/rail w-9 h-9 shrink-0 rounded-[10px] grid place-items-center transition-all duration-150 border
                            ${isActive
                                ? `bg-${tool.colorClass}-500/15 border-${tool.colorClass}-500/50 text-${tool.colorClass}-400`
                                : enabled
                                    ? 'border-transparent text-[var(--text-3)] hover:text-[var(--text)] hover:bg-[var(--surface-3)] cursor-pointer'
                                    : 'border-transparent text-[var(--text-3)] opacity-25 cursor-not-allowed'}`}
                    >
                        <Icon className="w-[18px] h-[18px]" />
                        {/* tooltip toward the panel */}
                        <span
                            className="absolute px-2 py-1 rounded-md bg-black/85 border border-[var(--border)] text-[10.5px] font-medium text-[var(--text)] whitespace-nowrap opacity-0 group-hover/rail:opacity-100 pointer-events-none transition-opacity z-50"
                            style={tipSide}
                        >
                            {tool.title}
                        </span>
                    </button>
                );
            })}
        </div>
    );
};
