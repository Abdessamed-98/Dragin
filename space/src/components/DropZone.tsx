import { Upload, Plus, Share2, ScanLine } from 'lucide-react';

interface DropZoneProps {
  onAddFiles: () => void;
  onScan?: () => void;
  mobile?: boolean;
  spaceName?: string;
}

export function DropZone({ onAddFiles, onScan, mobile, spaceName }: DropZoneProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
      <div className="w-20 h-20 rounded-2xl bg-slate-800 border border-slate-700 flex items-center justify-center">
        {mobile ? (
          <Share2 className="w-10 h-10 text-slate-500" />
        ) : (
          <Upload className="w-10 h-10 text-slate-500" />
        )}
      </div>

      <div className="text-center">
        <p className="text-lg font-medium text-slate-300">
          {mobile ? 'Share files to Space' : `Drop files${spaceName ? ` to ${spaceName}` : ' anywhere'}`}
        </p>
        <p className="text-sm text-slate-500 mt-1">
          {mobile
            ? 'Use the button below or share from other apps'
            : 'Files will be shared with all connected devices'}
        </p>
      </div>

      <div className="flex flex-col items-center gap-3">
        <button
          onClick={onAddFiles}
          className="flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-600 active:bg-blue-700 hover:bg-blue-500 text-sm font-medium transition-colors"
        >
          <Plus className="w-4 h-4" />
          Browse files
        </button>

        {mobile && onScan && (
          <button
            onClick={onScan}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-700 active:bg-slate-600 hover:bg-slate-600 text-sm font-medium text-slate-300 transition-colors"
          >
            <ScanLine className="w-4 h-4" />
            Scan to connect
          </button>
        )}
      </div>
    </div>
  );
}
