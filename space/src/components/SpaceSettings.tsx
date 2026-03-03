import { useState } from 'react';
import { X, Trash2, Pin, PinOff } from 'lucide-react';
import type { Space } from '@/types';

interface Props {
  space: Space;
  onRename: (spaceId: string, newName: string) => void;
  onToggleAutoPin: (spaceId: string, autoPin: boolean) => void;
  onDelete: (spaceId: string) => void;
  onClose: () => void;
}

export function SpaceSettings({ space, onRename, onToggleAutoPin, onDelete, onClose }: Props) {
  const [name, setName] = useState(space.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isGeneral = space.name === 'General';

  const handleRename = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== space.name) {
      onRename(space.id, trimmed);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div
        className="relative bg-slate-800 rounded-2xl p-6 mx-4 max-w-sm w-full shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-lg hover:bg-slate-700 transition-colors"
        >
          <X className="w-5 h-5 text-slate-400" />
        </button>

        <h2 className="text-lg font-semibold mb-4">Space Settings</h2>

        {/* Name */}
        <label className="block text-xs text-slate-400 mb-1">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={handleRename}
          onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); }}
          className="w-full px-3 py-2 text-sm bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none mb-4"
          disabled={isGeneral}
        />

        {/* Auto-pin toggle */}
        <div className="flex items-center justify-between py-3 border-t border-slate-700">
          <div>
            <p className="text-sm font-medium">Auto-pin files</p>
            <p className="text-xs text-slate-400 mt-0.5">
              {space.autoPin
                ? 'Files stay when owner disconnects'
                : 'Files vanish when owner disconnects'
              }
            </p>
          </div>
          <button
            onClick={() => onToggleAutoPin(space.id, !space.autoPin)}
            className={`p-2 rounded-lg transition-colors ${
              space.autoPin
                ? 'bg-blue-600/20 text-blue-400 hover:bg-blue-600/30'
                : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
            }`}
          >
            {space.autoPin ? <Pin className="w-4 h-4" /> : <PinOff className="w-4 h-4" />}
          </button>
        </div>

        {/* Delete */}
        {!isGeneral && (
          <div className="pt-3 border-t border-slate-700 mt-3">
            {confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-red-400">Delete this space?</span>
                <button
                  onClick={() => { onDelete(space.id); onClose(); }}
                  className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-medium transition-colors"
                >
                  Delete
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDelete(true)}
                className="flex items-center gap-2 text-xs text-red-400 hover:text-red-300 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete space
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
