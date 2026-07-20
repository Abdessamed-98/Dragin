/**
 * Session store — the shared file session that makes Flow's tools lenses over
 * ONE set of files instead of islands.
 *
 * Files belong to the dock, not to a tool. Every file keeps:
 *   • originalFile — never mutated; "revert" always possible
 *   • currentFile  — the latest tool output (== originalFile until processed)
 *   • provenance   — which tools transformed it, in order (the pipeline trail)
 *
 * Tools ingest session files while they are the active tool (see useSessionIngest)
 * and write their outputs back via applyResult(), which is what makes
 * "remove bg → switch to vectorizer → vectorize the cutouts" work.
 *
 * Plain module store + useSyncExternalStore — no new dependencies.
 */
import { useSyncExternalStore, useEffect, useRef } from 'react';
import { ToolId } from '../types';

export type FileKind = 'image' | 'video' | 'audio' | 'pdf' | 'archive' | 'other';

export interface SessionFile {
    id: string;
    /** Display name — tracks the latest output (extension may change, e.g. .svg). */
    name: string;
    kind: FileKind;
    originalFile: File;
    currentFile: File;
    /** Object URL for the current file (store-owned — tools must not revoke). */
    currentUrl: string;
    /** Object URL for the original (store-owned). */
    originalUrl: string;
    /** Tools that transformed this file, in order. Empty = untouched original. */
    provenance: ToolId[];
    /** Bumped whenever currentFile changes (applyResult/revert) so tool views
     *  know to re-ingest this item. */
    revision: number;
}

interface SessionSnapshot {
    files: SessionFile[];
    gen: number;
}

const genId = () => Math.random().toString(36).substring(2, 11);

export function kindOf(file: File): FileKind {
    const t = (file.type || '').toLowerCase();
    const n = file.name.toLowerCase();
    if (t.startsWith('image/') || /\.(jpe?g|png|webp|bmp|tiff?|gif|heic|heif|svg|psd|ai)$/.test(n)) return 'image';
    if (t.startsWith('video/') || /\.(mp4|webm|mov|avi|mkv|flv|wmv|ogv)$/.test(n)) return 'video';
    if (t.startsWith('audio/') || /\.(mp3|wav|ogg|flac|aac|wma|m4a)$/.test(n)) return 'audio';
    if (t === 'application/pdf' || n.endsWith('.pdf')) return 'pdf';
    if (/\.(zip|rar|7z|tar|gz)$/.test(n)) return 'archive';
    return 'other';
}

let files: SessionFile[] = [];
let gen = 0;
let snapshot: SessionSnapshot = { files, gen };
const listeners = new Set<() => void>();

function emit() {
    gen++;
    snapshot = { files, gen };
    listeners.forEach(l => { try { l(); } catch { /* listener errors must not break the store */ } });
}

function subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
}

function getSnapshot(): SessionSnapshot {
    return snapshot;
}

/** Add OS-dropped/pasted files to the session. Returns the created entries. */
function addFiles(incoming: File[]): SessionFile[] {
    const added: SessionFile[] = incoming.map(file => {
        const url = URL.createObjectURL(file);
        return {
            id: genId(),
            name: file.name,
            kind: kindOf(file),
            originalFile: file,
            currentFile: file,
            currentUrl: url,
            originalUrl: url,
            provenance: [],
            revision: 0,
        };
    });
    if (!added.length) return added;
    files = [...files, ...added];
    emit();
    return added;
}

/** Resolve a tool output (Blob, data URL, or object/blob URL) to a File. */
async function toFile(data: Blob | string, name: string): Promise<File> {
    if (typeof data === 'string') {
        const res = await fetch(data);
        data = await res.blob();
    }
    return new File([data], name, { type: (data as Blob).type || 'application/octet-stream' });
}

/**
 * Record a tool's output for a session file. The output becomes the file's
 * "current" state — what the NEXT tool receives. No-op if the id is gone
 * (e.g. cleared while a request was in flight).
 */
async function applyResult(id: string, data: Blob | string, outName: string, toolId: ToolId): Promise<void> {
    let file: File;
    try {
        file = await toFile(data, outName);
    } catch {
        return; // unreadable result — leave the item as-is
    }
    const entry = files.find(f => f.id === id);
    if (!entry) return;
    if (entry.currentUrl !== entry.originalUrl) URL.revokeObjectURL(entry.currentUrl);
    const url = URL.createObjectURL(file);
    files = files.map(f => f.id === id ? {
        ...f,
        name: outName,
        kind: kindOf(file),
        currentFile: file,
        currentUrl: url,
        provenance: f.provenance[f.provenance.length - 1] === toolId ? f.provenance : [...f.provenance, toolId],
        revision: f.revision + 1,
    } : f);
    emit();
}

/** Back to the untouched original (keeps the item in the session). */
function revert(id: string): void {
    const entry = files.find(f => f.id === id);
    if (!entry || entry.provenance.length === 0) return;
    if (entry.currentUrl !== entry.originalUrl) URL.revokeObjectURL(entry.currentUrl);
    files = files.map(f => f.id === id ? {
        ...f,
        name: f.originalFile.name,
        kind: kindOf(f.originalFile),
        currentFile: f.originalFile,
        currentUrl: f.originalUrl,
        provenance: [],
        revision: f.revision + 1,
    } : f);
    emit();
}

function revertAll(): void {
    if (!files.some(f => f.provenance.length > 0)) return;
    files = files.map(f => {
        if (f.provenance.length === 0) return f;
        if (f.currentUrl !== f.originalUrl) URL.revokeObjectURL(f.currentUrl);
        return {
            ...f,
            name: f.originalFile.name,
            kind: kindOf(f.originalFile),
            currentFile: f.originalFile,
            currentUrl: f.originalUrl,
            provenance: [],
            revision: f.revision + 1,
        };
    });
    emit();
}

function remove(ids: string[]): void {
    const gone = files.filter(f => ids.includes(f.id));
    if (!gone.length) return;
    gone.forEach(f => {
        if (f.currentUrl !== f.originalUrl) URL.revokeObjectURL(f.currentUrl);
        URL.revokeObjectURL(f.originalUrl);
    });
    files = files.filter(f => !ids.includes(f.id));
    emit();
}

function clear(): void {
    if (!files.length) return;
    files.forEach(f => {
        if (f.currentUrl !== f.originalUrl) URL.revokeObjectURL(f.currentUrl);
        URL.revokeObjectURL(f.originalUrl);
    });
    files = [];
    emit();
}

export const sessionStore = {
    subscribe,
    getSnapshot,
    addFiles,
    applyResult,
    revert,
    revertAll,
    remove,
    clear,
};

/** Live session snapshot (files + change counter). */
export function useSession(): SessionSnapshot {
    return useSyncExternalStore(subscribe, getSnapshot);
}

/**
 * Tool-side ingestion. Reconciles the session into a tool's local item list
 * WHILE THE TOOL IS ACTIVE (hidden tools don't ingest — avoids background
 * processing). Tracks id→revision so:
 *   • new/updated session files → onIngest (tool adds them, keyed by session id)
 *   • removed session files     → onRemove (tool drops its local entries)
 * A revision bump (another tool wrote a result, or a revert) re-ingests the
 * item so the active tool always sees the latest "current" file.
 *
 * Self-output guard: when a file's latest transform came from THIS tool
 * (provenance ends with toolId), the revision bump was our own applyResult —
 * mark it seen without re-ingesting, otherwise every result would immediately
 * reprocess itself in a loop.
 */
/** How long a tool must stay active before it ingests (and auto-processes) the
 *  session. Rapid rail-surfing through tools therefore costs ZERO processing —
 *  only the tool the user lands on starts work. Once settled, later session
 *  changes (drops, results) ingest immediately with no delay. */
const INGEST_SETTLE_MS = 450;

export function useSessionIngest(
    active: boolean,
    toolId: ToolId,
    accept: (f: SessionFile) => boolean,
    onIngest: (batch: { id: string; file: File; revision: number }[]) => void,
    onRemove: (ids: string[]) => void,
): void {
    const seen = useRef<Map<string, number>>(new Map());
    const settled = useRef(false);
    const { files: sessionFiles, gen: sessionGen } = useSession();

    useEffect(() => {
        if (!active) { settled.current = false; return; }

        const reconcile = () => {
            settled.current = true;
            const fresh: { id: string; file: File; revision: number }[] = [];
            const liveIds = new Set<string>();
            for (const f of sessionFiles) {
                if (!accept(f)) continue;
                liveIds.add(f.id);
                const prev = seen.current.get(f.id);
                if (prev === f.revision) continue;
                seen.current.set(f.id, f.revision);
                // Own output landing back in the store — already reflected locally.
                if (f.provenance[f.provenance.length - 1] === toolId && prev !== undefined) continue;
                fresh.push({ id: f.id, file: f.currentFile, revision: f.revision });
            }
            const removed: string[] = [];
            for (const id of Array.from(seen.current.keys())) {
                if (!liveIds.has(id)) { seen.current.delete(id); removed.push(id); }
            }
            if (removed.length) onRemove(removed);
            if (fresh.length) onIngest(fresh);
        };

        // Already settled in this activation → session changes apply immediately.
        if (settled.current) { reconcile(); return; }
        // Newly active → wait for the user to actually LAND here before processing.
        const timer = setTimeout(reconcile, INGEST_SETTLE_MS);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [active, sessionGen]);
}
