/**
 * Tool UI settings store — persists each shell tool's CONTROL state (resize
 * W/H/mode, watermark text/opacity/…) across rail switches.
 *
 * With separate mounted trees, control state survived switches for free; the
 * shell remounts a tool's Controls on every switch, so that state must live
 * outside the component. Module-level + keyed by toolId does exactly that.
 * Reactive (subscribe/emit) so editing a control repaints its own widgets.
 */
import { useSyncExternalStore, useCallback, useRef } from 'react';
import { ToolId } from '../types';

type Settings = Record<string, unknown>;

const byTool: Partial<Record<ToolId, Settings>> = {};
const listeners = new Set<() => void>();

function emit(): void {
    listeners.forEach(l => { try { l(); } catch { /* isolate listener errors */ } });
}
function subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => { listeners.delete(l); };
}

function get(toolId: ToolId): Settings | undefined {
    return byTool[toolId];
}
function merge(toolId: ToolId, patch: Settings): void {
    byTool[toolId] = { ...(byTool[toolId] ?? {}), ...patch };
    emit();
}

export const toolUiStore = { subscribe, get, merge };

/**
 * Read/write a tool's persisted control settings.
 * Returns [state, set] where `state` is `defaults` merged with anything stored,
 * and `set(patch)` shallow-merges + persists. `defaults` is captured once.
 */
export function useToolUi<T extends Settings>(
    toolId: ToolId,
    defaults: T,
): [T, (patch: Partial<T>) => void] {
    // `defaults` is a stable per-tool object from the descriptor — use it
    // directly (NOT a first-mount ref), since one ToolShell instance is reused
    // across tools and a captured ref would keep the previous tool's defaults.
    const toolIdRef = useRef(toolId);
    toolIdRef.current = toolId;

    const stored = useSyncExternalStore(subscribe, () => get(toolId));
    const state = { ...defaults, ...(stored ?? {}) } as T;

    const set = useCallback((patch: Partial<T>) => {
        merge(toolIdRef.current, patch as Settings);
    }, []);

    return [state, set];
}
