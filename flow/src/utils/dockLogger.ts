/** Ring-buffer logger for debugging "dock dies randomly" issues.
 *
 *  Usage:
 *    import { dlog } from '../utils/dockLogger';
 *    dlog('visibility', { isVisible, reason });
 *
 *  In DevTools console:
 *    __dockDump()        — print last 200 entries
 *    __dockDump(20)      — print last 20
 *    __dockLog           — raw array access
 */

interface LogEntry {
    t: string;      // timestamp HH:MM:SS.mmm
    tag: string;    // category
    data: unknown;  // payload
}

const MAX = 200;
const buffer: LogEntry[] = [];

const ts = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}.${String(d.getMilliseconds()).padStart(3, '0')}`;
};

export const dlog = (tag: string, data?: unknown) => {
    const entry: LogEntry = { t: ts(), tag, data };
    buffer.push(entry);
    if (buffer.length > MAX) buffer.shift();
};

// Expose on window for console access
(window as any).__dockLog = buffer;
(window as any).__dockDump = (n = MAX) => {
    const slice = buffer.slice(-n);
    console.table(slice.map(e => ({ time: e.t, tag: e.tag, data: JSON.stringify(e.data) })));
    return slice;
};
