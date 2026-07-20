/**
 * Tiny promise pool — run `worker` over `items` with at most `limit` in flight.
 * Batch tools use this instead of firing every item at the backend at once,
 * which saturated all cores (Flask threads every request). Same throughput,
 * responsive machine, progressive results.
 */
export async function runPool<T>(items: T[], worker: (item: T) => Promise<unknown>, limit = 3): Promise<void> {
    if (!items.length) return;
    let next = 0;
    const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const item = items[next++];
            try { await worker(item); } catch { /* per-item errors are handled by the worker's own state updates */ }
        }
    });
    await Promise.all(lanes);
}
