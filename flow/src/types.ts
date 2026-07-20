
import { LucideIcon } from 'lucide-react';

export type ToolId =
  | 'remover'    // Background Remover (BEN2)
  | 'compressor'
  | 'shelf'
  | 'converter'
  | 'vectorizer'
  | 'ocr'
  | 'palette'
  | 'cropper'
  | 'upscaler'   // New
  | 'pdf'        // New
  | 'metadata'   // New
  | 'watermark'  // New
  | 'resize'     // New
  | 'zip';       // New

export interface ToolDefinition {
  id: ToolId;
  title: string;
  description: string;
  icon: LucideIcon;
  colorClass: string;
  emptyHint?: string;
  emptySubHint?: string;
  formatLines?: string[];
}

export interface SessionItem {
  id: string;
  file: File;
  originalUrl: string;
  processedUrl?: string;

  /** 'idle' = carried into this tool via a rail switch — waits for the manual
   *  action button. 'pending' = queued for auto-processing (direct drop). */
  status: 'idle' | 'pending' | 'processing' | 'completed' | 'error';
  metadata?: {
    originalSize?: string;
    newSize?: string;
    savedPercentage?: string;
  };
}

export interface ActiveSession {
  id: string;
  toolId: ToolId;
  items: SessionItem[];
  selectedItemIds: string[]; // Track selected items
  status: 'idle' | 'processing' | 'completed' | 'error'; // General session status
  error?: string;
}

export interface DragState {
  isDragging: boolean;
  isNearRightEdge: boolean;
}

export type InstallStatus = 'not_installed' | 'installing' | 'installed' | 'error';

export interface InstallProgress {
  toolId: ToolId;
  status: InstallStatus;
  /** 0-100 */
  progress: number;
  /** Current step description */
  step?: string;
  error?: string;
}
