/**
 * Tests for the shell's processing-overlay bridge: per-tool item status keyed
 * by fileId, revision-based staleness, and removal. Protects the shell's grid
 * overlay against the subtle bugs (stale done-state, cross-tool bleed).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { processingStore } from './processingStore';

const T = 'resize' as const;
const T2 = 'watermark' as const;

beforeEach(() => {
    processingStore.clearTool('resize');
    processingStore.clearTool('watermark');
});

describe('processingStore', () => {
    it('starts empty (stable empty object per tool)', () => {
        expect(processingStore.getTool(T)).toEqual({});
        // Same stable reference so useSyncExternalStore doesn't loop.
        expect(processingStore.getTool(T)).toBe(processingStore.getTool(T2));
    });

    it('setItem creates and merges patches', () => {
        processingStore.setItem(T, 'a', { status: 'processing', revision: 0 });
        expect(processingStore.getTool(T).a.status).toBe('processing');
        processingStore.setItem(T, 'a', { status: 'done', revision: 1, badge: '1280×720' });
        expect(processingStore.getTool(T).a).toMatchObject({ status: 'done', revision: 1, badge: '1280×720' });
    });

    it('swaps map identity on change (so React re-renders) but not otherwise', () => {
        processingStore.setItem(T, 'a', { status: 'idle', revision: 0 });
        const before = processingStore.getTool(T);
        processingStore.setItem(T, 'b', { status: 'idle', revision: 0 });
        expect(processingStore.getTool(T)).not.toBe(before);
    });

    it('isolates tools — same fileId, independent state', () => {
        processingStore.setItem(T, 'a', { status: 'done', revision: 1 });
        processingStore.setItem(T2, 'a', { status: 'idle', revision: 1 });
        expect(processingStore.getTool(T).a.status).toBe('done');
        expect(processingStore.getTool(T2).a.status).toBe('idle');
    });

    it('revision marks staleness (caller compares to file.revision)', () => {
        processingStore.setItem(T, 'a', { status: 'done', revision: 1, badge: 'x' });
        const st = processingStore.getTool(T).a;
        // A file bumped to revision 2 by another tool → this done-state is stale.
        expect(st.revision).toBe(1);
        expect(st.revision === 2).toBe(false);
    });

    it('preserves input across a status patch', () => {
        const f = new File([new Uint8Array([1])], 'a.png');
        processingStore.setItem(T, 'a', { status: 'idle', revision: 0, input: f });
        processingStore.setItem(T, 'a', { status: 'processing', revision: 0, input: f });
        expect(processingStore.getTool(T).a.input).toBe(f);
    });

    it('removeItems drops only the named ids', () => {
        processingStore.setItem(T, 'a', { status: 'idle', revision: 0 });
        processingStore.setItem(T, 'b', { status: 'idle', revision: 0 });
        processingStore.removeItems(T, ['a']);
        expect(Object.keys(processingStore.getTool(T))).toEqual(['b']);
    });

    it('clearTool empties a tool', () => {
        processingStore.setItem(T, 'a', { status: 'done', revision: 1 });
        processingStore.clearTool(T);
        expect(processingStore.getTool(T)).toEqual({});
    });
});
