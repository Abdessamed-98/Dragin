import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { HardDrive, Plus, QrCode, ScanLine, Download, X, LayoutList, LayoutGrid, Trash2 } from 'lucide-react';
import type { Peer, SharedFile, SavedPeer, Space, SpaceFile } from './types';
import { DropZone } from './components/DropZone';
import { FileList } from './components/FileList';
import { PeerBar } from './components/PeerBar';
import { QRPairModal } from './components/QRPairModal';
import { SpaceSidebar } from './components/SpaceSidebar';
import { SpaceSettings } from './components/SpaceSettings';
import { SpacePickerModal } from './components/SpacePickerModal';
import { getSpaceAPI, isElectron, isCapacitor } from './services/platform';
import type { ConnectionInfo } from './services/platform';

function App() {
  const api = useMemo(() => getSpaceAPI(), []);
  const mobile = isCapacitor();

  const [peers, setPeers] = useState<Peer[]>([]);
  const [files, setFiles] = useState<SharedFile[]>([]); // v1 flat list (kept for backward compat)
  const [deviceName, setDeviceName] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [showQRModal, setShowQRModal] = useState<'qr' | 'scanner' | null>(null);
  const [connectionInfo, setConnectionInfo] = useState<ConnectionInfo | null>(null);
  const [downloads, setDownloads] = useState<Map<string, number>>(new Map());
  const [savedPeers, setSavedPeers] = useState<SavedPeer[]>([]);
  const [filter, setFilter] = useState<string>('all'); // 'all' | 'mine' | 'other' | deviceId
  const [savedFiles, setSavedFiles] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('space-saved');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
    if (!mobile) return 'grid';
    try {
      const stored = localStorage.getItem('space-view-mode');
      return (stored === 'list' || stored === 'grid') ? stored : 'list';
    } catch { return 'list'; }
  });

  // Space state (v2)
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState('');
  const [spaceSettingsTarget, setSpaceSettingsTarget] = useState<Space | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [spaceFilesMap, setSpaceFilesMap] = useState<Map<string, SpaceFile[]>>(new Map()); // spaceId → files
  const [spacePickerFiles, setSpacePickerFiles] = useState<{ name: string; path: string; size: number; mimeType: string }[] | null>(null); // pending files for space picker
  const activeSpaceIdRef = useRef(activeSpaceId);
  activeSpaceIdRef.current = activeSpaceId;

  const isDownloading = Array.from(downloads.values()).some(p => p >= 0);

  const handleSetViewMode = useCallback((mode: 'list' | 'grid') => {
    setViewMode(mode);
    localStorage.setItem('space-view-mode', mode);
  }, []);

  const [pairPin, setPairPin] = useState<string | null>(null);

  // Fetch connection info on desktop (for QR code + PIN)
  const handleShowQR = useCallback(async () => {
    if (isElectron()) {
      const info = await api.getConnectionInfo();
      setConnectionInfo(info);
      const pin = await api.generatePairPin();
      setPairPin(pin);
      setShowQRModal('qr');
    }
  }, [api]);

  const handleShowScanner = useCallback(() => {
    setShowQRModal('scanner');
  }, []);

  const handleCloseModal = useCallback(() => {
    setShowQRModal(null);
    if (pairPin && isElectron()) {
      api.clearPairPin();
      setPairPin(null);
    }
  }, [api, pairPin]);

  const handleQRScanned = useCallback(async (info: ConnectionInfo) => {
    setShowQRModal(null);
    if (pairPin && isElectron()) {
      api.clearPairPin();
      setPairPin(null);
    }
    try {
      const { connectToPeer } = await import('./services/mobileNet');
      connectToPeer({
        id: info.id,
        name: info.name,
        ip: info.ip,
        port: info.port,
        platform: 'win32',
      });
    } catch (err) {
      console.error('[App] Failed to connect after scan:', err);
    }
  }, [api, pairPin]);

  // --- Download management ---
  const startDownload = useCallback((file: SharedFile, peer: Peer) => {
    if (downloads.has(file.id) || savedFiles.has(file.id)) return; // Already downloading or saved

    setDownloads(prev => new Map(prev).set(file.id, 0));

    api.downloadFile(file.id, file.name, peer.id, peer.ip, peer.port, (progress) => {
      setDownloads(prev => {
        const next = new Map(prev);
        if (next.has(file.id)) next.set(file.id, progress);
        return next;
      });
    }).then(() => {
      // Mark as permanently saved
      setDownloads(prev => {
        const next = new Map(prev);
        next.delete(file.id);
        return next;
      });
      setSavedFiles(prev => {
        const next = new Set(prev);
        next.add(file.id);
        localStorage.setItem('space-saved', JSON.stringify([...next]));
        return next;
      });
    }).catch((err) => {
      console.error('[App] Download failed:', err);
      setDownloads(prev => {
        const next = new Map(prev);
        next.delete(file.id);
        return next;
      });
    });
  }, [api, downloads, savedFiles]);

  const abortDownload = useCallback((fileId: string) => {
    api.abortDownload(fileId);
    setDownloads(prev => {
      const next = new Map(prev);
      next.delete(fileId);
      return next;
    });
  }, [api]);

  // Space actions (v2)
  const handleCreateSpace = useCallback(async (name: string) => {
    const space = await api.createSpace(name);
    setActiveSpaceId(space.id);
  }, [api]);

  const handleDeleteSpace = useCallback(async (spaceId: string) => {
    await api.deleteSpace(spaceId);
  }, [api]);

  const handleRenameSpace = useCallback(async (spaceId: string, newName: string) => {
    await api.renameSpace(spaceId, newName);
  }, [api]);

  const handleToggleAutoPin = useCallback(async (spaceId: string, autoPin: boolean) => {
    await api.setSpaceAutoPin(spaceId, autoPin);
  }, [api]);

  const handlePinFile = useCallback(async (fileId: string) => {
    await api.pinFile(fileId);
  }, [api]);

  const handleUnpinFile = useCallback(async (fileId: string) => {
    await api.unpinFile(fileId);
  }, [api]);

  const activeSpace = spaces.find(s => s.id === activeSpaceId);

  // Use per-space files when available, fallback to v1 flat list
  const activeSpaceFiles: (SharedFile & { available?: boolean; pinned?: boolean | null })[] = useMemo(() => {
    const sf = spaceFilesMap.get(activeSpaceId);
    if (sf && sf.length > 0) {
      // Map SpaceFile → SharedFile-compatible shape (addedAt → uploadedAt)
      return sf.map(f => ({
        ...f,
        uploadedAt: f.addedAt,
      }));
    }
    // Fallback: v1 flat file list (before space-files are loaded)
    return files;
  }, [spaceFilesMap, activeSpaceId, files]);

  const spaceFileCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const space of spaces) {
      counts.set(space.id, spaceFilesMap.get(space.id)?.length ?? 0);
    }
    return counts;
  }, [spaces, spaceFilesMap]);

  const downloadAll = useCallback(() => {
    const remoteFiles = activeSpaceFiles.filter(f => f.deviceId !== deviceId && f.available !== false);
    for (const file of remoteFiles) {
      if (downloads.has(file.id) || savedFiles.has(file.id)) continue;
      const peer = peers.find(p => p.id === file.deviceId);
      if (peer) startDownload(file, peer);
    }
  }, [activeSpaceFiles, deviceId, peers, downloads, savedFiles, startDownload]);

  const handleRemovePeer = useCallback((peerId: string) => {
    api.removeSavedPeer(peerId);
    setSavedPeers(prev => prev.filter(p => p.id !== peerId));
  }, [api]);

  const cancelAll = useCallback(() => {
    for (const fileId of downloads.keys()) {
      api.abortDownload(fileId);
    }
    setDownloads(new Map());
  }, [api, downloads]);

  const clearSpace = useCallback(() => {
    const localFileIds = activeSpaceFiles.filter(f => f.deviceId === deviceId).map(f => f.id);
    for (const fileId of localFileIds) {
      api.removeFile(fileId);
    }
  }, [api, activeSpaceFiles, deviceId]);

  useEffect(() => {
    api.getDeviceInfo().then((info) => {
      setDeviceName(info.name);
      setDeviceId(info.id);
    });

    // Fetch connection info on desktop for image preview URLs
    if (isElectron()) {
      api.getConnectionInfo().then((info) => setConnectionInfo(info));
    }

    api.onPeersUpdate((updatedPeers) => {
      setPeers(updatedPeers);
    });

    api.onFilesUpdate((updatedFiles) => {
      setFiles(updatedFiles);
    });

    // Saved peers
    api.getSavedPeers().then(setSavedPeers);
    api.onSavedPeersUpdate(setSavedPeers);

    // Load spaces (v2)
    api.getSpaces().then((s) => {
      setSpaces(s);
      if (s.length > 0 && !activeSpaceId) setActiveSpaceId(s[0].id);
      // Load files for each space
      for (const space of s) {
        api.getSpaceFiles(space.id).then((sf) => {
          setSpaceFilesMap(prev => {
            const next = new Map(prev);
            next.set(space.id, sf);
            return next;
          });
        });
      }
    });
    api.onSpacesUpdate((s) => {
      setSpaces(s);
      // Auto-select first space if none selected
      setActiveSpaceId(prev => {
        if (!prev && s.length > 0) return s[0].id;
        if (prev && !s.find(sh => sh.id === prev) && s.length > 0) return s[0].id;
        return prev;
      });
      // Load files for any new spaces
      for (const space of s) {
        api.getSpaceFiles(space.id).then((sf) => {
          setSpaceFilesMap(prev => {
            const next = new Map(prev);
            next.set(space.id, sf);
            return next;
          });
        });
      }
    });
    // Per-space file updates
    api.onSpaceFilesUpdate(({ spaceId, files: sf }) => {
      setSpaceFilesMap(prev => {
        const next = new Map(prev);
        next.set(spaceId, sf);
        return next;
      });
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

    await api.addFilesToSpace(activeSpaceIdRef.current, fileData);
  }, [api]);

  const addFilesToActiveSpace = useCallback(async (fileData: { name: string; path: string; size: number; mimeType: string }[]) => {
    await api.addFilesToSpace(activeSpaceIdRef.current, fileData);
  }, [api]);

  const handleAddFiles = useCallback(async () => {
    const picked = await api.pickFiles();
    if (!picked || picked.length === 0) return;

    // On mobile with 2+ spaces, show the space picker
    if (mobile && spaces.length > 1) {
      setSpacePickerFiles(picked);
      return;
    }

    await addFilesToActiveSpace(picked);
  }, [api, mobile, spaces, addFilesToActiveSpace]);

  const handleSpacePicked = useCallback(async (spaceId: string) => {
    if (spacePickerFiles) {
      await api.addFilesToSpace(spaceId, spacePickerFiles);
      setSpacePickerFiles(null);
    }
  }, [api, spacePickerFiles]);

  const remoteCount = activeSpaceFiles.filter((f) => f.deviceId !== deviceId).length;
  const localCount = activeSpaceFiles.length - remoteCount;
  const hasFiles = activeSpaceFiles.length > 0;

  // Build unique device list for filter tags
  const devices = useMemo(() => {
    const map = new Map<string, string>(); // deviceId -> deviceName
    for (const f of activeSpaceFiles) {
      if (!map.has(f.deviceId)) {
        map.set(f.deviceId, f.deviceId === deviceId ? (deviceName || 'You') : f.deviceName);
      }
    }
    return map;
  }, [activeSpaceFiles, deviceId, deviceName]);

  // Filter files
  const filteredFiles = useMemo(() => {
    if (filter === 'all') return activeSpaceFiles;
    if (filter === 'other') return activeSpaceFiles.filter(f => f.deviceId !== deviceId);
    return activeSpaceFiles.filter(f => f.deviceId === filter);
  }, [activeSpaceFiles, filter, deviceId]);

  // Reset filter if selected device disappears
  useEffect(() => {
    if (filter !== 'all' && filter !== 'other' && !devices.has(filter)) {
      setFilter('all');
    }
  }, [filter, devices]);

  // Only attach drag handlers on desktop
  const dragProps = isElectron() ? {
    onDragOver: handleDragOver,
    onDragLeave: handleDragLeave,
    onDrop: handleDrop,
  } : {};

  // Filter pill classes (bigger tap targets on mobile)
  const filterPill = (active: boolean) =>
    `px-2.5 ${mobile ? 'py-1.5 text-xs' : 'py-1 text-[11px]'} rounded-full font-medium whitespace-nowrap transition-colors ${
      active ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
    }`;

  // View toggle buttons (reused in two places)
  const viewToggle = (
    <div className="flex items-center gap-1 flex-shrink-0">
      <button
        onClick={() => handleSetViewMode('list')}
        className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}
        aria-label="List view"
      >
        <LayoutList className="w-4 h-4" />
      </button>
      <button
        onClick={() => handleSetViewMode('grid')}
        className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}
        aria-label="Grid view"
      >
        <LayoutGrid className="w-4 h-4" />
      </button>
    </div>
  );

  return (
    <div
      className="h-screen flex flex-col select-none"
      style={{ paddingTop: mobile ? 'var(--sat)' : undefined }}
      {...dragProps}
    >
      {/* Header */}
      <header className={`flex items-center justify-between px-4 py-3 border-b border-slate-700/50 bg-slate-900/80 backdrop-blur-sm ${mobile ? 'pt-2 pb-2' : ''}`}>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-lg bg-blue-500/10">
            <HardDrive className="w-4 h-4 text-blue-400" />
          </div>
          <div className="min-w-0">
            <h1 className="text-sm font-semibold leading-tight">Dragin Space</h1>
            <p className="text-[11px] text-slate-500 leading-tight truncate">
              {activeSpaceFiles.length === 0
                ? 'No files'
                : `${activeSpaceFiles.length} file${activeSpaceFiles.length !== 1 ? 's' : ''}${remoteCount > 0 ? ` (${remoteCount} remote)` : ''}`
              }
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Mobile: view toggle + clear in header */}
          {mobile && hasFiles && viewToggle}
          {mobile && localCount > 0 && (
            <button
              onClick={clearSpace}
              className="p-1.5 rounded-lg bg-slate-800 active:bg-red-600 transition-colors"
              title="Clear space"
            >
              <Trash2 className="w-4 h-4 text-slate-400" />
            </button>
          )}
          {/* Desktop-only controls */}
          {!mobile && <PeerBar peers={peers} savedPeers={savedPeers} onRemovePeer={handleRemovePeer} />}
          {!mobile && hasFiles && (
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
          {!mobile && localCount > 0 && (
            <button
              onClick={clearSpace}
              className="p-1.5 rounded-lg hover:bg-red-600/80 transition-colors"
              title="Clear space"
            >
              <Trash2 className="w-4 h-4 text-slate-400" />
            </button>
          )}
          {!mobile && remoteCount > 0 && (
            <>
              <div className="h-4 w-px bg-slate-700" />
              {isDownloading ? (
                <button
                  onClick={cancelAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-medium transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  Cancel
                </button>
              ) : (
                <button
                  onClick={downloadAll}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-medium transition-colors"
                >
                  <Download className="w-3.5 h-3.5" />
                  All
                </button>
              )}
            </>
          )}
          {!mobile && (
            <>
              <div className="h-4 w-px bg-slate-700" />
              <button
                onClick={handleShowQR}
                className="p-1.5 rounded-lg hover:bg-slate-700 transition-colors"
                title="Show QR code for mobile"
              >
                <QrCode className="w-4 h-4 text-slate-400" />
              </button>
              <span className="text-xs text-slate-500">{deviceName}</span>
            </>
          )}
        </div>
      </header>

      {/* Peers bar on mobile — below header */}
      {mobile && (peers.length > 0 || savedPeers.length > 0) && (
        <div className="px-4 py-2 border-b border-slate-700/50 bg-slate-900/50">
          <PeerBar peers={peers} savedPeers={savedPeers} onRemovePeer={handleRemovePeer} mobile />
        </div>
      )}

      {/* Mobile space selector (horizontal scroll) — always shown */}
      {mobile && spaces.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700/50 bg-slate-900/50 overflow-x-auto scrollbar-hide flex-shrink-0">
          {spaces.map((space) => (
            <button
              key={space.id}
              onClick={() => {
                if (space.id === activeSpaceId) {
                  setSpaceSettingsTarget(space);
                } else {
                  setActiveSpaceId(space.id);
                }
              }}
              onContextMenu={(e) => { e.preventDefault(); setSpaceSettingsTarget(space); }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                space.id === activeSpaceId
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-400 active:bg-slate-700'
              }`}
            >
              {space.name}
              {(spaceFileCounts.get(space.id) ?? 0) > 0 && (
                <span className="ml-1.5 text-[10px] opacity-70">{spaceFileCounts.get(space.id)}</span>
              )}
            </button>
          ))}
          <button
            onClick={() => {
              const name = prompt('New space name');
              if (name?.trim()) handleCreateSpace(name.trim());
            }}
            className="px-2.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap bg-slate-800 text-slate-500 active:bg-slate-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main content with optional sidebar */}
      <div className="flex-1 min-h-0 overflow-hidden flex">
        {/* Space sidebar (desktop only, when 2+ spaces) */}
        {!mobile && spaces.length > 0 && (
          <SpaceSidebar
            spaces={spaces}
            activeSpaceId={activeSpaceId}
            onSelect={setActiveSpaceId}
            onCreate={handleCreateSpace}
            onSettings={(space) => setSpaceSettingsTarget(space)}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(prev => !prev)}
            spaceFileCounts={spaceFileCounts}
          />
        )}

      <main className="flex-1 min-h-0 overflow-hidden flex flex-col relative">
        {/* Drag overlay — shown when dragging over the window (desktop only) */}
        {isDragging && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/90 backdrop-blur-sm border-2 border-dashed border-blue-400 rounded-lg m-2">
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 rounded-2xl bg-blue-500/20 flex items-center justify-center">
                <Plus className="w-8 h-8 text-blue-400" />
              </div>
              <p className="text-lg font-medium text-blue-300">
                {activeSpace ? `Drop files to ${activeSpace.name}` : 'Drop files to share'}
              </p>
            </div>
          </div>
        )}

        {hasFiles ? (
          <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
            {/* Filter tags + view toggle */}
            {devices.size > 1 && (
              <div className={`flex items-center gap-1.5 px-4 pt-3 pb-1 overflow-x-auto flex-shrink-0 scrollbar-hide`}>
                <button onClick={() => setFilter('all')} className={filterPill(filter === 'all')}>
                  All ({activeSpaceFiles.length})
                </button>
                {remoteCount > 0 && (
                  <button onClick={() => setFilter('other')} className={filterPill(filter === 'other')}>
                    Others ({remoteCount})
                  </button>
                )}
                {Array.from(devices.entries()).map(([id, name]) => (
                  <button
                    key={id}
                    onClick={() => setFilter(id)}
                    className={filterPill(filter === id)}
                  >
                    {id === deviceId ? 'Mine' : name} ({activeSpaceFiles.filter(f => f.deviceId === id).length})
                  </button>
                ))}
              </div>
            )}

            <div className="flex-1 min-h-0 overflow-hidden p-4 pt-2">
              <FileList
                files={filteredFiles}
                peers={peers}
                deviceId={deviceId}
                localServer={connectionInfo}
                downloads={downloads}
                savedFiles={savedFiles}
                onDownload={startDownload}
                onAbortDownload={abortDownload}
                onPin={handlePinFile}
                onUnpin={handleUnpinFile}
                viewMode={mobile ? viewMode : 'grid'}
                mobile={mobile}
              />
            </div>
          </div>
        ) : (
          <DropZone onAddFiles={handleAddFiles} onScan={mobile ? handleShowScanner : undefined} mobile={mobile} spaceName={activeSpace?.name} />
        )}
      </main>
      </div>

      {/* Mobile bottom action bar */}
      {mobile && (
        <div
          className="flex-shrink-0 flex items-center justify-center gap-3 px-4 py-3 border-t border-slate-700/50 bg-slate-900"
          style={{ paddingBottom: 'var(--sab)' }}
        >
          <button
            onClick={handleAddFiles}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 active:bg-blue-700 text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Files
          </button>

          {peers.length === 0 && (
            <button
              onClick={handleShowScanner}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-700 active:bg-slate-600 text-sm font-medium transition-colors"
            >
              <ScanLine className="w-4 h-4" />
              Scan
            </button>
          )}

          {remoteCount > 0 && (
            isDownloading ? (
              <button
                onClick={cancelAll}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-red-600 active:bg-red-700 text-sm font-medium transition-colors"
              >
                <X className="w-4 h-4" />
                Cancel
              </button>
            ) : (
              <button
                onClick={downloadAll}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-600 active:bg-emerald-700 text-sm font-medium transition-colors"
              >
                <Download className="w-4 h-4" />
                Save All
              </button>
            )
          )}
        </div>
      )}

      {/* Space Settings Modal */}
      {spaceSettingsTarget && (
        <SpaceSettings
          space={spaceSettingsTarget}
          onRename={handleRenameSpace}
          onToggleAutoPin={handleToggleAutoPin}
          onDelete={handleDeleteSpace}
          onClose={() => setSpaceSettingsTarget(null)}
        />
      )}

      {/* QR Pair Modal */}
      {showQRModal && (
        <QRPairModal
          mode={showQRModal}
          connectionInfo={connectionInfo}
          pairPin={pairPin}
          onScanned={handleQRScanned}
          onClose={handleCloseModal}
        />
      )}

      {/* Space Picker Modal (mobile, 2+ spaces) */}
      {spacePickerFiles && (
        <SpacePickerModal
          spaces={spaces}
          onSelect={handleSpacePicked}
          onClose={() => setSpacePickerFiles(null)}
        />
      )}
    </div>
  );
}

export default App;
