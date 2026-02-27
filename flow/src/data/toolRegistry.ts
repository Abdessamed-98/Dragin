
import { ToolId } from '../types';

export interface ToolDep {
    /** Human-readable label */
    label: string;
    /** Approximate size in bytes */
    sizeBytes: number;
}

export interface ToolManifest {
    id: ToolId;
    /** If true, auto-installed on first launch */
    default: boolean;
    /** Empty = no extra deps needed (ships with app) */
    deps: ToolDep[];
    /** Total estimated download size in bytes */
    totalSizeBytes: number;
    /** GitHub Releases download URL (placeholder until infra ready) */
    downloadUrl?: string;
}

export const TOOL_REGISTRY: ToolManifest[] = [
    // Default tools — lightweight, ship with app (Pillow, PyMuPDF, vtracer)
    { id: 'compressor', default: true, deps: [], totalSizeBytes: 0 },
    { id: 'cropper',    default: true, deps: [], totalSizeBytes: 0 },
    { id: 'vectorizer', default: true, deps: [], totalSizeBytes: 0 },
    { id: 'pdf',        default: true, deps: [], totalSizeBytes: 0 },
    { id: 'metadata',   default: true, deps: [], totalSizeBytes: 0 },
    { id: 'watermark',  default: true, deps: [], totalSizeBytes: 0 },
    { id: 'palette',    default: true, deps: [], totalSizeBytes: 0 },
    { id: 'shelf',      default: true, deps: [], totalSizeBytes: 0 },

    // On-demand tools — heavy deps, downloaded from Dragin
    {
        id: 'remover',
        default: false,
        deps: [{ label: 'rembg + ONNX models', sizeBytes: 30_000_000 }],
        totalSizeBytes: 30_000_000,
        downloadUrl: 'https://github.com/AnasDragin/flow-tools/releases/download/remover-v1/remover-win-x64.zip',
    },
    {
        id: 'upscaler',
        default: false,
        deps: [
            { label: 'Real-ESRGAN binary', sizeBytes: 15_000_000 },
            { label: 'Upscaler models', sizeBytes: 35_000_000 },
        ],
        totalSizeBytes: 50_000_000,
        downloadUrl: 'https://github.com/AnasDragin/flow-tools/releases/download/upscaler-v1/upscaler-win-x64.zip',
    },
    {
        id: 'ocr',
        default: false,
        deps: [{ label: 'EasyOCR + language models', sizeBytes: 100_000_000 }],
        totalSizeBytes: 100_000_000,
        downloadUrl: 'https://github.com/AnasDragin/flow-tools/releases/download/ocr-v1/ocr-win-x64.zip',
    },
    {
        id: 'converter',
        default: false,
        deps: [{ label: 'FFmpeg', sizeBytes: 80_000_000 }],
        totalSizeBytes: 80_000_000,
        downloadUrl: 'https://github.com/AnasDragin/flow-tools/releases/download/converter-v1/converter-win-x64.zip',
    },
];

/** Quick lookup by ToolId */
export const REGISTRY_MAP: Record<ToolId, ToolManifest> = Object.fromEntries(
    TOOL_REGISTRY.map(m => [m.id, m])
) as Record<ToolId, ToolManifest>;

/** IDs of tools that ship with the app */
export const DEFAULT_TOOL_IDS: ToolId[] = TOOL_REGISTRY
    .filter(m => m.default)
    .map(m => m.id);

/** IDs of tools that require download */
export const ON_DEMAND_TOOL_IDS: ToolId[] = TOOL_REGISTRY
    .filter(m => !m.default)
    .map(m => m.id);

/** Format bytes to human-readable size */
export function formatSize(bytes: number): string {
    if (bytes === 0) return '';
    if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
    if (bytes < 1_000_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
    return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}
