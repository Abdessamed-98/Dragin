/**
 * Processing overlay store — the bridge between a shell tool's controller and
 * the SHARED FileGrid. The grid renders session files (sessionStore); this store
 * supplies the transient, per-tool status painted ON TOP of each cell
 * (processing spinner, error wash, done badge, result URL).
 *
 * Keyed by toolId → fileId, so each tool has its own view of the same files
 * (a file "done" in Resize is "idle" in Watermark) and — being module-level —
 * that view PERSISTS across rail switches for free. Staleness is handled by the
 * caller: on a revision bump the controller re-seeds the item as idle.
 *
 * Modeled on sessionStore: module state + Set<listeners> + useSyncExternalStore,
 * with coalesced microtask emits so a result burst repaints once.
 */
import { useSyncExternalStore, useRef } from 'react';
import { ToolId } from '../types';

export type ItemStatus = 'idle' | 'processing' | 'done' | 'error';

export interface ItemState {
    status: ItemStatus;
    /** File revision this state describes — lets the grid ignore stale entries. */
    revision: number;
    /** The file THIS tool should transform — captured at ingest (currentFile on
     *  arrival, i.e. before this tool touched it). Re-running with new settings
     *  processes this, never the tool's own output, so transforms never stack. */
    input?: File;
    /** Object/data URL of this tool's output for the file (grid prefers it over the thumb). */
    resultUrl?: string;
    /** Short caption for the done-badge, e.g. "1280×720" or "cleaned". */
    badge?: string;
    /** 0–100 while processing a determinate job (upscale/convert); omit for spinner. */
    progress?: number;
    error?: string;
}

type ToolMap = Record<string, ItemState>;

// toolId → (fileId → ItemState). Empty tools simply have no entry.
const byTool: Partial<Record<ToolId, ToolMap>> = {};
const listeners = new Set<() => void>();

let flushQueued = false;
function emit(): void {
    if (flushQueued) return;
    flushQueued = true;
    queueMicrotask(() => {
        flushQueued = false;
        listeners.forEach(l => { try { l(); } catch { /* a listener must not break the store */ } });
    });
}

function subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => { listeners.delete(l); };
}

/** Current map for a tool (a stable empty object when the tool has no items). */
const EMPTY: ToolMap = {};
function getTool(toolId: ToolId): ToolMap {
    return byTool[toolId] ?? EMPTY;
}

/** Merge a patch into one item's state (creates the item/tool as needed). */
function setItem(toolId: ToolId, id: string, patch: Partial<ItemState> & { revision: number }): void {
    const tool = byTool[toolId] ?? (byTool[toolId] = {});
    // New object identity so React sees the change; new tool-map identity too.
    byTool[toolId] = { ...tool, [id]: { ...(tool[id] ?? { status: 'idle', revision: patch.revision }), ...patch } };
    emit();
}

/** Drop items from a tool (used on session removal). */
function removeItems(toolId: ToolId, ids: string[]): void {
    const tool = byTool[toolId];
    if (!tool) return;
    let changed = false;
    const next: ToolMap = {};
    for (const key of Object.keys(tool)) {
        if (ids.includes(key)) { changed = true; continue; }
        next[key] = tool[key];
    }
    if (!changed) return;
    byTool[toolId] = next;
    emit();
}

/** Clear a whole tool's overlay (e.g. on global clear). */
function clearTool(toolId: ToolId): void {
    if (!byTool[toolId]) return;
    delete byTool[toolId];
    emit();
}

export const processingStore = {
    subscribe,
    getTool,
    setItem,
    removeItems,
    clearTool,
};

/** Live per-tool overlay map. Re-renders the grid only when this tool's map changes. */
export function useToolItems(toolId: ToolId): ToolMap {
    // getSnapshot must return a stable reference when unchanged — getTool does,
    // because setItem/removeItems only swap the map identity when it truly changes.
    const toolIdRef = useRef(toolId);
    toolIdRef.current = toolId;
    return useSyncExternalStore(subscribe, () => getTool(toolIdRef.current));
}
