import { ToolId } from '../types';

export interface ClipboardPayload {
    sourceToolId: ToolId;
    itemIds: string[];
}

let state: ClipboardPayload | null = null;

export const clipboardState = {
    set: (s: ClipboardPayload) => { state = s; },
    get: (): ClipboardPayload | null => state,
    clear: () => { state = null; },
};
