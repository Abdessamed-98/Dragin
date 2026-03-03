import type { SharedFile, Peer } from '@/types';
import type { ConnectionInfo } from '@/services/platform';
import { FileCard } from './FileCard';

type DisplayFile = SharedFile & { available?: boolean; pinned?: boolean | null };

interface FileListProps {
  files: DisplayFile[];
  peers: Peer[];
  deviceId: string;
  localServer?: ConnectionInfo | null;
  downloads: Map<string, number>; // fileId → progress (0-100)
  savedFiles: Set<string>; // fileIds already downloaded
  onDownload: (file: DisplayFile, peer: Peer) => void;
  onAbortDownload: (fileId: string) => void;
  onPin?: (fileId: string) => void;
  onUnpin?: (fileId: string) => void;
  viewMode?: 'list' | 'grid';
  mobile?: boolean;
}

export function FileList({ files, peers, deviceId, localServer, downloads, savedFiles, onDownload, onAbortDownload, onPin, onUnpin, viewMode = 'grid', mobile }: FileListProps) {
  const isList = mobile && viewMode === 'list';

  return (
    <div className={`h-full overflow-y-auto ${mobile ? 'scrollbar-hide' : ''}`}>
      <div className={isList
        ? 'flex flex-col gap-2'
        : 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3'
      }>
        {files.map((file) => {
          const isLocal = file.deviceId === deviceId;
          const peer = peers.find((p) => p.id === file.deviceId);
          return (
            <FileCard
              key={`${file.deviceId}-${file.id}`}
              file={file}
              isLocal={isLocal}
              peer={peer}
              localServer={localServer}
              downloadProgress={downloads.get(file.id)}
              isSaved={savedFiles.has(file.id)}
              onDownload={peer ? () => onDownload(file, peer) : undefined}
              onAbortDownload={() => onAbortDownload(file.id)}
              onPin={onPin}
              onUnpin={onUnpin}
              variant={isList ? 'list' : 'card'}
              mobile={mobile}
            />
          );
        })}
      </div>
    </div>
  );
}
