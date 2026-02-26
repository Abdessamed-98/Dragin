import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { HardDrive, Plus, QrCode, ScanLine, Download, X, LayoutList, LayoutGrid, Trash2 } from 'lucide-react';
import type { Peer, SharedFile, SavedPeer, Shelf, ShelfFile } from './types';
import { DropZone } from './components/DropZone';
import { FileList } from './components/FileList';
import { PeerBar } from './components/PeerBar';
import { QRPairModal } from './components/QRPairModal';
import { ShelfSidebar } from './components/ShelfSidebar';
import { ShelfSettings } from './components/ShelfSettings';
import { ShelfPickerModal } from './components/ShelfPickerModal';
import { getShelfAPI, isElectron, isCapacitor } from './services/platform';
import type { ConnectionInfo } from './services/platform';

function App() {
  const api = useMemo(() => getShelfAPI(), []);
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
      const stored = localStorage.getItem('shelf-saved');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [viewMode, setViewMode] = useState<'list' | 'grid'>(() => {
    if (!mobile) return 'grid';
    try {
      const stored = localStorage.getItem('shelf-view-mode');
      return (stored === 'list' || stored === 'grid') ? stored : 'list';
    } catch { return 'list'; }
  });

  // Shelf state (v2)
  const [shelves, setShelves] = useState<Shelf[]>([]);
  const [activeShelfId, setActiveShelfId] = useState('');
  const [shelfSettingsTarget, setShelfSettingsTarget] = useState<Shelf | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [shelfFilesMap, setShelfFilesMap] = useState<Map<string, ShelfFile[]>>(new Map()); // shelfId → files
  const [shelfPickerFiles, setShelfPickerFiles] = useState<{ name: string; path: string; size: number; mimeType: string }[] | null>(null); // pending files for shelf picker
  const activeShelfIdRef = useRef(activeShelfId);
  activeShelfIdRef.current = activeShelfId;

  const isDownloading = Array.from(downloads.values()).some(p => p >= 0);

  const handleSetViewMode = useCallback((mode: 'list' | 'grid') => {
    setViewMode(mode);
    localStorage.setItem('shelf-view-mode', mode);
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
        localStorage.setItem('shelf-saved', JSON.stringify([...next]));
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

  // Shelf actions (v2)
  const handleCreateShelf = useCallback(async (name: string) => {
    const shelf = await api.createShelf(name);
    setActiveShelfId(shelf.id);
  }, [api]);

  const handleDeleteShelf = useCallback(async (shelfId: string) => {
    await api.deleteShelf(shelfId);
  }, [api]);

  const handleRenameShelf = useCallback(async (shelfId: string, newName: string) => {
    await api.renameShelf(shelfId, newName);
  }, [api]);

  const handleToggleAutoPin = useCallback(async (shelfId: string, autoPin: boolean) => {
    await api.setShelfAutoPin(shelfId, autoPin);
  }, [api]);

  const handlePinFile = useCallback(async (fileId: string) => {
    await api.pinFile(fileId);
  }, [api]);

  const handleUnpinFile = useCallback(async (fileId: string) => {
    await api.unpinFile(fileId);
  }, [api]);

  const activeShelf = shelves.find(s => s.id === activeShelfId);

  // Use per-shelf files when available, fallback to v1 flat list
  const activeShelfFiles: (SharedFile & { available?: boolean; pinned?: boolean | null })[] = useMemo(() => {
    const sf = shelfFilesMap.get(activeShelfId);
    if (sf && sf.length > 0) {
      // Map ShelfFile → SharedFile-compatible shape (addedAt → uploadedAt)
      return sf.map(f => ({
        ...f,
        uploadedAt: f.addedAt,
      }));
    }
    // Fallback: v1 flat file list (before shelf-files are loaded)
    return files;
  }, [shelfFilesMap, activeShelfId, files]);

  const shelfFileCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const shelf of shelves) {
      counts.set(shelf.id, shelfFilesMap.get(shelf.id)?.length ?? 0);
    }
    return counts;
  }, [shelves, shelfFilesMap]);

  const downloadAll = useCallback(() => {
    const remoteFiles = activeShelfFiles.filter(f => f.deviceId !== deviceId && f.available !== false);
    for (const file of remoteFiles) {
      if (downloads.has(file.id) || savedFiles.has(file.id)) continue;
      const peer = peers.find(p => p.id === file.deviceId);
      if (peer) startDownload(file, peer);
    }
  }, [activeShelfFiles, deviceId, peers, downloads, savedFiles, startDownload]);

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

  const clearShelf = useCallback(() => {
    const localFileIds = activeShelfFiles.filter(f => f.deviceId === deviceId).map(f => f.id);
    for (const fileId of localFileIds) {
      api.removeFile(fileId);
    }
  }, [api, activeShelfFiles, deviceId]);

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

    // Load shelves (v2)
    api.getShelves().then((s) => {
      setShelves(s);
      if (s.length > 0 && !activeShelfId) setActiveShelfId(s[0].id);
      // Load files for each shelf
      for (const shelf of s) {
        api.getShelfFiles(shelf.id).then((sf) => {
          setShelfFilesMap(prev => {
            const next = new Map(prev);
            next.set(shelf.id, sf);
            return next;
          });
        });
      }
    });
    api.onShelvesUpdate((s) => {
      setShelves(s);
      // Auto-select first shelf if none selected
      setActiveShelfId(prev => {
        if (!prev && s.length > 0) return s[0].id;
        if (prev && !s.find(sh => sh.id === prev) && s.length > 0) return s[0].id;
        return prev;
      });
      // Load files for any new shelves
      for (const shelf of s) {
        api.getShelfFiles(shelf.id).then((sf) => {
          setShelfFilesMap(prev => {
            const next = new Map(prev);
            next.set(shelf.id, sf);
            return next;
          });
        });
      }
    });
    // Per-shelf file updates
    api.onShelfFilesUpdate(({ shelfId, files: sf }) => {
      setShelfFilesMap(prev => {
        const next = new Map(prev);
        next.set(shelfId, sf);
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

    await api.addFilesToShelf(activeShelfIdRef.current, fileData);
  }, [api]);

  const addFilesToActiveShelf = useCallback(async (fileData: { name: string; path: string; size: number; mimeType: string }[]) => {
    await api.addFilesToShelf(activeShelfIdRef.current, fileData);
  }, [api]);

  const handleAddFiles = useCallback(async () => {
    const picked = await api.pickFiles();
    if (!picked || picked.length === 0) return;

    // On mobile with 2+ shelves, show the shelf picker
    if (mobile && shelves.length > 1) {
      setShelfPickerFiles(picked);
      return;
    }

    await addFilesToActiveShelf(picked);
  }, [api, mobile, shelves, addFilesToActiveShelf]);

  const handleShelfPicked = useCallback(async (shelfId: string) => {
    if (shelfPickerFiles) {
      await api.addFilesToShelf(shelfId, shelfPickerFiles);
      setShelfPickerFiles(null);
    }
  }, [api, shelfPickerFiles]);

  const remoteCount = activeShelfFiles.filter((f) => f.deviceId !== deviceId).length;
  const localCount = activeShelfFiles.length - remoteCount;
  const hasFiles = activeShelfFiles.length > 0;

  // Build unique device list for filter tags
  const devices = useMemo(() => {
    const map = new Map<string, string>(); // deviceId -> deviceName
    for (const f of activeShelfFiles) {
      if (!map.has(f.deviceId)) {
        map.set(f.deviceId, f.deviceId === deviceId ? (deviceName || 'You') : f.deviceName);
      }
    }
    return map;
  }, [activeShelfFiles, deviceId, deviceName]);

  // Filter files
  const filteredFiles = useMemo(() => {
    if (filter === 'all') return activeShelfFiles;
    if (filter === 'other') return activeShelfFiles.filter(f => f.deviceId !== deviceId);
    return activeShelfFiles.filter(f => f.deviceId === filter);
  }, [activeShelfFiles, filter, deviceId]);

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
            <h1 className="text-sm font-semibold leading-tight">Dragin Shelf</h1>
            <p className="text-[11px] text-slate-500 leading-tight truncate">
              {activeShelfFiles.length === 0
                ? 'No files'
                : `${activeShelfFiles.length} file${activeShelfFiles.length !== 1 ? 's' : ''}${remoteCount > 0 ? ` (${remoteCount} remote)` : ''}`
              }
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Mobile: view toggle + clear in header */}
          {mobile && hasFiles && viewToggle}
          {mobile && localCount > 0 && (
            <button
              onClick={clearShelf}
              className="p-1.5 rounded-lg bg-slate-800 active:bg-red-600 transition-colors"
              title="Clear shelf"
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
              onClick={clearShelf}
              className="p-1.5 rounded-lg hover:bg-red-600/80 transition-colors"
              title="Clear shelf"
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

      {/* Mobile shelf selector (horizontal scroll) — always shown */}
      {mobile && shelves.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700/50 bg-slate-900/50 overflow-x-auto scrollbar-hide flex-shrink-0">
          {shelves.map((shelf) => (
            <button
              key={shelf.id}
              onClick={() => {
                if (shelf.id === activeShelfId) {
                  setShelfSettingsTarget(shelf);
                } else {
                  setActiveShelfId(shelf.id);
                }
              }}
              onContextMenu={(e) => { e.preventDefault(); setShelfSettingsTarget(shelf); }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                shelf.id === activeShelfId
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-400 active:bg-slate-700'
              }`}
            >
              {shelf.name}
              {(shelfFileCounts.get(shelf.id) ?? 0) > 0 && (
                <span className="ml-1.5 text-[10px] opacity-70">{shelfFileCounts.get(shelf.id)}</span>
              )}
            </button>
          ))}
          <button
            onClick={() => {
              const name = prompt('New shelf name');
              if (name?.trim()) handleCreateShelf(name.trim());
            }}
            className="px-2.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap bg-slate-800 text-slate-500 active:bg-slate-700 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Main content with optional sidebar */}
      <div className="flex-1 min-h-0 overflow-hidden flex">
        {/* Shelf sidebar (desktop only, when 2+ shelves) */}
        {!mobile && shelves.length > 0 && (
          <ShelfSidebar
            shelves={shelves}
            activeShelfId={activeShelfId}
            onSelect={setActiveShelfId}
            onCreate={handleCreateShelf}
            onSettings={(shelf) => setShelfSettingsTarget(shelf)}
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(prev => !prev)}
            shelfFileCounts={shelfFileCounts}
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
                {activeShelf ? `Drop files to ${activeShelf.name}` : 'Drop files to share'}
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
                  All ({activeShelfFiles.length})
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
                    {id === deviceId ? 'Mine' : name} ({activeShelfFiles.filter(f => f.deviceId === id).length})
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
          <DropZone onAddFiles={handleAddFiles} onScan={mobile ? handleShowScanner : undefined} mobile={mobile} shelfName={activeShelf?.name} />
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

      {/* Shelf Settings Modal */}
      {shelfSettingsTarget && (
        <ShelfSettings
          shelf={shelfSettingsTarget}
          onRename={handleRenameShelf}
          onToggleAutoPin={handleToggleAutoPin}
          onDelete={handleDeleteShelf}
          onClose={() => setShelfSettingsTarget(null)}
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

      {/* Shelf Picker Modal (mobile, 2+ shelves) */}
      {shelfPickerFiles && (
        <ShelfPickerModal
          shelves={shelves}
          onSelect={handleShelfPicked}
          onClose={() => setShelfPickerFiles(null)}
        />
      )}
    </div>
  );
}

export default App;
