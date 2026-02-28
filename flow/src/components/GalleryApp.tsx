import React, { useEffect } from 'react';
import { ToolsGallery } from './ToolsGallery';
import { useElectron } from '../hooks/useElectron';
import { ToolId } from '../types';

export const GalleryApp: React.FC = () => {
    const { activeToolIds, installedToolIds, installProgress, isDockEnabled, dispatch, closeGallery, onDockToolDragActive, onDockToolDragEnd, openLogsFolder } = useElectron();

    // Hide splash screen once React has rendered
    useEffect(() => {
        const splash = document.getElementById('splash');
        if (splash) {
            splash.classList.add('hide');
            setTimeout(() => splash.remove(), 300);
        }
    }, []);

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
            onToolUninstall={handleRemoveTool}
            onAddTool={handleAddTool}
            onInstallTool={(toolId) => dispatch('INSTALL_TOOL', toolId)}
            onCancelInstall={(toolId) => dispatch('CANCEL_INSTALL', toolId)}
            onUninstallTool={(toolId) => dispatch('UNINSTALL_TOOL', toolId)}
            isDockEnabled={isDockEnabled}
            onToggleDock={handleToggleDock}
            onClearData={() => dispatch('CLEAR_SESSIONS')}
            onOpenLogs={openLogsFolder}
            onDockToolDragActive={onDockToolDragActive}
            onDockToolDragEnd={onDockToolDragEnd}
        />
    );
};
