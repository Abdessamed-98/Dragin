
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
    { id: 'resize',     default: true, deps: [], totalSizeBytes: 0 },
    { id: 'zip',        default: true, deps: [], totalSizeBytes: 0 },

    // On-demand tools — heavy deps, downloaded from Dragin (per-platform URLs live in main.js)
    {
        // Background Remover — BEN2 dependency pack (torch CPU + BEN2 runtime, extracted
        // to tools/remover/lib). Model weights download separately on first use (cached).
        id: 'remover',
        default: false,
        deps: [
            { label: 'PyTorch (CPU) + BEN2 runtime', sizeBytes: 230_000_000 },
            { label: 'BEN2 model weights (first use, cached)', sizeBytes: 450_000_000 },
        ],
        totalSizeBytes: 230_000_000,
    },
    {
        id: 'upscaler',
        default: false,
        deps: [
            { label: 'Real-ESRGAN binary', sizeBytes: 7_000_000 },
            { label: 'Upscaler models', sizeBytes: 35_000_000 },
        ],
        totalSizeBytes: 42_000_000,
    },
    { id: 'ocr',        default: true, deps: [], totalSizeBytes: 0 },
    {
        id: 'converter',
        default: false,
        deps: [{ label: 'FFmpeg', sizeBytes: 63_000_000 }],
        totalSizeBytes: 63_000_000,
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
