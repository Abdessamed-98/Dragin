
import { Wand2, Minimize2, Archive, ArrowRightLeft, PenTool, ScanText, FileScan, Crop, ImagePlus, FileText, ShieldAlert, Stamp } from 'lucide-react';
import { ToolDefinition } from '../types';

export const ALL_TOOLS: ToolDefinition[] = [
  // --- Core Tools ---
  {
    id: 'remover',
    title: 'حذف الخلفية',
    description: 'إزالة خلفية الصورة بذكاء',
    icon: Wand2,
    colorClass: 'indigo'
  },
  {
    id: 'compressor',
    title: 'ضغط الصورة',
    description: 'تصغير حجم الملف',
    icon: Minimize2,
    colorClass: 'emerald'
  },
  {
    id: 'shelf',
    title: 'الدرج المؤقت',
    description: 'حفظ واسترجاع الصور',
    icon: Archive,
    colorClass: 'amber'
  },

  // --- AI Enhancement ---
  {
    id: 'upscaler',
    title: 'رفع الدقة',
    description: 'تحسين جودة الصور 4X',
    icon: ImagePlus,
    colorClass: 'pink'
  },
  {
    id: 'pdf',
    title: 'أدوات PDF',
    description: 'دمج وتنظيم وضغط ملفات PDF',
    icon: FileText,
    colorClass: 'teal'
  },

  // --- Utilities ---
  {
    id: 'converter',
    title: 'تحويل الصيغة',
    description: 'تحويل صيغ الصور والفيديو والصوت',
    icon: ArrowRightLeft,
    colorClass: 'blue'
  },
  {
    id: 'metadata',
    title: 'حذف البيانات',
    description: 'إزالة بيانات الموقع والخصوصية',
    icon: ShieldAlert,
    colorClass: 'red'
  },
  {
    id: 'watermark',
    title: 'علامة مائية',
    description: 'إضافة ختم الحقوق',
    icon: Stamp,
    colorClass: 'cyan'
  },

  // --- Advanced ---
  {
    id: 'vectorizer',
    title: 'تحويل لـ Vector',
    description: 'تحويل الصورة لـ SVG',
    icon: PenTool,
    colorClass: 'rose'
  },
  {
    id: 'ocr',
    title: 'استخراج النص',
    description: 'قراءة النصوص من الصور',
    icon: ScanText,
    colorClass: 'fuchsia'
  },
  {
    id: 'scanner',
    title: 'فحص ذكي',
    description: 'تحليل محتوى الملف',
    icon: FileScan,
    colorClass: 'violet'
  },
  {
    id: 'cropper',
    title: 'قص الصورة',
    description: 'تعديل أبعاد الصورة',
    icon: Crop,
    colorClass: 'orange'
  }
];
