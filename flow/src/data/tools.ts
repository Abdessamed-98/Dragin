
import { Wand2, Minimize2, Archive, ArrowRightLeft, PenTool, ScanText, Palette, Crop, ImagePlus, FileText, ShieldAlert, Stamp, Layers } from 'lucide-react';
import { ToolDefinition } from '../types';

export const ALL_TOOLS: ToolDefinition[] = [
  // --- Core Tools ---
  {
    id: 'remover',
    title: 'حذف الخلفية',
    description: 'إزالة خلفية الصورة بذكاء',
    icon: Wand2,
    colorClass: 'indigo',
    emptyHint: 'اسحب صور هنا لحذف الخلفية',
    emptySubHint: 'إزالة الخلفية بالذكاء الاصطناعي',
    formatLines: ['صور: JPG · PNG · WEBP · BMP · TIFF'],
  },
  {
    id: 'compressor',
    title: 'ضغط الصورة',
    description: 'تصغير حجم الملف',
    icon: Minimize2,
    colorClass: 'emerald',
    emptyHint: 'اسحب صور هنا للضغط',
    emptySubHint: 'تصغير حجم الملف مع الحفاظ على الجودة',
    formatLines: ['صور: JPG · PNG · WEBP · BMP · TIFF · GIF'],
  },
  {
    id: 'shelf',
    title: 'الدرج المؤقت',
    description: 'حفظ واسترجاع الصور',
    icon: Archive,
    colorClass: 'amber',
    emptyHint: 'اسحب ملفات هنا للحفظ المؤقت',
    emptySubHint: 'حفظ واسترجاع أي ملفات',
    formatLines: ['جميع أنواع الملفات مدعومة'],
  },

  // --- AI Enhancement ---
  {
    id: 'upscaler',
    title: 'رفع الدقة',
    description: 'تحسين جودة الصور 4X',
    icon: ImagePlus,
    colorClass: 'pink',
    emptyHint: 'اسحب صور هنا لرفع الدقة',
    emptySubHint: 'تحسين جودة الصور 4X بالذكاء الاصطناعي',
    formatLines: ['صور: JPG · PNG · WEBP · BMP · TIFF'],
  },
  {
    id: 'pdf',
    title: 'أدوات PDF',
    description: 'دمج وتنظيم وضغط ملفات PDF',
    icon: FileText,
    colorClass: 'red',
    emptyHint: 'اسحب ملفات PDF هنا',
    emptySubHint: 'دمج وتنظيم وضغط ملفات PDF',
    formatLines: ['مستندات: PDF'],
  },

  // --- Utilities ---
  {
    id: 'converter',
    title: 'تحويل الصيغة',
    description: 'تحويل صيغ الصور والفيديو والصوت',
    icon: ArrowRightLeft,
    colorClass: 'blue',
    emptyHint: 'اسحب ملفات هنا للتحويل',
    emptySubHint: 'تحويل صيغ الصور والفيديو والصوت',
    formatLines: ['صور: JPG · PNG · WEBP · BMP · TIFF · PSD · AI', 'فيديو: MP4 · WEBM · MOV · AVI · MKV · GIF', 'صوت: MP3 · WAV · OGG'],
  },
  {
    id: 'metadata',
    title: 'حذف البيانات',
    description: 'إزالة بيانات الموقع والخصوصية',
    icon: ShieldAlert,
    colorClass: 'orange',
    emptyHint: 'اسحب ملفات هنا لحذف البيانات',
    emptySubHint: 'إزالة EXIF ومعلومات الكاميرا والموقع',
    formatLines: ['صور: JPG · PNG · WEBP · BMP · TIFF · GIF', 'مستندات: PDF'],
  },
  {
    id: 'watermark',
    title: 'علامة مائية',
    description: 'إضافة ختم الحقوق',
    icon: Stamp,
    colorClass: 'cyan',
    emptyHint: 'اسحب ملفات هنا لإضافة علامة مائية',
    emptySubHint: 'إضافة نص على الصور وملفات PDF',
    formatLines: ['صور: JPG · PNG · WEBP · BMP · TIFF · GIF', 'مستندات: PDF'],
  },

  // --- Advanced ---
  {
    id: 'vectorizer',
    title: 'تحويل لـ Vector',
    description: 'تحويل الصورة لـ SVG',
    icon: PenTool,
    colorClass: 'rose',
    emptyHint: 'اسحب صورة هنا للتحويل',
    emptySubHint: 'تحويل الصورة لرسم متجه SVG',
    formatLines: ['صور: JPG · PNG · WEBP · BMP · TIFF'],
  },
  {
    id: 'ocr',
    title: 'استخراج النص',
    description: 'قراءة النصوص من الصور',
    icon: ScanText,
    colorClass: 'fuchsia',
    emptyHint: 'اسحب صورة أو PDF لاستخراج النص',
    emptySubHint: 'قراءة النصوص من الصور والمستندات',
    formatLines: ['صور: JPG · PNG · WEBP · BMP · TIFF', 'مستندات: PDF'],
  },
  {
    id: 'palette',
    title: 'استخراج الألوان',
    description: 'استخراج الألوان من الصور',
    icon: Palette,
    colorClass: 'violet',
    emptyHint: 'اسحب صورة هنا لاستخراج الألوان',
    emptySubHint: 'استخراج الألوان السائدة مع أكواد HEX',
    formatLines: ['صور: JPG · PNG · WEBP · BMP · TIFF · GIF'],
  },
  {
    id: 'cropper',
    title: 'قص الصورة',
    description: 'تعديل أبعاد الصورة',
    icon: Crop,
    colorClass: 'orange',
    emptyHint: 'اسحب صورة هنا للقص',
    emptySubHint: 'تعديل أبعاد الصورة',
    formatLines: ['صور: JPG · PNG · WEBP · BMP · TIFF'],
  }
];
