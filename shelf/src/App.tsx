import { useState, useEffect, useCallback, useMemo } from 'react';
import { HardDrive, Plus } from 'lucide-react';
import type { Peer, SharedFile } from './types';
import { DropZone } from './components/DropZone';
import { FileList } from './components/FileList';
import { PeerBar } from './components/PeerBar';
import { getShelfAPI, isElectron } from './services/platform';

function App() {
  const api = useMemo(() => getShelfAPI(), []);

  const [peers, setPeers] = useState<Peer[]>([]);
  const [files, setFiles] = useState<SharedFile[]>([]);
  const [deviceName, setDeviceName] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    api.getDeviceInfo().then((info) => {
      setDeviceName(info.name);
      setDeviceId(info.id);
    });

    api.onPeersUpdate((updatedPeers) => {
      setPeers(updatedPeers);
    });

    api.onFilesUpdate((updatedFiles) => {
      setFiles(updatedFiles);
    });
  }, [api]);

  // Global drag handlers — desktop only (whole window accepts drops)
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.relatedTarget) {
      setIsDragging(false);
    }
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFiles = Array.from(e.dataTransfer.files);
    if (droppedFiles.length === 0) return;

    const fileData = droppedFiles.map((f) => ({
      name: f.name,
      path: api.getFilePath(f),
      size: f.size,
      mimeType: f.type || 'application/octet-stream',
    }));

    await api.addFiles(fileData);
  }, [api]);

  const handleAddFiles = useCallback(async () => {
    const picked = await api.pickFiles();
    if (picked && picked.length > 0) {
      await api.addFiles(picked);
    }
  }, [api]);

  const remoteCount = files.filter((f) => f.deviceId !== deviceId).length;
  const hasFiles = files.length > 0;

  // Only attach drag handlers on desktop
  const dragProps = isElectron() ? {
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
  } : {};

  return (
    <div
      className="h-screen flex flex-col select-none"
      {...dragProps}
    >
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-blue-500/10">
            <HardDrive className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <h1 className="text-sm font-semibold leading-tight">Dragin Shelf</h1>
            <p className="text-[11px] text-slate-500 leading-tight">
              {files.length === 0
                ? 'No files'
                : `${files.length} file${files.length !== 1 ? 's' : ''}${remoteCount > 0 ? ` (${remoteCount} remote)` : ''}`
              }
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <PeerBar peers={peers} />
          {hasFiles && (
            <>
              <div className="h-4 w-px bg-slate-700" />
              <button
                onClick={handleAddFiles}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-medium transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            </>
          )}
          <div className="h-4 w-px bg-slate-700" />
          <span className="text-xs text-slate-500">{deviceName}</span>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 min-h-0 overflow-hidden flex flex-col relative">
        {/* Drag overlay — shown when dragging over the window (desktop only) */}
        {isDragging && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/90 backdrop-blur-sm border-2 border-dashed border-blue-400 rounded-lg m-2">
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-2xl bg-blue-500/20 flex items-center justify-center">
                <Plus className="w-8 h-8 text-blue-400" />
              </div>
              <p className="text-lg font-medium text-blue-300">Drop files to share</p>
            </div>
          </div>
        )}

        {hasFiles ? (
          <div className="flex-1 min-h-0 overflow-hidden p-4">
            <FileList files={files} peers={peers} deviceId={deviceId} />
          </div>
        ) : (
          <DropZone onAddFiles={handleAddFiles} />
        )}
      </main>
    </div>
  );
}

export default App;
