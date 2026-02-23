import { Download, Trash2, FileText, Image, Film, Music, Archive, Code, File } from 'lucide-react';
import type { SharedFile, Peer } from '@/types';

interface FileCardProps {
  file: SharedFile;
  isLocal: boolean;
  peer?: Peer;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getFileIcon(name: string, mimeType: string) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (mimeType.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'].includes(ext))
    return <Image className="w-8 h-8 text-emerald-400" />;
  if (mimeType.startsWith('video/') || ['mp4', 'mkv', 'avi', 'mov', 'webm'].includes(ext))
    return <Film className="w-8 h-8 text-purple-400" />;
  if (mimeType.startsWith('audio/') || ['mp3', 'wav', 'flac', 'ogg', 'aac', 'm4a'].includes(ext))
    return <Music className="w-8 h-8 text-pink-400" />;
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2'].includes(ext))
    return <Archive className="w-8 h-8 text-amber-400" />;
  if (['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'xls', 'xlsx', 'ppt', 'pptx', 'csv'].includes(ext))
    return <FileText className="w-8 h-8 text-blue-400" />;
  if (['js', 'ts', 'jsx', 'tsx', 'py', 'java', 'c', 'cpp', 'html', 'css', 'json', 'xml', 'yaml', 'yml', 'sh'].includes(ext))
    return <Code className="w-8 h-8 text-cyan-400" />;
  return <File className="w-8 h-8 text-slate-400" />;
}

function getExtension(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  return ext !== name.toLowerCase() ? ext.toUpperCase() : '';
}

export function FileCard({ file, isLocal, peer }: FileCardProps) {
  const handleDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!peer) return;
    await window.electron.downloadFile(file.id, file.name, peer.ip, peer.port);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await window.electron.removeFile(file.id);
  };

  const ext = getExtension(file.name);

  return (
    <div className="group relative flex flex-col gap-2 p-4 rounded-lg bg-slate-800/80 border border-slate-700/50 hover:border-slate-600 hover:bg-slate-800 transition-all">
      {/* Source badge */}
      <span className={`absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded-full ${
        isLocal ? 'bg-blue-500/20 text-blue-300' : 'bg-emerald-500/20 text-emerald-300'
      }`}>
        {isLocal ? 'You' : file.deviceName}
      </span>

      {/* Icon */}
      <div className="flex items-center justify-center h-14 mt-2">
        {getFileIcon(file.name, file.mimeType)}
      </div>

      {/* Extension tag */}
      {ext && (
        <div className="flex justify-center">
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400">
            {ext}
          </span>
        </div>
      )}

      {/* Name */}
      <p className="text-sm font-medium truncate" title={file.name}>
        {file.name}
      </p>

      {/* Size */}
      <span className="text-xs text-slate-500">{formatSize(file.size)}</span>

      {/* Actions */}
      <div className="flex gap-2 mt-auto opacity-0 group-hover:opacity-100 transition-opacity">
        {!isLocal && peer && (
          <button
            onClick={handleDownload}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-blue-600 hover:bg-blue-500 text-xs font-medium transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            Save
          </button>
        )}
        {isLocal && (
          <button
            onClick={handleDelete}
            className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md bg-slate-700 hover:bg-red-600 text-xs font-medium transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
