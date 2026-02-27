import React from 'react';
import { ToolsGallery } from './ToolsGallery';
import { useElectron } from '../hooks/useElectron';
import { ToolId } from '../types';

export const GalleryApp: React.FC = () => {
    const { activeToolIds, installedToolIds, installProgress, isDockEnabled, dispatch, closeGallery, startToolDrag, endToolDrag, onDockToolDragActive, onDockToolDragEnd } = useElectron();

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
            installedToolIds={installedToolIds}
            installProgress={installProgress}
            onClose={closeGallery}
            onDragStart={(toolId) => {
                startToolDrag(toolId);
            }}
            onDragEnd={() => {
                endToolDrag();
            }}
            onToolUninstall={handleRemoveTool}
            onAddTool={handleAddTool}
            onInstallTool={(toolId) => dispatch('INSTALL_TOOL', toolId)}
            onUninstallTool={(toolId) => dispatch('UNINSTALL_TOOL', toolId)}
            isDockEnabled={isDockEnabled}
            onToggleDock={handleToggleDock}
            onClearData={() => dispatch('CLEAR_SESSIONS')}
            onDockToolDragActive={onDockToolDragActive}
            onDockToolDragEnd={onDockToolDragEnd}
        />
    );
};
