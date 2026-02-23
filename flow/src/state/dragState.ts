import { ToolId } from '../types';

export interface ExportItem {
    id: string;
    name: string;
    dataUrl: string | null;
    filePath: string | null;
}

export interface InternalDragState {
    sourceToolId: ToolId;
    itemIds: string[];
    exportItems: ExportItem[];
}

let state: InternalDragState | null = null;
let cleanupFn: (() => void) | null = null;

export const dragState = {
    set: (s: InternalDragState, cleanup?: () => void) => {
        state = s;
        cleanupFn = cleanup ?? null;
    },
    get: (): InternalDragState | null => state,
    clear: () => {
        cleanupFn?.();
        cleanupFn = null;
        state = null;
    },
};
