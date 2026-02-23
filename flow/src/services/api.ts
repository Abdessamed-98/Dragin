
/**
 * Backend API service — calls the local Flask server
 */

const BASE_URL = 'http://localhost:5000';

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Helper to return original file as result
const returnOriginal = async (file: File): Promise<string> => {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
};

// 1. Background Remover (Python Flask Backend)
export type RemoverMode = 'precision' | 'speed';

export interface RemoverOptions {
  mode?: RemoverMode;
}

export const removeBackground = async (file: File, options?: RemoverOptions): Promise<string> => {
  const results = await removeBackgroundBatch([file], options);
  return results[0];
};

/** Batch remove background — sends all files in a single request. Returns data-URLs in same order. */
export const removeBackgroundBatch = async (files: File[], options?: RemoverOptions): Promise<string[]> => {
  try {
    const formData = new FormData();
    files.forEach(f => formData.append('images', f));
    if (options?.mode) formData.append('mode', options.mode);

    const res = await fetch(`${BASE_URL}/process`, {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      throw new Error(`Server error: ${res.status}`);
    }

    const data = await res.json();

    if (data.results && data.results.length > 0) {
      return data.results.map((r: { data: string }) => `data:image/png;base64,${r.data}`);
    } else {
      throw new Error('No results from server');
    }
  } catch (err) {
    console.error('Background removal failed:', err);
    throw err;
  }
};

// 1.1 Remove Empty Space (Trim Transparency - Canvas API)
export const trimTransparency = async (dataUrl: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context unavailable'));
        return;
      }

      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      let top = null, bottom = null, left = null, right = null;

      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const alpha = data[(y * canvas.width + x) * 4 + 3];
          if (alpha > 30) {
            if (top === null) top = y;
            if (left === null || x < left) left = x;
            if (right === null || x > right) right = x;
            if (bottom === null || y > bottom) bottom = y;
          }
        }
      }

      if (top !== null && left !== null && right !== null && bottom !== null) {
        const trimWidth = right - left + 1;
        const trimHeight = bottom - top + 1;
        const trimmedCanvas = document.createElement('canvas');
        trimmedCanvas.width = trimWidth;
        trimmedCanvas.height = trimHeight;
        const trimmedCtx = trimmedCanvas.getContext('2d');
        if (trimmedCtx) {
          trimmedCtx.drawImage(canvas, left, top, trimWidth, trimHeight, 0, 0, trimWidth, trimHeight);
          resolve(trimmedCanvas.toDataURL());
        } else {
          reject(new Error('Trimmed canvas context unavailable'));
        }
      } else {
        // Image is fully transparent or error
        resolve(dataUrl);
      }
    };
    img.onerror = () => reject(new Error('Failed to load image for trimming'));
    img.src = dataUrl;
  });
};

// 2. Image Compressor (Python Flask Backend)
export const compressImage = async (file: File, quality = 70): Promise<{ url: string; originalSize: string; newSize: string; saved: string; mime: string }> => {
  try {
    const formData = new FormData();
    formData.append('image', file);
    formData.append('quality', String(quality));

    const res = await fetch(`${BASE_URL}/compress`, {
      method: 'POST',
      body: formData
    });

    if (!res.ok) {
      throw new Error(`Server error: ${res.status}`);
    }

    const data = await res.json();

    const formatSize = (bytes: number): string => {
      if (bytes < 1024) return `${bytes} B`;
      const kb = bytes / 1024;
      if (kb < 1024) return `${kb.toFixed(1)} KB`;
      return `${(kb / 1024).toFixed(1)} MB`;
    };

    return {
      url: `data:${data.mime};base64,${data.data}`,
      originalSize: formatSize(data.originalSize),
      newSize: formatSize(data.newSize),
      saved: data.savedPercentage,
      mime: data.mime
    };
  } catch (err) {
    console.error('Image compression failed:', err);
    throw err;
  }
};

// 3. (Shelf is handled via Electron IPC in DockApp — no API call needed)

// 4. Image Cropper (Mock)
export const cropImage = async (file: File): Promise<string> => {
  await wait(1000);
  return returnOriginal(file);
};

// --- NEW TOOLS MOCKS ---

// --- Image Upscaler (Real-ESRGAN) ---

export type UpscaleModel = 'realesrgan-x4plus' | 'realesrgan-x4plus-anime';
export type UpscaleScale = 2 | 3 | 4;

export interface UpscaleJobResult { jobId: string }
export interface UpscaleProgressResult {
  status: 'processing' | 'done' | 'error';
  progress: number;
  size?: number;
  error?: string;
}

export const getUpscaleStatus = async (): Promise<{ available: boolean }> => {
  const res = await fetch(`${BASE_URL}/upscale/status`);
  if (!res.ok) throw new Error('Failed to check upscaler status');
  return await res.json();
};

export const startUpscale = async (file: File, scale: UpscaleScale = 4, model: UpscaleModel = 'realesrgan-x4plus'): Promise<UpscaleJobResult> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('scale', String(scale));
  formData.append('model', model);

  const res = await fetch(`${BASE_URL}/upscale`, { method: 'POST', body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Server error: ${res.status}`);
  }
  return await res.json();
};

export const getUpscaleProgress = async (jobId: string): Promise<UpscaleProgressResult> => {
  const res = await fetch(`${BASE_URL}/upscale/progress/${jobId}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Server error: ${res.status}`);
  }
  return await res.json();
};

/** Return the URL to stream the upscaled result (for on-demand download). */
export const getUpscaleResultUrl = (jobId: string): string =>
  `${BASE_URL}/upscale/result/${jobId}`;

/** Download an upscaled result as a temporary Blob (caller must revoke). */
export const fetchUpscaleResultBlob = async (jobId: string): Promise<Blob> => {
  const res = await fetch(`${BASE_URL}/upscale/result/${jobId}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Server error: ${res.status}`);
  }
  return await res.blob();
};

/** Tell the backend to delete temp files for a finished upscale job. */
export const cleanupUpscaleJob = async (jobId: string): Promise<void> => {
  await fetch(`${BASE_URL}/upscale/cleanup/${jobId}`, { method: 'POST' }).catch(() => {});
};

// 6. Colorizer
export const colorizeImage = async (file: File): Promise<string> => {
  await wait(2000);
  return returnOriginal(file);
};

// 7. Metadata Scrubber
export interface ScrubResult {
  url: string;
  mime: string;
  originalSize: number;
  newSize: number;
  removedFields: Record<string, string>;
}

export const scrubMetadata = async (file: File): Promise<ScrubResult> => {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch(`${BASE_URL}/scrub-metadata`, { method: 'POST', body: fd });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Server error: ${res.status}`);
  }
  const data = await res.json();
  return {
    url: `data:${data.mime};base64,${data.data}`,
    mime: data.mime,
    originalSize: data.originalSize,
    newSize: data.newSize,
    removedFields: data.removedFields || {},
  };
};

// 8. Watermarker
export interface WatermarkOptions {
  text: string;
  opacity: number;
  fontSize: number;
  style: 'diagonal' | 'center' | 'corner';
  color: string;
}

export const addWatermark = async (file: File, options: WatermarkOptions): Promise<{ url: string; size: number }> => {
  const fd = new FormData();
  fd.append('file', file);
  fd.append('text', options.text);
  fd.append('opacity', String(options.opacity));
  fd.append('fontSize', String(options.fontSize));
  fd.append('style', options.style);
  fd.append('color', options.color);
  const res = await fetch(`${BASE_URL}/watermark`, { method: 'POST', body: fd });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Server error: ${res.status}`);
  }
  const data = await res.json();
  return {
    url: `data:${data.mime};base64,${data.data}`,
    size: data.size,
  };
};

// 9. Vectorizer (vtracer backend)
export interface VectorizeOptions {
  colormode: 'color' | 'binary';
  corner_threshold: number;   // 0-180, higher = smoother
  length_threshold: number;   // path segment smoothing
  splice_threshold: number;   // 0-180, curve splice threshold
  filter_speckle: number;     // remove small patches
  color_precision: number;    // color depth
  path_precision: number;     // SVG path precision
}

export const vectorizeImage = async (
  file: File,
  options: Partial<VectorizeOptions> = {}
): Promise<{ svgString: string; svgDataUrl: string }> => {
  const formData = new FormData();
  formData.append('image', file);

  // Apply defaults then user overrides
  const defaults: VectorizeOptions = {
    colormode: 'color',
    corner_threshold: 60,
    length_threshold: 4.0,
    splice_threshold: 45,
    filter_speckle: 4,
    color_precision: 6,
    path_precision: 8,
  };

  const merged = { ...defaults, ...options };

  Object.entries(merged).forEach(([key, value]) => {
    formData.append(key, String(value));
  });

  const res = await fetch(`${BASE_URL}/vectorize`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Server error: ${res.status}`);
  }

  const data = await res.json();
  const svgString = data.svg;

  // Convert SVG string to a data URL for <img> rendering
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml' });
  const svgDataUrl = URL.createObjectURL(svgBlob);

  return { svgString, svgDataUrl };
};
// --- PDF Tools ---

export interface PageEntry {
  fileIndex: number;
  pageNum: number;
}

export interface PdfThumbnail {
  pageNum: number;
  data: string;
  width: number;
  height: number;
}

export type PdfCompressPreset = 'low' | 'medium' | 'high';

export const getPdfThumbnails = async (
  file: File,
  dpi?: number
): Promise<{ thumbnails: PdfThumbnail[]; pageCount: number }> => {
  const formData = new FormData();
  formData.append('pdf', file);
  if (dpi) formData.append('dpi', String(dpi));

  const res = await fetch(`${BASE_URL}/pdf/thumbnails`, { method: 'POST', body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Server error: ${res.status}`);
  }
  return await res.json();
};

export const mergePdfs = async (
  files: File[]
): Promise<{ dataUrl: string; size: number; pageCount: number }> => {
  const formData = new FormData();
  files.forEach(f => formData.append('pdfs', f));

  const res = await fetch(`${BASE_URL}/pdf/merge`, { method: 'POST', body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return {
    dataUrl: `data:application/pdf;base64,${data.data}`,
    size: data.size,
    pageCount: data.pageCount,
  };
};

export const organizePdf = async (
  files: File[],
  pageOrder: PageEntry[]
): Promise<{ dataUrl: string; size: number; pageCount: number }> => {
  const formData = new FormData();
  files.forEach(f => formData.append('pdfs', f));
  formData.append('pages', JSON.stringify(pageOrder));

  const res = await fetch(`${BASE_URL}/pdf/organize`, { method: 'POST', body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return {
    dataUrl: `data:application/pdf;base64,${data.data}`,
    size: data.size,
    pageCount: data.pageCount,
  };
};

export const compressPdf = async (
  file: File,
  preset: PdfCompressPreset
): Promise<{ dataUrl: string; originalSize: number; newSize: number; savedPercentage: string }> => {
  const formData = new FormData();
  formData.append('pdf', file);
  formData.append('preset', preset);

  const res = await fetch(`${BASE_URL}/pdf/compress`, { method: 'POST', body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return {
    dataUrl: `data:application/pdf;base64,${data.data}`,
    originalSize: data.originalSize,
    newSize: data.newSize,
    savedPercentage: data.savedPercentage,
  };
};

// 9.5 PDF to Word (pdf2docx)
export const convertPdfToWord = async (file: File): Promise<{ dataUrl: string; size: number }> => {
  const formData = new FormData();
  formData.append('pdf', file);

  const res = await fetch(`${BASE_URL}/pdf/to-word`, { method: 'POST', body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Server error: ${res.status}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return {
    dataUrl: `data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,${data.data}`,
    size: data.size,
  };
};

// 9.6 PDF to PowerPoint (python-pptx)
export const convertPdfToPptx = async (file: File): Promise<{ dataUrl: string; size: number; slideCount: number }> => {
  const formData = new FormData();
  formData.append('pdf', file);

  const res = await fetch(`${BASE_URL}/pdf/to-pptx`, { method: 'POST', body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Server error: ${res.status}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return {
    dataUrl: `data:application/vnd.openxmlformats-officedocument.presentationml.presentation;base64,${data.data}`,
    size: data.size,
    slideCount: data.slideCount,
  };
};

// 10. OCR - PP-OCRv5 text extraction
export const extractText = async (file: File): Promise<{ text: string; pages: number }> => {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${BASE_URL}/ocr`, {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Server error: ${res.status}`);
  }

  const data = await res.json();
  return { text: data.text ?? '', pages: data.pages ?? 1 };
};

// --- Format Converter ---

export type ImageFormat = 'jpg' | 'png' | 'webp' | 'bmp' | 'tiff';
export type VideoFormat = 'mp4' | 'webm' | 'mov' | 'avi' | 'mkv';
export type AudioFormat = 'mp3' | 'wav' | 'ogg';
export type ConvertFormat = ImageFormat | VideoFormat | AudioFormat | 'gif';

export interface ConvertImageResult { dataUrl: string; format: string; size: number }
export interface VideoJobResult { jobId: string }
export interface VideoProgressResult {
  status: 'processing' | 'done' | 'error';
  progress: number;
  dataUrl?: string;
  size?: number;
  error?: string;
}

export const getConvertStatus = async (): Promise<{ ffmpeg: boolean }> => {
  const res = await fetch(`${BASE_URL}/convert/status`);
  if (!res.ok) throw new Error('Failed to check converter status');
  return await res.json();
};

export const convertImage = async (file: File, format: ImageFormat): Promise<ConvertImageResult> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('format', format);

  const res = await fetch(`${BASE_URL}/convert/image`, { method: 'POST', body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Server error: ${res.status}`);
  }
  return await res.json();
};

export const startVideoConversion = async (file: File, format: ConvertFormat): Promise<VideoJobResult> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('format', format);

  const res = await fetch(`${BASE_URL}/convert/video`, { method: 'POST', body: formData });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Server error: ${res.status}`);
  }
  return await res.json();
};

export const getVideoProgress = async (jobId: string): Promise<VideoProgressResult> => {
  const res = await fetch(`${BASE_URL}/convert/video/progress/${jobId}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(err.error || `Server error: ${res.status}`);
  }
  return await res.json();
};

// ── File Preview / Thumbnail ─────────────────────────────────────────

/** Extensions the browser can natively render as <img> thumbnails. */
const BROWSER_RENDERABLE_EXTS = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'svg', 'ico', 'avif',
]);

/** Extensions that need backend rendering via /preview/thumbnail. */
const BACKEND_PREVIEW_EXTS = new Set(['psd', 'ai', 'tiff', 'tif', 'pdf', 'docx', 'xlsx', 'pptx']);

/**
 * Get a thumbnail URL for any supported file.
 * - Browser-renderable images/videos → createObjectURL (instant).
 * - PSD/AI/TIFF/PDF → backend /preview/thumbnail endpoint.
 * - Unknown types → returns null.
 *
 * Caller must call URL.revokeObjectURL() when needsRevoke is true.
 */
export const getFileThumbnail = async (
  file: File,
  maxSize = 128,
): Promise<{ url: string; needsRevoke: boolean } | null> => {
  const ext = (file.name.split('.').pop() || '').toLowerCase();

  // Browser-native image
  if (BROWSER_RENDERABLE_EXTS.has(ext) || (file.type.startsWith('image/') && !BACKEND_PREVIEW_EXTS.has(ext))) {
    return { url: URL.createObjectURL(file), needsRevoke: true };
  }

  // Browser-native video
  if (file.type.startsWith('video/')) {
    return { url: URL.createObjectURL(file), needsRevoke: true };
  }

  // Backend rendering (PSD, AI, TIFF, PDF)
  if (BACKEND_PREVIEW_EXTS.has(ext)) {
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('maxSize', String(maxSize));
      const res = await fetch(`${BASE_URL}/preview/thumbnail`, { method: 'POST', body: fd });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.error) return null;
      return { url: data.data, needsRevoke: false };
    } catch {
      return null;
    }
  }

  return null;
};
