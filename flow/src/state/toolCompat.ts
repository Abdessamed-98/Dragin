/**
 * Which file kinds each tool can operate on — drives the tool rail's
 * enabled/dimmed state and each tool's session-ingest filter.
 */
import { ToolId } from '../types';
import { FileKind, SessionFile } from './sessionStore';

const IMG: FileKind[] = ['image'];

export const TOOL_ACCEPT: Record<ToolId, FileKind[]> = {
    remover: IMG,
    compressor: IMG,
    cropper: IMG,
    resize: IMG,
    upscaler: IMG,
    watermark: IMG,
    metadata: IMG,
    vectorizer: IMG,
    palette: IMG,
    ocr: ['image', 'pdf'],
    pdf: ['pdf', 'image'],
    converter: ['image', 'video', 'audio'],
    zip: ['image', 'video', 'audio', 'pdf', 'archive', 'other'],
    // Shelf is persistent storage, not a transform — excluded from rail carry (v1).
    shelf: [],
};

export function toolAccepts(toolId: ToolId, f: SessionFile): boolean {
    return (TOOL_ACCEPT[toolId] || []).includes(f.kind);
}

/** A tool is switch-able when the session is empty (opens blank) or when it
 *  can operate on at least one session file. */
export function canSwitchTo(toolId: ToolId, files: SessionFile[]): boolean {
    if ((TOOL_ACCEPT[toolId] || []).length === 0) return false;
    if (files.length === 0) return true;
    return files.some(f => toolAccepts(toolId, f));
}
