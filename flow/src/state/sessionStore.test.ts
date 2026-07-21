/**
 * Core tests for the session store — the heart of the tool-switching pipeline.
 * These protect the carry semantics: originals kept, results travel forward,
 * revert restores, removal/clear revoke and empty correctly.
 *
 * Run: npm test
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Node has no URL.createObjectURL — stub it (the store revokes what it creates).
const created: string[] = [];
const revoked: string[] = [];
let urlCounter = 0;
(URL as any).createObjectURL = vi.fn(() => { const u = `blob:test-${++urlCounter}`; created.push(u); return u; });
(URL as any).revokeObjectURL = vi.fn((u: string) => { revoked.push(u); });

import { sessionStore, kindOf } from './sessionStore';
import { canSwitchTo, toolAccepts } from './toolCompat';
import { runPool } from '../utils/pool';

const img = (name = 'a.png') => new File([new Uint8Array([1, 2, 3])], name, { type: 'image/png' });
const flushMicrotasks = () => new Promise<void>(r => queueMicrotask(() => r()));

beforeEach(() => {
    sessionStore.clear();
    created.length = 0;
    revoked.length = 0;
});

describe('kindOf', () => {
    it('classifies by mime and extension', () => {
        expect(kindOf(img())).toBe('image');
        expect(kindOf(new File([], 'x.heic'))).toBe('image');
        expect(kindOf(new File([], 'v.mp4'))).toBe('video');
        expect(kindOf(new File([], 's.mp3'))).toBe('audio');
        expect(kindOf(new File([], 'd.pdf'))).toBe('pdf');
        expect(kindOf(new File([], 'z.zip'))).toBe('archive');
        expect(kindOf(new File([], 'unknown.xyz'))).toBe('other');
    });
});

describe('addFiles', () => {
    it('adds files with target tool and empty provenance', () => {
        const [f] = sessionStore.addFiles([img()], 'remover');
        expect(f.provenance).toEqual([]);
        expect(f.addedFor).toBe('remover');
        expect(f.revision).toBe(0);
        expect(f.currentFile).toBe(f.originalFile);
        expect(sessionStore.getSnapshot().files).toHaveLength(1);
    });

    it('defaults addedFor to null (no target tool)', () => {
        const [f] = sessionStore.addFiles([img()]);
        expect(f.addedFor).toBeNull();
    });
});

describe('applyResult — the pipeline', () => {
    it('output becomes current, provenance grows, revision bumps, original kept', async () => {
        const [f] = sessionStore.addFiles([img('photo.png')], 'remover');
        await sessionStore.applyResult(f.id, new Blob([new Uint8Array([9])], { type: 'image/png' }), 'photo-BGremoved.png', 'remover');
        const cur = sessionStore.getSnapshot().files[0];
        expect(cur.name).toBe('photo-BGremoved.png');
        expect(cur.provenance).toEqual(['remover']);
        expect(cur.revision).toBe(1);
        expect(cur.currentFile).not.toBe(cur.originalFile);
        expect(cur.originalFile.name).toBe('photo.png');
    });

    it('same tool twice does not duplicate provenance; different tool chains it', async () => {
        const [f] = sessionStore.addFiles([img()], 'remover');
        await sessionStore.applyResult(f.id, new Blob(['1']), 'a1.png', 'remover');
        await sessionStore.applyResult(f.id, new Blob(['2']), 'a2.png', 'remover');
        expect(sessionStore.getSnapshot().files[0].provenance).toEqual(['remover']);
        await sessionStore.applyResult(f.id, new Blob(['3']), 'a3.svg', 'vectorizer');
        expect(sessionStore.getSnapshot().files[0].provenance).toEqual(['remover', 'vectorizer']);
    });

    it('updates kind from the output (png → svg)', async () => {
        const [f] = sessionStore.addFiles([img()]);
        await sessionStore.applyResult(f.id, new Blob(['<svg/>'], { type: 'image/svg+xml' }), 'a.svg', 'vectorizer');
        expect(sessionStore.getSnapshot().files[0].kind).toBe('image');
        expect(sessionStore.getSnapshot().files[0].name).toBe('a.svg');
    });

    it('is a no-op for removed ids (late result after clear)', async () => {
        const [f] = sessionStore.addFiles([img()]);
        sessionStore.remove([f.id]);
        await sessionStore.applyResult(f.id, new Blob(['x']), 'x.png', 'resize');
        expect(sessionStore.getSnapshot().files).toHaveLength(0);
    });

    it('revokes the previous result URL when a new result lands', async () => {
        const [f] = sessionStore.addFiles([img()]);
        await sessionStore.applyResult(f.id, new Blob(['1']), 'r1.png', 'resize');
        const firstResultUrl = sessionStore.getSnapshot().files[0].currentUrl;
        await sessionStore.applyResult(f.id, new Blob(['2']), 'r2.png', 'resize');
        expect(revoked).toContain(firstResultUrl);
    });
});

describe('revert', () => {
    it('restores the original file, clears provenance, bumps revision', async () => {
        const [f] = sessionStore.addFiles([img('orig.png')]);
        await sessionStore.applyResult(f.id, new Blob(['x']), 'out.png', 'resize');
        sessionStore.revert(f.id);
        const cur = sessionStore.getSnapshot().files[0];
        expect(cur.name).toBe('orig.png');
        expect(cur.provenance).toEqual([]);
        expect(cur.currentFile).toBe(cur.originalFile);
        expect(cur.revision).toBe(2); // apply + revert
    });

    it('revertAll only touches transformed files', async () => {
        const [a, b] = sessionStore.addFiles([img('a.png'), img('b.png')]);
        await sessionStore.applyResult(a.id, new Blob(['x']), 'a-out.png', 'resize');
        const bRevBefore = sessionStore.getSnapshot().files.find(f => f.id === b.id)!.revision;
        sessionStore.revertAll();
        const files = sessionStore.getSnapshot().files;
        expect(files.find(f => f.id === a.id)!.provenance).toEqual([]);
        expect(files.find(f => f.id === b.id)!.revision).toBe(bRevBefore); // untouched
    });
});

describe('remove / clear', () => {
    it('remove revokes URLs and drops files', () => {
        const [a, b] = sessionStore.addFiles([img('a.png'), img('b.png')]);
        sessionStore.remove([a.id]);
        const files = sessionStore.getSnapshot().files;
        expect(files).toHaveLength(1);
        expect(files[0].id).toBe(b.id);
        expect(revoked).toContain(a.originalUrl);
    });

    it('clear empties everything and revokes all URLs', async () => {
        const [a] = sessionStore.addFiles([img()]);
        await sessionStore.applyResult(a.id, new Blob(['x']), 'out.png', 'resize');
        const { currentUrl } = sessionStore.getSnapshot().files[0];
        sessionStore.clear();
        expect(sessionStore.getSnapshot().files).toHaveLength(0);
        expect(revoked).toContain(a.originalUrl);
        expect(revoked).toContain(currentUrl);
    });
});

describe('coalesced emits', () => {
    it('N synchronous updates notify listeners once per microtask flush', async () => {
        const listener = vi.fn();
        const unsub = sessionStore.subscribe(listener);
        sessionStore.addFiles([img('1.png')]);
        sessionStore.addFiles([img('2.png')]);
        sessionStore.addFiles([img('3.png')]);
        expect(listener).not.toHaveBeenCalled(); // not yet flushed
        await flushMicrotasks();
        expect(listener).toHaveBeenCalledTimes(1);
        expect(sessionStore.getSnapshot().files).toHaveLength(3);
        unsub();
    });
});

describe('toolCompat', () => {
    it('image tools accept images only; zip accepts everything; shelf never switchable', () => {
        const [image] = sessionStore.addFiles([img()]);
        const [video] = sessionStore.addFiles([new File([], 'v.mp4')]);
        expect(toolAccepts('remover', image)).toBe(true);
        expect(toolAccepts('remover', video)).toBe(false);
        expect(toolAccepts('zip', video)).toBe(true);
        expect(canSwitchTo('shelf', [image])).toBe(false);
    });

    it('empty session: every real tool is switchable', () => {
        expect(canSwitchTo('vectorizer', [])).toBe(true);
        expect(canSwitchTo('converter', [])).toBe(true);
    });

    it('session with only a video: image tools dim, converter lights up', () => {
        const files = sessionStore.addFiles([new File([], 'v.mp4')]);
        expect(canSwitchTo('remover', files)).toBe(false);
        expect(canSwitchTo('converter', files)).toBe(true);
    });
});

describe('runPool', () => {
    it('caps concurrency at the limit', async () => {
        let inFlight = 0, peak = 0;
        await runPool([1, 2, 3, 4, 5, 6, 7, 8], async () => {
            inFlight++; peak = Math.max(peak, inFlight);
            await new Promise(r => setTimeout(r, 5));
            inFlight--;
        }, 3);
        expect(peak).toBeLessThanOrEqual(3);
    });

    it('continues past worker errors and completes all items', async () => {
        const done: number[] = [];
        await runPool([1, 2, 3, 4], async (n) => {
            if (n === 2) throw new Error('boom');
            done.push(n);
        }, 2);
        expect(done.sort()).toEqual([1, 3, 4]);
    });
});
