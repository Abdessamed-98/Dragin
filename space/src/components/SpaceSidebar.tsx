import { useState } from 'react';
import { Plus, ChevronLeft, ChevronRight, Pin, Settings } from 'lucide-react';
import type { Space } from '@/types';

interface Props {
  spaces: Space[];
  activeSpaceId: string;
  onSelect: (spaceId: string) => void;
  onCreate: (name: string) => void;
  onSettings: (space: Space) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  spaceFileCounts: Map<string, number>;
}

export function SpaceSidebar({
  spaces,
  activeSpaceId,
  onSelect,
  onCreate,
  onSettings,
  collapsed,
  onToggleCollapse,
  spaceFileCounts,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const handleCreate = () => {
    const name = newName.trim();
    if (!name) return;
    onCreate(name);
    setNewName('');
    setCreating(false);
  };

  if (collapsed) {
    return (
      <div className="flex flex-col items-center py-3 px-1 border-r border-slate-700/50 bg-slate-900/50 w-10">
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-md hover:bg-slate-700 transition-colors mb-3"
          title="Expand spaces"
        >
          <ChevronRight className="w-4 h-4 text-slate-400" />
        </button>
        {spaces.map((space) => (
          <button
            key={space.id}
            onClick={() => onSelect(space.id)}
            className={`w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-bold mb-1 transition-colors ${
              space.id === activeSpaceId
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
            }`}
            title={space.name}
          >
            {space.name[0].toUpperCase()}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col w-48 border-r border-slate-700/50 bg-slate-900/50 flex-shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-slate-700/50">
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Spaces</span>
        <button
          onClick={onToggleCollapse}
          className="p-1 rounded-md hover:bg-slate-700 transition-colors"
          title="Collapse"
        >
          <ChevronLeft className="w-3.5 h-3.5 text-slate-500" />
        </button>
      </div>

      {/* Space list */}
      <div className="flex-1 overflow-y-auto py-1.5">
        {spaces.map((space) => {
          const count = spaceFileCounts.get(space.id) || 0;
          const isActive = space.id === activeSpaceId;
          return (
            <div
              key={space.id}
              className={`group flex items-center gap-2 px-3 py-2 mx-1.5 rounded-md cursor-pointer transition-colors ${
                isActive
                  ? 'bg-blue-600/20 text-blue-300'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
              onClick={() => onSelect(space.id)}
            >
              <span className="flex-1 text-sm truncate">{space.name}</span>
              {space.autoPin && (
                <Pin className="w-3 h-3 text-slate-500 flex-shrink-0" />
              )}
              <span className="text-[10px] text-slate-500 flex-shrink-0">{count}</span>
              <button
                onClick={(e) => { e.stopPropagation(); onSettings(space); }}
                className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-slate-700 transition-all"
                title="Space settings"
              >
                <Settings className="w-3 h-3 text-slate-500" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Create space */}
      <div className="px-2 py-2 border-t border-slate-700/50">
        {creating ? (
          <form
            onSubmit={(e) => { e.preventDefault(); handleCreate(); }}
            className="flex gap-1"
          >
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Space name..."
              className="flex-1 px-2 py-1.5 text-xs bg-slate-800 border border-slate-600 rounded-md text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none"
              onBlur={() => { if (!newName.trim()) setCreating(false); }}
              onKeyDown={(e) => { if (e.key === 'Escape') setCreating(false); }}
            />
          </form>
        ) : (
          <button
            onClick={() => setCreating(true)}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-md text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-300 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            New Space
          </button>
        )}
      </div>
    </div>
  );
}
