import { useState } from 'react';
import { Download, Trash2, FileText, Image, Film, Music, Archive, Code, File, Check, Pin, PinOff } from 'lucide-react';
import type { SharedFile, Peer } from '@/types';
import type { ConnectionInfo } from '@/services/platform';
import { getShelfAPI } from '@/services/platform';

interface FileCardProps {
  file: SharedFile & { available?: boolean; pinned?: boolean | null };
  isLocal: boolean;
  peer?: Peer;
  localServer?: ConnectionInfo | null;
  downloadProgress?: number; // 0-100, undefined = not downloading
  isSaved?: boolean; // persistently saved (from localStorage)
  onDownload?: () => void;
  onAbortDownload?: () => void;
  onPin?: (fileId: string) => void;
  onUnpin?: (fileId: string) => void;
  variant?: 'card' | 'list';
  mobile?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function isImageFile(name: string, mimeType: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(ext);
}

function getFileIcon(name: string, mimeType: string, size: 'sm' | 'md' = 'md') {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const cls = size === 'sm' ? 'w-6 h-6' : 'w-8 h-8';
  if (isImageFile(name, mimeType))
    return <Image className={`${cls} text-emerald-400`} />;
  if (mimeType.startsWith('video/') || ['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext))
    return <Film className={`${cls} text-purple-400`} />;
  if (mimeType.startsWith('audio/') || ['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a'].includes(ext))
    return <Music className={`${cls} text-pink-400`} />;
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext))
    return <Archive className={`${cls} text-amber-400`} />;
  if (['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'xls', 'xlsx', 'ppt', 'pptx', 'csv'].includes(ext))
    return <FileText className={`${cls} text-blue-400`} />;
  if (['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'html', 'css', 'json', 'xml', 'yaml', 'yml', 'sh'].includes(ext))
    return <Code className={`${cls} text-cyan-400`} />;
  return <File className={`${cls} text-slate-400`} />;
}

function getExtension(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return ext !== name.toLowerCase() ? ext.toUpperCase() : '';
}

function getImageUrl(file: SharedFile, isLocal: boolean, peer?: Peer, localServer?: ConnectionInfo | null): string | null {
  if (!isImageFile(file.name, file.mimeType)) return null;

  // Mobile local file with blob URL
  if (file.blobUrl) return file.blobUrl;

  // Local files: serve full-size from localhost (fast, no network)
  if (isLocal && localServer) {
    return `http://localhost:${localServer.port}/files/${file.id}`;
  }

  // Remote files: prefer base64 thumbnail (instant, no download needed)
  if (file.thumbnail) return file.thumbnail;

  // Fallback: full-size HTTP from peer (requires downloading entire image)
  if (!isLocal && peer && peer.port > 0) {
    return `http://${peer.ip}:${peer.port}/files/${file.id}`;
  }

  return null;
}

export function FileCard({ file, isLocal, peer, localServer, downloadProgress, isSaved, onDownload, onAbortDownload, onPin, onUnpin, variant = 'card', mobile }: FileCardProps) {
  const [imgError, setImgError] = useState(false);
  const imageUrl = getImageUrl(file, isLocal, peer, localServer);
  const showPreview = imageUrl && !imgError;
  const isDownloading = downloadProgress !== undefined && downloadProgress >= 0;
  const unavailable = file.available === false;

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const api = getShelfAPI();
    await api.removeFile(file.id);
  };

  const ext = getExtension(file.name);

  // --- LIST VARIANT (mobile rows) ---
  if (variant === 'list') {
    return (
      <div className={`flex items-center gap-3 px-3 py-2.5 rounded-lg bg-slate-800/80 border border-slate-700/50 min-h-[56px] ${unavailable ? 'opacity-50' : ''}`}>
        {/* Thumbnail (48x48) */}
        <div className="w-12 h-12 rounded-md overflow-hidden bg-slate-700/30 flex items-center justify-center flex-shrink-0">
          {showPreview ? (
            <img
              src={imageUrl}
              alt={file.name}
              className="w-full h-full object-cover"
              onError={() => setImgError(true)}
              loading="lazy"
            />
          ) : (
            getFileIcon(file.name, file.mimeType, 'sm')
          )}
        </div>

        {/* File info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{file.name}</p>
          <div className="flex items-center gap-2 mt-0.5">
            <span className="text-xs text-slate-500">{formatSize(file.size)}</span>
            <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${
              isLocal ? 'bg-blue-500/20 text-blue-300' : 'bg-emerald-500/20 text-emerald-300'
            }`}>
              {isLocal ? 'You' : file.deviceName}
            </span>
          </div>
        </div>

        {/* Action (right side) */}
        <div className="flex-shrink-0">
          {!isLocal && isDownloading && (
            <button
              onClick={(e) => { e.stopPropagation(); onAbortDownload?.(); }}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-700/80 active:bg-red-600/80 transition-colors"
            >
              <div className="w-10">
                <div className="w-full h-1.5 bg-slate-600 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-500 rounded-full transition-all duration-300"
                    style={{ width: `${downloadProgress}%` }}
                  />
                </div>
              </div>
              <span className="text-[11px] text-slate-400">{downloadProgress}%</span>
            </button>
          )}
          {!isLocal && isSaved && (
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600/20 text-xs text-emerald-300">
              <Check className="w-4 h-4" />
              Saved
            </div>
          )}
          {!isLocal && !isDownloading && !isSaved && (
            <button
              onClick={(e) => { e.stopPropagation(); onDownload?.(); }}
              className="p-2.5 rounded-lg bg-blue-600 active:bg-blue-700 transition-colors"
            >
              <Download className="w-5 h-5" />
            </button>
          )}
          {isLocal && (
            <button
              onClick={handleDelete}
              className="p-2.5 rounded-lg bg-slate-700 active:bg-red-600 transition-colors"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    );
  }

  // --- CARD VARIANT (grid) ---
  const buttonVisibility = mobile ? '' : 'md:opacity-0 md:group-hover:opacity-100';

  return (
    <div className={`group relative flex flex-col gap-2 p-3 rounded-lg bg-slate-800/80 border border-slate-700/50 hover:border-slate-600 hover:bg-slate-800 transition-all ${unavailable ? 'opacity-50' : ''}`}>
      {/* Source badge + pin */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
        {(onPin || onUnpin) && !isLocal && (
          <button
            onClick={(e) => { e.stopPropagation(); file.pinned ? onUnpin?.(file.id) : onPin?.(file.id); }}
            className={`p-1 rounded-md transition-colors ${
              file.pinned ? 'text-blue-400 hover:bg-blue-600/20' : 'text-slate-500 opacity-0 group-hover:opacity-100 hover:bg-slate-700'
            }`}
            title={file.pinned ? 'Unpin file' : 'Pin file'}
          >
            {file.pinned ? <Pin className="w-3 h-3" /> : <PinOff className="w-3 h-3" />}
          </button>
        )}
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
          isLocal ? 'bg-blue-500/20 text-blue-300' : 'bg-emerald-500/20 text-emerald-300'
        }`}>
          {isLocal ? 'You' : file.deviceName}
        </span>
      </div>

      {/* Image preview or icon */}
      <div className="w-full aspect-square rounded-md overflow-hidden bg-slate-700/30 flex items-center justify-center mt-1">
        {showPreview ? (
          <img
            src={imageUrl}
            alt={file.name}
            className="w-full h-full object-contain"
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <div className="flex flex-col items-center gap-1.5">
            {getFileIcon(file.name, file.mimeType)}
            {ext && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
                {ext}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Name */}
      <p className="text-xs font-medium truncate" title={file.name}>
        {file.name}
      </p>

      {/* Size */}
      <span className="text-[11px] text-slate-500">{formatSize(file.size)}</span>

      {/* Actions */}
      <div className="flex gap-2 mt-auto">
        {!isLocal && isDownloading && (
          <button
            onClick={(e) => { e.stopPropagation(); onAbortDownload?.(); }}
            className="flex-1 flex flex-col items-center gap-1 py-1.5 rounded-md bg-slate-700/80 hover:bg-red-600/80 active:bg-red-600/80 text-xs font-medium transition-colors"
            title="Cancel download"
          >
            <div className="w-full px-1.5">
              <div className="w-full h-1.5 bg-slate-600 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-500 rounded-full transition-all duration-300"
                  style={{ width: `${downloadProgress}%` }}
                />
              </div>
            </div>
            <span className="text-[10px] text-slate-400">{downloadProgress}%</span>
          </button>
        )}
        {!isLocal && isSaved && (
          <div className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-emerald-600/30 text-xs font-medium text-emerald-300">
            <Check className="w-3.5 h-3.5" />
            Saved
          </div>
        )}
        {!isLocal && !isDownloading && !isSaved && (
          unavailable ? (
            <div className="flex-1 flex items-center justify-center py-1.5 rounded-md bg-slate-700/50 text-xs text-slate-500">
              Offline
            </div>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); onDownload?.(); }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-xs font-medium transition-colors ${buttonVisibility}`}
            >
              <Download className="w-3.5 h-3.5" />
              Save
            </button>
          )
        )}
        {isLocal && (
          <button
            onClick={handleDelete}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-slate-700 hover:bg-red-600 active:bg-red-600 text-xs font-medium transition-colors ${buttonVisibility}`}
          >
            <Trash2 className="w-3.5 h-3.5" />
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
