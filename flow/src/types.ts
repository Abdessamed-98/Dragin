
import { LucideIcon } from 'lucide-react';

export type ToolId =
  | 'remover'
  | 'compressor'
  | 'shelf'
  | 'converter'
  | 'vectorizer'
  | 'ocr'
  | 'scanner'
  | 'cropper'
  | 'upscaler'   // New
  | 'pdf'        // New
  | 'metadata'   // New
  | 'watermark'; // New

export interface ToolDefinition {
  id: ToolId;
  title: string;
  description: string;
  icon: LucideIcon;
  colorClass: string;
}

export interface SessionItem {
  id: string;
  file: File;
  originalUrl: string;
  processedUrl?: string;

  status: 'pending' | 'processing' | 'completed' | 'error';
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
