
import { Sparkles, Minimize2, Archive, ArrowRightLeft, PenTool, ScanText, Palette, Crop, Maximize2, FileText, ShieldAlert, Copyright, Scaling, FileArchive } from 'lucide-react';
import { ToolDefinition } from '../types';
import type { TranslationKey } from '../i18n';
import type { LucideIcon } from 'lucide-react';

export interface ToolDefinitionRaw {
  id: ToolDefinition['id'];
  titleKey: TranslationKey;
  descriptionKey: TranslationKey;
  icon: LucideIcon;
  colorClass: string;
  emptyHintKey: TranslationKey;
  emptySubHintKey: TranslationKey;
  formatLinesKeys: TranslationKey[];
}

export const ALL_TOOLS_RAW: ToolDefinitionRaw[] = [
  // --- Core Tools ---
  {
    id: 'remover',
    titleKey: 'tool.remover.title',
    descriptionKey: 'tool.remover.description',
    icon: Sparkles,
    colorClass: 'indigo',
    emptyHintKey: 'tool.remover.emptyHint',
    emptySubHintKey: 'tool.remover.emptySubHint',
    formatLinesKeys: ['tool.remover.formatLines.0'],
  },
  {
    id: 'compressor',
    titleKey: 'tool.compressor.title',
    descriptionKey: 'tool.compressor.description',
    icon: Minimize2,
    colorClass: 'emerald',
    emptyHintKey: 'tool.compressor.emptyHint',
    emptySubHintKey: 'tool.compressor.emptySubHint',
    formatLinesKeys: ['tool.compressor.formatLines.0'],
  },
  {
    id: 'shelf',
    titleKey: 'tool.shelf.title',
    descriptionKey: 'tool.shelf.description',
    icon: Archive,
    colorClass: 'amber',
    emptyHintKey: 'tool.shelf.emptyHint',
    emptySubHintKey: 'tool.shelf.emptySubHint',
    formatLinesKeys: ['tool.shelf.formatLines.0'],
  },

  // --- AI Enhancement ---
  {
    id: 'upscaler',
    titleKey: 'tool.upscaler.title',
    descriptionKey: 'tool.upscaler.description',
    icon: Maximize2,
    colorClass: 'pink',
    emptyHintKey: 'tool.upscaler.emptyHint',
    emptySubHintKey: 'tool.upscaler.emptySubHint',
    formatLinesKeys: ['tool.upscaler.formatLines.0'],
  },
  {
    id: 'pdf',
    titleKey: 'tool.pdf.title',
    descriptionKey: 'tool.pdf.description',
    icon: FileText,
    colorClass: 'red',
    emptyHintKey: 'tool.pdf.emptyHint',
    emptySubHintKey: 'tool.pdf.emptySubHint',
    formatLinesKeys: ['tool.pdf.formatLines.0'],
  },

  // --- Utilities ---
  {
    id: 'converter',
    titleKey: 'tool.converter.title',
    descriptionKey: 'tool.converter.description',
    icon: ArrowRightLeft,
    colorClass: 'blue',
    emptyHintKey: 'tool.converter.emptyHint',
    emptySubHintKey: 'tool.converter.emptySubHint',
    formatLinesKeys: ['tool.converter.formatLines.0', 'tool.converter.formatLines.1', 'tool.converter.formatLines.2'],
  },
  {
    id: 'metadata',
    titleKey: 'tool.metadata.title',
    descriptionKey: 'tool.metadata.description',
    icon: ShieldAlert,
    colorClass: 'orange',
    emptyHintKey: 'tool.metadata.emptyHint',
    emptySubHintKey: 'tool.metadata.emptySubHint',
    formatLinesKeys: ['tool.metadata.formatLines.0', 'tool.metadata.formatLines.1'],
  },
  {
    id: 'watermark',
    titleKey: 'tool.watermark.title',
    descriptionKey: 'tool.watermark.description',
    icon: Copyright,
    colorClass: 'cyan',
    emptyHintKey: 'tool.watermark.emptyHint',
    emptySubHintKey: 'tool.watermark.emptySubHint',
    formatLinesKeys: ['tool.watermark.formatLines.0', 'tool.watermark.formatLines.1'],
  },

  // --- Advanced ---
  {
    id: 'vectorizer',
    titleKey: 'tool.vectorizer.title',
    descriptionKey: 'tool.vectorizer.description',
    icon: PenTool,
    colorClass: 'rose',
    emptyHintKey: 'tool.vectorizer.emptyHint',
    emptySubHintKey: 'tool.vectorizer.emptySubHint',
    formatLinesKeys: ['tool.vectorizer.formatLines.0'],
  },
  {
    id: 'ocr',
    titleKey: 'tool.ocr.title',
    descriptionKey: 'tool.ocr.description',
    icon: ScanText,
    colorClass: 'fuchsia',
    emptyHintKey: 'tool.ocr.emptyHint',
    emptySubHintKey: 'tool.ocr.emptySubHint',
    formatLinesKeys: ['tool.ocr.formatLines.0', 'tool.ocr.formatLines.1'],
  },
  {
    id: 'palette',
    titleKey: 'tool.palette.title',
    descriptionKey: 'tool.palette.description',
    icon: Palette,
    colorClass: 'violet',
    emptyHintKey: 'tool.palette.emptyHint',
    emptySubHintKey: 'tool.palette.emptySubHint',
    formatLinesKeys: ['tool.palette.formatLines.0'],
  },
  {
    id: 'cropper',
    titleKey: 'tool.cropper.title',
    descriptionKey: 'tool.cropper.description',
    icon: Crop,
    colorClass: 'orange',
    emptyHintKey: 'tool.cropper.emptyHint',
    emptySubHintKey: 'tool.cropper.emptySubHint',
    formatLinesKeys: ['tool.cropper.formatLines.0'],
  },
  {
    id: 'resize',
    titleKey: 'tool.resize.title',
    descriptionKey: 'tool.resize.description',
    icon: Scaling,
    colorClass: 'sky',
    emptyHintKey: 'tool.resize.emptyHint',
    emptySubHintKey: 'tool.resize.emptySubHint',
    formatLinesKeys: ['tool.resize.formatLines.0'],
  },
  {
    id: 'zip',
    titleKey: 'tool.zip.title',
    descriptionKey: 'tool.zip.description',
    icon: FileArchive,
    colorClass: 'teal',
    emptyHintKey: 'tool.zip.emptyHint',
    emptySubHintKey: 'tool.zip.emptySubHint',
    formatLinesKeys: ['tool.zip.formatLines.0'],
  }
];
