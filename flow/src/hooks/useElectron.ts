import { useEffect, useState, useCallback } from 'react';
import { ActiveSession, InstallProgress, ToolId } from '../types';

// Define the shape of the state managed by Main Process
interface AppState {
    activeToolIds: ToolId[];
    installedToolIds: ToolId[];
    installProgress: Record<string, InstallProgress>;
    sessions: Record<string, ActiveSession | undefined>;
    isDockEnabled: boolean;
    isGalleryOpen: boolean;
    isDockPinned: boolean;
}

// Define the Electron Bridge interface (must match preload.js)
interface ElectronBridge {
    onStateUpdate: (callback: (state: AppState) => void) => void;
    onDockHover: (callback: (active: boolean) => void) => void;
    dispatch: (action: { type: string; payload?: any }) => void;
    openGallery: () => void;
    closeGallery: () => void;
    setIgnoreMouseEvents: (ignore: boolean, options?: { forward: boolean }) => void;
    resizeDock: (width: number) => void;
    sendDockMode: (mode: 'idle' | 'active') => void;
    ready: () => void;
    onClearDataConfirmed: (callback: () => void) => void;

    // Shelf persistence
    shelfSave: (id: string, buffer: ArrayBuffer, name: string) => Promise<string>;
    shelfLoad: () => Promise<Array<{ id: string; name: string; url: string }>>;
    shelfDelete: (itemIds: string[]) => Promise<void>;

    // Native file drag-out
    startNativeDrag: (payload: { items: Array<{ id: string; name: string; dataUrl: string | null; filePath: string | null }> }) => void;

    // System clipboard — CF_HDROP based (works like Windows Explorer)
    clipboardWrite: (items: Array<{ dataUrl: string; name: string }>) => Promise<boolean>;
    clipboardRead: () => Promise<Array<{ dataUrl: string; name: string }>>;

    // Logs
    openLogsFolder: () => Promise<void>;

    // Settings (language, etc.)
    getSetting: (key: string) => Promise<any>;
    setSetting: (key: string, value: any) => Promise<void>;
    onLanguageChange: (callback: (lang: string) => void) => void;
    onSettingChange: (callback: (data: { key: string; value: any }) => void) => void;
}

declare global {
    interface Window {
        electron?: ElectronBridge;
    }
}

export const useElectron = () => {
    const [state, setState] = useState<AppState>({
        activeToolIds: ['compressor', 'shelf', 'palette'], // Default fallback
        installedToolIds: ['compressor', 'cropper', 'vectorizer', 'pdf', 'metadata', 'watermark', 'palette', 'shelf'],
        installProgress: {},
        sessions: {},
        isDockEnabled: true,
        isGalleryOpen: false,
        isDockPinned: false
    });

    const [isHovered, setIsHovered] = useState(false);

    useEffect(() => {
        if (!window.electron) return;

        // Listen for state updates from Main
        window.electron.onStateUpdate((newState) => {
            setState(newState);
        });

        // Listen for hover events (Main process detecting mouse edge)
        window.electron.onDockHover((active) => {
            setIsHovered(active);
        });

        // Notify Main that we are ready
        window.electron.ready();

    }, []);

    const dispatch = useCallback((type: string, payload?: any) => {
        if (window.electron) {
            window.electron.dispatch({ type, payload });
        } else {
            console.warn("Electron IPC not available (Dispatch)", type, payload);
        }
    }, []);

    const openGallery = useCallback(() => {
        window.electron?.openGallery();
    }, []);

    const closeGallery = useCallback(() => {
        window.electron?.closeGallery();
    }, []);

    const setIgnoreMouseEvents = useCallback((ignore: boolean, options?: { forward: boolean }) => {
        window.electron?.setIgnoreMouseEvents(ignore, options);
    }, []);

    const resizeDock = useCallback((width: number) => {
        window.electron?.resizeDock(width);
    }, []);

    const sendDockMode = useCallback((mode: 'idle' | 'active') => {
        window.electron?.sendDockMode(mode);
    }, []);

    const onClearDataConfirmed = useCallback((callback: () => void) => {
        window.electron?.onClearDataConfirmed(callback);
    }, []);

    // --- Shelf persistence ---
    const shelfSave = useCallback((id: string, buffer: ArrayBuffer, name: string): Promise<string> => {
        if (window.electron?.shelfSave) return window.electron.shelfSave(id, buffer, name);
        return Promise.resolve(URL.createObjectURL(new Blob([buffer])));
    }, []);

    const shelfLoad = useCallback((): Promise<Array<{ id: string; name: string; url: string }>> => {
        if (window.electron?.shelfLoad) return window.electron.shelfLoad();
        return Promise.resolve([]);
    }, []);

    const shelfDelete = useCallback((itemIds: string[]): Promise<void> => {
        if (window.electron?.shelfDelete) return window.electron.shelfDelete(itemIds);
        return Promise.resolve();
    }, []);

    const openLogsFolder = useCallback(() => {
        window.electron?.openLogsFolder();
    }, []);

    return {
        ...state,
        isHovered, // From Main Process uIOhook
        dispatch,
        openGallery,
        closeGallery,
        setIgnoreMouseEvents,
        resizeDock,
        sendDockMode,
        onClearDataConfirmed,
        // Shelf
        shelfSave,
        shelfLoad,
        shelfDelete,
        // Logs
        openLogsFolder,
    };
};
