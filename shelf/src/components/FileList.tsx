import type { SharedFile, Peer } from '@/types';
import { FileCard } from './FileCard';

interface FileListProps {
  files: SharedFile[];
  peers: Peer[];
  deviceId: string;
}

export function FileList({ files, peers, deviceId }: FileListProps) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
        {files.map((file) => (
          <FileCard
            key={`${file.deviceId}-${file.id}`}
            file={file}
            isLocal={file.deviceId === deviceId}
            peer={peers.find((p) => p.id === file.deviceId)}
          />
        ))}
      </div>
    </div>
  );
}
