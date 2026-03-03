import { X } from 'lucide-react';
import type { Space } from '@/types';

interface Props {
  spaces: Space[];
  onSelect: (spaceId: string) => void;
  onClose: () => void;
}

export function SpacePickerModal({ spaces, onSelect, onClose }: Props) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative bg-slate-800 rounded-2xl p-5 mx-4 max-w-sm w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-slate-700 transition-colors"
        >
          <X className="w-5 h-5 text-slate-400" />
        </button>

        <h2 className="text-lg font-semibold mb-1">Add to space</h2>
        <p className="text-sm text-slate-400 mb-4">Choose which space to add files to</p>

        <div className="flex flex-col gap-2">
          {spaces.map((space) => (
            <button
              key={space.id}
              onClick={() => onSelect(space.id)}
              className="flex items-center gap-3 px-4 py-3 rounded-xl bg-slate-700/50 hover:bg-slate-700 active:bg-blue-600/30 transition-colors text-left"
            >
              <span className="w-8 h-8 rounded-lg bg-blue-600/20 flex items-center justify-center text-sm font-bold text-blue-400">
                {space.name[0].toUpperCase()}
              </span>
              <span className="text-sm font-medium">{space.name}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
