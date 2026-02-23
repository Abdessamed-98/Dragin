import { Upload, Plus } from 'lucide-react';

interface DropZoneProps {
  onAddFiles: () => void;
}

export function DropZone({ onAddFiles }: DropZoneProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
      <div className="w-20 h-20 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center">
        <Upload className="w-10 h-10 text-slate-500" />
      </div>

      <div className="text-center">
        <p className="text-lg font-medium text-slate-300">Drop files anywhere</p>
        <p className="text-sm text-slate-500 mt-1">Files will be shared with all connected devices</p>
      </div>

      <button
        onClick={onAddFiles}
        className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm font-medium transition-colors"
      >
        <Plus className="w-4 h-4" />
        Browse files
      </button>
    </div>
  );
}
