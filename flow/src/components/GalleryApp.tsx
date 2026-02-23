import React from 'react';
import { ToolsGallery } from './ToolsGallery';
import { useElectron } from '../hooks/useElectron';
import { ToolId } from '../types';

export const GalleryApp: React.FC = () => {
    const { activeToolIds, isDockEnabled, dispatch, closeGallery, startToolDrag, endToolDrag, onDockToolDragActive, onDockToolDragEnd } = useElectron();

    const handleAddTool = (toolId: ToolId) => {
        dispatch('ADD_TOOL', toolId);
    };

    const handleRemoveTool = (toolId: ToolId) => {
        dispatch('REMOVE_TOOL', toolId);
    };

    const handleToggleDock = () => {
        dispatch('TOGGLE_DOCK');
    };

    return (
        <ToolsGallery
            activeToolIds={activeToolIds}
            onClose={closeGallery}
            onDragStart={(toolId) => {
                // Send IPC to main process for cross-window drag coordination
                startToolDrag(toolId);
            }}
            onDragEnd={() => {
                // Notify main that gallery drag ended
                endToolDrag();
            }}
            onToolUninstall={handleRemoveTool}
            onAddTool={handleAddTool}
            isDockEnabled={isDockEnabled}
            onToggleDock={handleToggleDock}
            onClearData={() => dispatch('CLEAR_SESSIONS')}
            onDockToolDragActive={onDockToolDragActive}
            onDockToolDragEnd={onDockToolDragEnd}
        />
    );
};
