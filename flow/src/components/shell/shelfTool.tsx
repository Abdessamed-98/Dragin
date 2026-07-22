/**
 * Shelf on the shell — a PERSISTENT holding tray, not a session tool. It manages
 * its own item list via the shelf IPC (shelfLoad/Save/Delete) independent of the
 * working session, so it uses hideHeader (owns its whole panel). Items drag out
 * to the OS / other tools via startNativeDrag.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Archive, Upload, Trash2, X } from 'lucide-react';
import { useElectron } from '../../hooks/useElectron';
import { ToolHeader } from '../ToolHeader';
import type { ShellTool, FocusBodyProps } from './shellTools';

interface ShelfItem { id: string; name: string; url: string }
const genId = () => Math.random().toString(36).slice(2, 11);

const ShelfBody: React.FC<FocusBodyProps> = ({ onClose }) => {
    const { shelfLoad, shelfSave, shelfDelete } = useElectron();
    const [items, setItems] = useState<ShelfItem[]>([]);
    const [over, setOver] = useState(false);

    useEffect(() => { shelfLoad().then(setItems).catch(() => { }); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const addFiles = useCallback(async (files: File[]) => {
        for (const f of files) {
            const id = genId();
            try { const url = await shelfSave(id, await f.arrayBuffer(), f.name); setItems(prev => [...prev, { id, name: f.name, url }]); }
            catch (e) { console.error('Shelf save failed', e); }
        }
    }, [shelfSave]);

    const remove = useCallback(async (id: string) => {
        await shelfDelete([id]).catch(() => { });
        setItems(prev => prev.filter(i => i.id !== id));
    }, [shelfDelete]);

    const clearAll = async () => { await shelfDelete(items.map(i => i.id)).catch(() => { }); setItems([]); onClose(); };

    const dragOut = (e: React.DragEvent, item: ShelfItem) => {
        e.preventDefault();
        (window as any).electron?.startNativeDrag?.({ items: [{ id: item.id, name: item.name, dataUrl: null, filePath: null }] });
    };

    const onInput = (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files?.length) addFiles(Array.from(e.target.files)); e.target.value = ''; };

    return (
        <div className="absolute inset-0 flex flex-col rounded-2xl overflow-hidden"
            onDrop={e => { e.preventDefault(); setOver(false); const f = Array.from(e.dataTransfer.files); if (f.length) addFiles(f); }}
            onDragOver={e => { e.preventDefault(); setOver(true); }}
            onDragLeave={e => { if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(false); }}>
            <ToolHeader icon={<Archive className="w-4 h-4 text-amber-400" />} title="Shelf" count={items.length} onClose={onClose} />
            <div className="flex-1 min-h-0 p-3">
                {items.length === 0 ? (
                    <label className={`h-full flex flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed cursor-pointer transition-all ${over ? 'border-amber-400 bg-amber-500/10' : 'border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-2)]'}`}>
                        <div className="p-4 rounded-2xl bg-[var(--surface-2)]">{over ? <Upload className="w-8 h-8 text-amber-400" /> : <Archive className="w-8 h-8 text-[var(--text-3)]" />}</div>
                        <p className="text-sm font-semibold text-[var(--text-2)]">Drop files here to shelve them</p>
                        <input type="file" multiple className="sr-only" onChange={onInput} />
                    </label>
                ) : (
                    <div className="h-full overflow-y-auto -mr-1 pr-1"><div className="grid grid-cols-3 gap-1.5">
                        {items.map(item => (
                            <div key={item.id} draggable onDragStart={e => dragOut(e, item)}
                                className="group relative aspect-square rounded-lg border border-[var(--separator)] overflow-hidden bg-[var(--surface)] cursor-grab active:cursor-grabbing">
                                <img src={item.url} className="w-full h-full object-cover" draggable={false} alt={item.name} />
                                <button onClick={() => remove(item.id)} className="absolute top-0.5 right-0.5 opacity-0 group-hover:opacity-100 bg-black/60 rounded-full p-0.5 text-white"><X className="w-3 h-3" /></button>
                                <div className="absolute bottom-0 inset-x-0 bg-black/50 px-1 py-0.5 pointer-events-none"><p className="text-[9px] text-white truncate">{item.name}</p></div>
                            </div>
                        ))}
                        <label className="aspect-square rounded-lg border border-dashed border-[var(--border)] cursor-pointer flex items-center justify-center hover:border-[var(--border-2)]"><Upload className="w-4 h-4 text-[var(--text-3)]" /><input type="file" multiple className="sr-only" onChange={onInput} /></label>
                    </div></div>
                )}
            </div>
            {items.length > 0 && (
                <div className="flex items-center gap-1.5 px-3 pb-3 shrink-0">
                    <button onClick={clearAll} className="flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-bold bg-[var(--surface-2)] hover:bg-[var(--surface-3)] text-[var(--text-2)] hover:text-[var(--red)] transition-colors"><Trash2 className="w-4 h-4" /> Clear shelf</button>
                </div>
            )}
        </div>
    );
};

export const shelfTool: ShellTool = {
    id: 'shelf', kind: 'focus', hideHeader: true, accent: 'amber', Icon: Archive, titleKey: 'tool.shelf.title',
    accept: () => false, inputAccept: '*',
    emptyTitleKey: 'tool.shelf.title', Body: ShelfBody,
};
