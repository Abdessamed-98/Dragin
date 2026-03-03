import { Monitor, Smartphone, Laptop, X } from 'lucide-react';
import type { Peer, SavedPeer } from '@/types';

interface PeerBarProps {
  peers: Peer[];
  savedPeers: SavedPeer[];
  onRemovePeer: (peerId: string) => void;
  mobile?: boolean;
}

function PeerIcon({ platform }: { platform: string }) {
  switch (platform) {
    case 'android':
    case 'ios':
      return <Smartphone className="w-3.5 h-3.5" />;
    case 'darwin':
      return <Laptop className="w-3.5 h-3.5" />;
    default:
      return <Monitor className="w-3.5 h-3.5" />;
  }
}

export function PeerBar({ peers, savedPeers, onRemovePeer, mobile }: PeerBarProps) {
  const connectedIds = new Set(peers.map(p => p.id));

  // Merge: show all saved peers, using connected info where available
  const allPeers = savedPeers.map(sp => ({
    ...sp,
    connected: connectedIds.has(sp.id),
  }));

  // Also include any connected peer not yet in savedPeers (edge case: just connected, save hasn't propagated)
  for (const p of peers) {
    if (!savedPeers.some(sp => sp.id === p.id)) {
      allPeers.push({ ...p, connected: true });
    }
  }

  if (allPeers.length === 0) {
    return (
      <span className="text-xs text-slate-500">No other devices</span>
    );
  }

  return (
    <div className={`flex items-center gap-2 ${mobile ? 'overflow-x-auto flex-nowrap scrollbar-hide' : 'flex-wrap'}`}>
      {allPeers.map((peer) => (
        <div
          key={peer.id}
          className={`group/peer flex items-center gap-1.5 px-2 py-1 rounded-full border text-xs transition-opacity flex-shrink-0 ${
            peer.connected
              ? 'bg-slate-800 border-slate-700'
              : 'bg-slate-800/50 border-slate-700/50 opacity-50'
          }`}
          title={peer.connected ? `${peer.name} (${peer.ip}) — Connected` : `${peer.name} — Offline`}
        >
          <span className={`w-2 h-2 rounded-full ${peer.connected ? 'bg-green-400' : 'bg-slate-500'}`} />
          <PeerIcon platform={peer.platform} />
          <span className="text-slate-300">{peer.name}</span>
          <button
            onClick={(e) => { e.stopPropagation(); onRemovePeer(peer.id); }}
            className={`ml-0.5 p-0.5 rounded-full hover:bg-red-600/80 transition-colors ${
              mobile ? '' : 'opacity-0 group-hover/peer:opacity-100'
            }`}
            title="Remove peer"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
