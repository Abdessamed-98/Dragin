import React, { DragEvent, useState, useEffect } from 'react';
import { Upload, X, Download, Loader2, Wand2, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { ActiveSession } from '../types';

interface DropDrawerProps {
  isVisible: boolean;
  isDragActive: boolean;
  session: ActiveSession | null;
  onDrop: (file: File) => void;
  onClose: () => void;
}

export const DropDrawer: React.FC<DropDrawerProps> = ({ 
  isVisible,
  isDragActive: _isDragActive,
  session,
  onDrop,
  onClose 
}) => {
  const [showComparison, setShowComparison] = useState(false);

  // Get the active item (first item) from session
  const activeItem = session?.items?.[0];

  // Reset comparison state when session changes
  useEffect(() => {
    if (session?.status !== 'completed') {
      setShowComparison(false);
    }
  }, [session?.status]);

  // Handle Drop inside the drawer
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('image/')) {
        onDrop(file);
      }
    }
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };

  // If invisible, push off screen. If visible, slide in.
  const translateClass = isVisible ? 'translate-x-0' : 'translate-x-full';

  return (
    <div
      className={`fixed top-4 right-4 bottom-4 w-[350px] 
        bg-slate-900/95 backdrop-blur-2xl 
        border border-white/10 rounded-3xl shadow-2xl 
        z-50 transition-all duration-500 cubic-bezier(0.16, 1, 0.3, 1) transform ${translateClass}
        flex flex-col overflow-hidden font-sans
      `}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Background Ambient Light */}
      <div className="absolute top-0 right-0 w-full h-64 bg-indigo-500/20 blur-3xl rounded-full pointer-events-none -translate-y-1/2 translate-x-1/2" />
      
      {/* Header (Only visible if there is a session) */}
      {session && (
        <div className="relative z-20 flex items-center justify-between p-4 border-b border-white/5">
            <span className="text-xs font-bold text-indigo-400 tracking-wider flex items-center gap-2">
                <Wand2 className="w-3 h-3" />
                AI REMOVER
            </span>
            <button 
                onClick={onClose}
                className="p-1.5 rounded-full hover:bg-white/10 text-slate-400 hover:text-white transition-colors"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
      )}

      <div className="flex-1 relative flex flex-col p-4 h-full">
        
        {/* --- STATE 1: DRAG MODE (No session yet) --- */}
        {!session && (
          <div className="h-full flex flex-col items-center justify-center text-center space-y-6 animate-in fade-in duration-300">
             <div className="relative">
                <div className="absolute inset-0 bg-indigo-500 blur-2xl opacity-20 animate-pulse" />
                <div className="w-24 h-24 rounded-2xl border-2 border-dashed border-indigo-400/50 flex items-center justify-center bg-slate-800/50 backdrop-blur-sm">
                    <Upload className="w-10 h-10 text-indigo-400" />
                </div>
             </div>
             <div>
                 <h2 className="text-xl font-bold text-white">أفلت الصورة هنا</h2>
                 <p className="text-sm text-slate-400 mt-2">ستتم إزالة الخلفية فوراً</p>
             </div>
          </div>
        )}

        {/* --- STATE 2: PROCESSING / RESULT --- */}
        {session && activeItem && (
          <div className="flex-1 flex flex-col h-full animate-in zoom-in-95 duration-300">
            
            {/* Image Container */}
            <div 
                className="relative flex-1 rounded-2xl overflow-hidden bg-[url('https://media.istockphoto.com/id/1126601438/vector/transparent-background-grid-seamless-pattern.jpg?s=612x612&w=0&k=20&c=oFJSyXF8a_b6OaXbOq3q9L9KqZ_o9Y_9Z_9Z_9Z_9Z')] bg-repeat"
            >
               {/* 1. Original Image (Background Layer) */}
               <img 
                  src={activeItem.originalUrl} 
                  className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-500 ${
                      session.status === 'completed' && !showComparison ? 'opacity-0' : 'opacity-100'
                  }`} 
                  alt="Original" 
               />

               {/* 2. Processed Image (Foreground Layer) */}
               {session.status === 'completed' && activeItem.processedUrl && (
                  <img 
                    src={activeItem.processedUrl} 
                    className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-500 ${
                        showComparison ? 'opacity-0' : 'opacity-100'
                    }`}
                    alt="Processed"
                    draggable={true}
                  />
               )}

               {/* Scanning Effect while processing */}
               {session.status === 'processing' && (
                  <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px] z-10">
                      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-indigo-400 to-transparent shadow-[0_0_15px_rgba(99,102,241,0.8)] animate-[scan_2s_ease-in-out_infinite]" />
                      <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
                          <Loader2 className="w-8 h-8 animate-spin mb-2" />
                          <span className="text-xs font-medium tracking-widest uppercase">Processing</span>
                      </div>
                  </div>
               )}
               
               {/* Comparison Button */}
               {session.status === 'completed' && (
                   <button
                       onClick={() => setShowComparison(!showComparison)}
                       className="absolute bottom-3 left-1/2 -translate-x-1/2 py-1.5 px-4 bg-black/60 backdrop-blur-md rounded-full text-xs text-white/90 border border-white/10 hover:bg-black/80 transition-all flex items-center gap-2 z-20 cursor-pointer"
                   >
                       {showComparison ? (
                           <>
                             <EyeOff className="w-3 h-3" />
                             <span>عرض النتيجة</span>
                           </>
                       ) : (
                           <>
                             <Eye className="w-3 h-3" />
                             <span>عرض الأصل</span>
                           </>
                       )}
                   </button>
               )}
            </div>

            {/* Error Message */}
            {session.status === 'error' && (
                <div className="mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-200 text-sm text-center">
                    {session.error || 'حدث خطأ غير متوقع'}
                </div>
            )}

            {/* Actions */}
            {session.status === 'completed' && activeItem.processedUrl && (
                <div className="mt-4 grid grid-cols-2 gap-3">
                    <a 
                        href={activeItem.processedUrl}
                        download={`removed-bg-${session.id}.png`}
                        className="col-span-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white py-3 rounded-xl transition-all active:scale-95 text-sm font-medium shadow-lg shadow-indigo-500/25"
                    >
                        <Download className="w-4 h-4" />
                        تحميل
                    </a>
                    <button 
                        onClick={onClose}
                        className="col-span-1 flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-700 text-slate-300 py-3 rounded-xl transition-all active:scale-95 text-sm border border-white/5"
                    >
                        <RefreshCw className="w-4 h-4" />
                        صورة جديدة
                    </button>
                </div>
            )}
          </div>
        )}
      </div>

      <style>{`
        @keyframes scan {
          0% { top: 0%; opacity: 0; }
          10% { opacity: 1; }
          90% { opacity: 1; }
          100% { top: 100%; opacity: 0; }
        }
      `}</style>
    </div>
  );
};