import { Monitor, Smartphone, Laptop } from 'lucide-react';
import type { Peer } from '@/types';

interface PeerBarProps {
  peers: Peer[];
}

function PeerIcon({ platform }: { platform: string }) {
  switch (platform) {
    case 'android':
    case 'ios':
      return <Smartphone className="w-4 h-4" />;
    case 'darwin':
      return <Laptop className="w-4 h-4" />;
    default:
      return <Monitor className="w-4 h-4" />;
  }
}

export function PeerBar({ peers }: PeerBarProps) {
  if (peers.length === 0) {
    return (
      <span className="text-xs text-slate-500">No other devices</span>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {peers.map((peer) => (
        <div
          key={peer.id}
          className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-slate-800 border border-slate-700 text-xs"
          title={`${peer.name} (${peer.ip})`}
        >
          <span className="w-2 h-2 rounded-full bg-green-400" />
          <PeerIcon platform={peer.platform} />
          <span className="text-slate-300">{peer.name}</span>
        </div>
      ))}
    </div>
  );
}
