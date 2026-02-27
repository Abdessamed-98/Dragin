import os, sys, io, base64, subprocess, threading, uuid, tempfile, shutil, json, zipfile, time
from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from PIL import Image, ImageOps, ImageEnhance, ImageFilter
from rembg import remove, new_session
import vtracer
import fitz  # PyMuPDF
import numpy as np

app = Flask(__name__)
CORS(app)

# ── Execution provider ──────────────────────────────────────────────
_providers = ['CPUExecutionProvider']
_device = 'CPU'
print(f"[Backend] Device: {_device}")

# ── Model cache ─────────────────────────────────────────────────────
# Lazy-load models on first use, auto-unload after idle timeout.
# User-facing modes mapped to internal rembg model names
MODE_TO_MODEL = {
    'precision': 'birefnet-general-lite',
    'speed': 'isnet-general-use',
}
DEFAULT_MODE = 'speed'
_model_cache = {}
_model_lock = threading.Lock()
_model_last_used = 0.0          # time.time() of last /process call
_MODEL_IDLE_TIMEOUT = 300       # 5 minutes

def get_model(name):
    global _model_last_used
    with _model_lock:
        _model_last_used = time.time()
        if name not in _model_cache:
            print(f"[Remover] Loading model: {name} ...")
            _model_cache[name] = new_session(name, providers=_providers)
            print(f"[Remover] Model {name} ready.")
        return _model_cache[name]

def _unload_models():
    """Free all cached rembg models to reclaim memory."""
    with _model_lock:
        if _model_cache:
            names = list(_model_cache.keys())
            _model_cache.clear()
            import gc; gc.collect()
            print(f"[Remover] Unloaded models: {names} — memory freed")

def _model_idle_watcher():
    """Background thread: unload models after idle timeout."""
    while True:
        time.sleep(60)  # check every minute
        with _model_lock:
            if _model_cache and _model_last_used > 0:
                idle = time.time() - _model_last_used
                if idle >= _MODEL_IDLE_TIMEOUT:
                    names = list(_model_cache.keys())
                    _model_cache.clear()
                    import gc; gc.collect()
                    print(f"[Remover] Auto-unloaded after {int(idle)}s idle: {names}")

threading.Thread(target=_model_idle_watcher, daemon=True).start()



@app.route('/process', methods=['POST'])
def process():
    if 'images' not in request.files:
        return jsonify({"error": "No images"}), 400

    files = request.files.getlist('images')
    mode = request.form.get('mode', DEFAULT_MODE)

    # Validate mode
    if mode not in MODE_TO_MODEL:
        mode = DEFAULT_MODE
    model_name = MODE_TO_MODEL[mode]

    sess = get_model(model_name)
    results = []
    req_start = time.perf_counter()

    for file in files:
        t0 = time.perf_counter()
        input_image = Image.open(io.BytesIO(file.read())).convert("RGB")
        w, h = input_image.size
        t_load = time.perf_counter() - t0

        t1 = time.perf_counter()
        output_image = remove(input_image, session=sess)
        t_infer = time.perf_counter() - t1

        t2 = time.perf_counter()
        buffered = io.BytesIO()
        output_image.save(buffered, format="PNG")
        img_str = base64.b64encode(buffered.getvalue()).decode('utf-8')
        t_encode = time.perf_counter() - t2

        print(f"[Remover] {file.filename} ({w}x{h}) | mode={mode} device={_device} | "
              f"load={t_load:.2f}s infer={t_infer:.2f}s encode={t_encode:.2f}s total={t_load+t_infer+t_encode:.2f}s")

        results.append({
            "name": file.filename,
            "data": img_str
        })

    total = time.perf_counter() - req_start
    print(f"[Remover] Request done: {len(files)} file(s) in {total:.2f}s ({mode}, {_device})")

    return jsonify({"results": results})


@app.route('/process/modes', methods=['GET'])
def list_modes():
    """Return available bg-removal modes."""
    return jsonify({"modes": list(MODE_TO_MODEL.keys()), "default": DEFAULT_MODE})

@app.route('/process/unload', methods=['POST'])
def unload_models():
    """Explicitly free cached bg-removal models to reclaim RAM."""
    _unload_models()
    return jsonify({"ok": True})

@app.route('/compress', methods=['POST'])
def compress():
    if 'image' not in request.files:
        return jsonify({"error": "No image file provided"}), 400

    file = request.files['image']
    quality = int(request.form.get('quality', 70))

    try:
        raw_bytes = file.read()
        original_size = len(raw_bytes)
        input_image = Image.open(io.BytesIO(raw_bytes))
        original_format = (input_image.format or 'PNG').upper()

        output_buffer = io.BytesIO()

        if original_format == 'JPEG' or original_format == 'JPG':
            # JPEG: re-encode at lower quality with optimization
            if input_image.mode in ('RGBA', 'P'):
                input_image = input_image.convert('RGB')
            input_image.save(output_buffer, format='JPEG', quality=quality, optimize=True)
            output_format = 'JPEG'
            mime = 'image/jpeg'
        elif original_format == 'PNG':
            # PNG: map quality (10-95) → color count (16-256) so the slider has real effect
            colors = max(16, min(256, round(quality * 256 / 95)))
            if input_image.mode == 'RGBA':
                quantized = input_image.quantize(colors=colors, method=2, dither=1)
                quantized = quantized.convert('RGBA')
                quantized.save(output_buffer, format='PNG', optimize=True)
            else:
                quantized = input_image.convert('RGB').quantize(colors=colors, method=2, dither=1)
                quantized.save(output_buffer, format='PNG', optimize=True)
            output_format = 'PNG'
            mime = 'image/png'
        else:
            # Everything else: convert to WebP for excellent compression
            if input_image.mode == 'RGBA':
                input_image.save(output_buffer, format='WEBP', quality=quality, method=4)
            else:
                input_image.convert('RGB').save(output_buffer, format='WEBP', quality=quality, method=4)
            output_format = 'WEBP'
            mime = 'image/webp'

        compressed_bytes = output_buffer.getvalue()
        new_size = len(compressed_bytes)

        # Only use compressed if it's actually smaller
        if new_size >= original_size:
            img_b64 = base64.b64encode(raw_bytes).decode('utf-8')
            new_size = original_size
            mime = f'image/{original_format.lower()}'
        else:
            img_b64 = base64.b64encode(compressed_bytes).decode('utf-8')

        saved_pct = round((1 - new_size / original_size) * 100) if original_size > 0 else 0

        return jsonify({
            "data": img_b64,
            "mime": mime,
            "originalSize": original_size,
            "newSize": new_size,
            "savedPercentage": f"{saved_pct}%"
        })

    except Exception as e:
        print(f"Compression error: {e}")
        return jsonify({"error": str(e)}), 500

def _preprocess_binary(img):
    """
    Flatten transparency → RGB distance-from-white threshold.
    Uses Euclidean distance from pure white in RGB space so bright-coloured pixels
    (yellow, light orange, cyan, etc.) are correctly kept as foreground — unlike
    grayscale luminance which misclassifies them as near-white background.
    """
    # Composite transparent areas onto white background
    white = Image.new('RGBA', img.size, (255, 255, 255, 255))
    white.paste(img, mask=img.split()[3])
    rgb = white.convert('RGB')

    # Light blur to suppress JPEG/anti-aliasing noise before thresholding
    rgb = rgb.filter(ImageFilter.GaussianBlur(radius=0.8))

    arr = np.array(rgb, dtype=np.float32)
    # Distance from pure white in RGB space — yellow (255,255,0) → dist≈255, white → 0
    dist = np.sqrt(
        (255 - arr[:, :, 0]) ** 2 +
        (255 - arr[:, :, 1]) ** 2 +
        (255 - arr[:, :, 2]) ** 2
    )
    # Pixels with distance > threshold are foreground (black), rest are background (white)
    binary = np.where(dist > 50, 0, 255).astype(np.uint8)

    result = Image.fromarray(binary, 'L').convert('RGBA')
    return result

def _preprocess_color(img):
    """
    Flatten transparency → slight saturation boost so vtracer's color
    quantisation separates colours more cleanly.
    """
    white = Image.new('RGBA', img.size, (255, 255, 255, 255))
    white.paste(img, mask=img.split()[3])
    rgb = white.convert('RGB')
    rgb = ImageEnhance.Color(rgb).enhance(1.4)   # boost saturation 40%
    return rgb.convert('RGBA')

@app.route('/vectorize', methods=['POST'])
def vectorize():
    if 'image' not in request.files:
        return jsonify({"error": "No image file provided"}), 400

    file = request.files['image']
    colormode = request.form.get('colormode', 'color')  # 'color' or 'binary'
    corner_threshold = int(request.form.get('corner_threshold', 60))
    length_threshold = float(request.form.get('length_threshold', 4.0))
    splice_threshold = int(request.form.get('splice_threshold', 45))
    filter_speckle = int(request.form.get('filter_speckle', 4))
    color_precision = int(request.form.get('color_precision', 6))
    path_precision = int(request.form.get('path_precision', 8))

    try:
        raw_bytes = file.read()

        # Normalize any image format (WebP, AVIF, JPEG, etc.) to PNG
        # so vtracer can always decode it
        img = Image.open(io.BytesIO(raw_bytes))
        if img.mode == 'RGBA':
            pass  # keep alpha
        else:
            img = img.convert('RGBA')

        # Cap large images for performance (2000px max side)
        img.thumbnail((2000, 2000), Image.LANCZOS)

        # Preprocess before vectorisation
        if colormode == 'binary':
            img = _preprocess_binary(img)
        else:
            img = _preprocess_color(img)

        png_buffer = io.BytesIO()
        img.save(png_buffer, format='PNG')
        png_bytes = png_buffer.getvalue()

        svg_str = vtracer.convert_raw_image_to_svg(
            png_bytes,
            img_format='png',
            colormode=colormode,
            hierarchical='stacked',
            mode='spline',
            filter_speckle=filter_speckle,
            color_precision=color_precision,
            corner_threshold=corner_threshold,
            length_threshold=length_threshold,
            splice_threshold=splice_threshold,
            path_precision=path_precision,
        )

        path_count = svg_str.count('<path')
        svg_size = len(svg_str.encode('utf-8'))

        return jsonify({
            "svg": svg_str,
            "colormode": colormode,
            "pathCount": path_count,
            "svgSize": svg_size,
        })

    except Exception as e:
        print(f"Vectorization error: {e}")
        return jsonify({"error": str(e)}), 500

# --- OCR Engine (EasyOCR, lazy init) ---
ocr_reader = None

def get_ocr_reader():
    global ocr_reader
    if ocr_reader is None:
        print("[OCR] Loading EasyOCR reader (first call)...")
        import easyocr
        # gpu=False for CPU-only; add more langs as needed
        ocr_reader = easyocr.Reader(['en', 'ar'], gpu=False, verbose=False)
        print("[OCR] Reader ready.")
    return ocr_reader

@app.route('/ocr', methods=['POST'])
def ocr():
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files['file']
    filename = (file.filename or '').lower()
    raw_bytes = file.read()

    try:
        reader = get_ocr_reader()
        pages_text = []

        if filename.endswith('.pdf'):
            # Convert each PDF page to an image array, run OCR per page
            pdf_doc = fitz.open(stream=raw_bytes, filetype='pdf')
            for page_num in range(len(pdf_doc)):
                page = pdf_doc[page_num]
                mat = fitz.Matrix(2.0, 2.0)  # 2x scale for better OCR accuracy
                pix = page.get_pixmap(matrix=mat, alpha=False)
                img_array = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
                result = reader.readtext(img_array, detail=0, paragraph=True)
                page_text = '\n'.join(result)
                pages_text.append(f"--- Page {page_num + 1} ---\n{page_text}")
            pdf_doc.close()
        else:
            # Image file
            img_array = np.array(Image.open(io.BytesIO(raw_bytes)).convert('RGB'))
            result = reader.readtext(img_array, detail=0, paragraph=True)
            pages_text.append('\n'.join(result))

        full_text = '\n\n'.join(pages_text)
        return jsonify({
            "text": full_text,
            "pages": len(pages_text)
        })

    except Exception as e:
        print(f"[OCR] Error: {e}")
        import traceback
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500

# --- PDF Tools ---

@app.route('/pdf/thumbnails', methods=['POST'])
def pdf_thumbnails():
    if 'pdf' not in request.files:
        return jsonify({"error": "No PDF provided"}), 400

    file = request.files['pdf']
    dpi = int(request.form.get('dpi', 72))

    try:
        raw = file.read()
        doc = fitz.open(stream=raw, filetype='pdf')
        scale = dpi / 72
        mat = fitz.Matrix(scale, scale)

        thumbnails = []
        for page_num in range(len(doc)):
            page = doc[page_num]
            pix = page.get_pixmap(matrix=mat, alpha=False)
            img_bytes = pix.tobytes("png")
            b64 = base64.b64encode(img_bytes).decode('utf-8')
            thumbnails.append({
                "pageNum": page_num,
                "data": f"data:image/png;base64,{b64}",
                "width": pix.width,
                "height": pix.height
            })

        page_count = len(doc)
        doc.close()
        return jsonify({"thumbnails": thumbnails, "pageCount": page_count})

    except Exception as e:
        print(f"[PDF Thumbnails] Error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/preview/thumbnail', methods=['POST'])
def preview_thumbnail():
    """Generic file thumbnail — renders page 0 of PDF/AI via PyMuPDF,
    or opens PSD/TIFF/etc. via Pillow. Returns PNG as base64 data URL."""
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files['file']
    max_size = int(request.form.get('maxSize', 128))
    filename = (file.filename or '').lower()
    raw = file.read()

    try:
        img = None

        # AI / PDF — render page 0 via PyMuPDF
        if filename.endswith('.ai') or filename.endswith('.pdf'):
            doc = fitz.open(stream=raw, filetype='pdf')
            if len(doc) > 0:
                page = doc[0]
                scale = min(max_size / page.rect.width, max_size / page.rect.height, 2.0)
                pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
                img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            doc.close()

        # Office OOXML — extract embedded thumbnail from ZIP archive
        elif filename.endswith(('.docx', '.xlsx', '.pptx')):
            try:
                zf = zipfile.ZipFile(io.BytesIO(raw))
                thumb_data = None
                for candidate in ['docProps/thumbnail.jpeg', 'docProps/thumbnail.png']:
                    if candidate in zf.namelist():
                        thumb_data = zf.read(candidate)
                        break
                zf.close()
                if thumb_data:
                    img = Image.open(io.BytesIO(thumb_data))
                    img.load()
            except zipfile.BadZipFile:
                pass

        else:
            # PSD, TIFF, and any other Pillow-supported format
            img = Image.open(io.BytesIO(raw))
            img.load()  # Force decode (important for PSD lazy loading)

        if img is None:
            return jsonify({"error": "Could not render file"}), 400

        # Composite alpha onto dark background (matches app UI)
        if img.mode in ('RGBA', 'LA', 'PA'):
            bg = Image.new('RGBA', img.size, (30, 30, 30, 255))
            bg.paste(img, mask=img.split()[-1])
            img = bg.convert('RGB')
        elif img.mode != 'RGB':
            img = img.convert('RGB')

        img.thumbnail((max_size, max_size), Image.LANCZOS)

        buf = io.BytesIO()
        img.save(buf, format='PNG', optimize=True)
        b64 = base64.b64encode(buf.getvalue()).decode('utf-8')

        return jsonify({
            "data": f"data:image/png;base64,{b64}",
            "width": img.width,
            "height": img.height,
        })

    except Exception as e:
        print(f"[Preview] Error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/pdf/merge', methods=['POST'])
def pdf_merge():
    files = request.files.getlist('pdfs')
    if len(files) < 2:
        return jsonify({"error": "Need at least 2 PDFs"}), 400

    try:
        merged = fitz.open()
        for f in files:
            raw = f.read()
            doc = fitz.open(stream=raw, filetype='pdf')
            merged.insert_pdf(doc)
            doc.close()

        page_count = len(merged)
        out_bytes = merged.tobytes(deflate=True, garbage=4)
        merged.close()

        b64 = base64.b64encode(out_bytes).decode('utf-8')
        return jsonify({
            "data": b64,
            "size": len(out_bytes),
            "pageCount": page_count
        })

    except Exception as e:
        print(f"[PDF Merge] Error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/pdf/organize', methods=['POST'])
def pdf_organize():
    import json
    files = request.files.getlist('pdfs')
    pages_json = request.form.get('pages', '[]')

    try:
        page_order = json.loads(pages_json)

        docs = []
        for f in files:
            raw = f.read()
            doc = fitz.open(stream=raw, filetype='pdf')
            docs.append(doc)

        result = fitz.open()
        for entry in page_order:
            fi = entry['fileIndex']
            pn = entry['pageNum']
            if fi < len(docs) and pn < len(docs[fi]):
                result.insert_pdf(docs[fi], from_page=pn, to_page=pn)

        page_count = len(result)
        out_bytes = result.tobytes(deflate=True, garbage=4)
        result.close()
        for d in docs:
            d.close()

        b64 = base64.b64encode(out_bytes).decode('utf-8')
        return jsonify({
            "data": b64,
            "size": len(out_bytes),
            "pageCount": page_count
        })

    except Exception as e:
        print(f"[PDF Organize] Error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/pdf/compress', methods=['POST'])
def pdf_compress():
    if 'pdf' not in request.files:
        return jsonify({"error": "No PDF provided"}), 400

    file = request.files['pdf']
    preset = request.form.get('preset', 'medium')

    presets = {
        'low':    {'image_quality': 30, 'dpi': 100},
        'medium': {'image_quality': 55, 'dpi': 150},
        'high':   {'image_quality': 80, 'dpi': 200},
    }
    params = presets.get(preset, presets['medium'])

    try:
        raw = file.read()
        original_size = len(raw)
        doc = fitz.open(stream=raw, filetype='pdf')

        # Re-compress images on each page
        for page_num in range(len(doc)):
            page = doc[page_num]
            image_list = page.get_images(full=True)
            for img_info in image_list:
                xref = img_info[0]
                try:
                    base_image = doc.extract_image(xref)
                    if not base_image or not base_image.get("image"):
                        continue
                    img_bytes = base_image["image"]
                    img = Image.open(io.BytesIO(img_bytes))

                    target_dpi = params['dpi']
                    scale = target_dpi / 150
                    if scale < 1:
                        new_w = max(1, int(img.width * scale))
                        new_h = max(1, int(img.height * scale))
                        img = img.resize((new_w, new_h), Image.LANCZOS)

                    buf = io.BytesIO()
                    if img.mode in ('RGBA', 'P'):
                        img = img.convert('RGB')
                    img.save(buf, format='JPEG', quality=params['image_quality'], optimize=True)
                    new_img_bytes = buf.getvalue()

                    if len(new_img_bytes) < len(img_bytes):
                        # Replace image in PDF
                        page.replace_image(xref, stream=new_img_bytes)
                except Exception:
                    continue

        out_bytes = doc.tobytes(deflate=True, garbage=4, clean=True)
        doc.close()

        new_size = len(out_bytes)
        if new_size >= original_size:
            b64 = base64.b64encode(raw).decode('utf-8')
            new_size = original_size
        else:
            b64 = base64.b64encode(out_bytes).decode('utf-8')

        saved_pct = round((1 - new_size / original_size) * 100) if original_size > 0 else 0

        return jsonify({
            "data": b64,
            "originalSize": original_size,
            "newSize": new_size,
            "savedPercentage": f"{saved_pct}%"
        })

    except Exception as e:
        print(f"[PDF Compress] Error: {e}")
        return jsonify({"error": str(e)}), 500


@app.route('/pdf/to-word', methods=['POST'])
def pdf_to_word():
    if 'pdf' not in request.files:
        return jsonify({"error": "No PDF provided"}), 400

    file = request.files['pdf']
    raw = file.read()
    tmp_dir = tempfile.mkdtemp()

    try:
        pdf_path = os.path.join(tmp_dir, 'input.pdf')
        docx_path = os.path.join(tmp_dir, 'output.docx')
        with open(pdf_path, 'wb') as f:
            f.write(raw)

        from pdf2docx import Converter
        cv = Converter(pdf_path)
        cv.convert(docx_path)
        cv.close()

        with open(docx_path, 'rb') as f:
            out_bytes = f.read()

        b64 = base64.b64encode(out_bytes).decode('utf-8')
        return jsonify({"data": b64, "size": len(out_bytes)})

    except Exception as e:
        print(f"[PDF to Word] Error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


@app.route('/pdf/to-pptx', methods=['POST'])
def pdf_to_pptx():
    if 'pdf' not in request.files:
        return jsonify({"error": "No PDF provided"}), 400

    file = request.files['pdf']
    dpi = int(request.form.get('dpi', 200))
    raw = file.read()
    tmp_dir = tempfile.mkdtemp()

    try:
        doc = fitz.open(stream=raw, filetype='pdf')
        from pptx import Presentation
        from pptx.util import Emu

        prs = Presentation()
        scale = dpi / 72
        slide_count = len(doc)

        for page_num in range(slide_count):
            page = doc[page_num]
            mat = fitz.Matrix(scale, scale)
            pix = page.get_pixmap(matrix=mat, alpha=False)

            # PDF points → EMU (1 pt = 12700 EMU)
            page_w_emu = int(page.rect.width * 12700)
            page_h_emu = int(page.rect.height * 12700)
            prs.slide_width = Emu(page_w_emu)
            prs.slide_height = Emu(page_h_emu)

            img_path = os.path.join(tmp_dir, f'page_{page_num}.png')
            pix.save(img_path)

            slide = prs.slides.add_slide(prs.slide_layouts[6])  # blank layout
            slide.shapes.add_picture(img_path, 0, 0, Emu(page_w_emu), Emu(page_h_emu))

        doc.close()
        pptx_path = os.path.join(tmp_dir, 'output.pptx')
        prs.save(pptx_path)

        with open(pptx_path, 'rb') as f:
            out_bytes = f.read()

        b64 = base64.b64encode(out_bytes).decode('utf-8')
        return jsonify({"data": b64, "size": len(out_bytes), "slideCount": slide_count})

    except Exception as e:
        print(f"[PDF to PPTX] Error: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


# --- Format Converter ---

convert_jobs = {}
convert_jobs_lock = threading.Lock()

def find_ffmpeg():
    """Return path to ffmpeg binary — bundled or system."""
    bundled = os.path.join(os.path.dirname(__file__), 'bin',
                           'ffmpeg.exe' if sys.platform == 'win32' else 'ffmpeg')
    if os.path.isfile(bundled):
        return bundled
    if shutil.which('ffmpeg'):
        return 'ffmpeg'
    return None

def find_ffprobe():
    """Return path to ffprobe binary — bundled or system."""
    bundled = os.path.join(os.path.dirname(__file__), 'bin',
                           'ffprobe.exe' if sys.platform == 'win32' else 'ffprobe')
    if os.path.isfile(bundled):
        return bundled
    if shutil.which('ffprobe'):
        return 'ffprobe'
    return None

def get_duration(ffprobe_path, filepath):
    """Get media duration in seconds using ffprobe."""
    try:
        result = subprocess.run(
            [ffprobe_path, '-v', 'quiet', '-show_entries', 'format=duration',
             '-of', 'default=noprint_wrappers=1:nokey=1', filepath],
            capture_output=True, text=True, timeout=10
        )
        return float(result.stdout.strip())
    except Exception:
        return 0

FFMPEG_PRESETS = {
    'mp4':  ['-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-c:a', 'aac'],
    'webm': ['-c:v', 'libvpx-vp9', '-crf', '30', '-b:v', '0', '-c:a', 'libopus'],
    'mov':  ['-c:v', 'libx264', '-c:a', 'aac'],
    'avi':  ['-c:v', 'libx264', '-c:a', 'mp3'],
    'mkv':  ['-c:v', 'libx264', '-c:a', 'aac'],
    'mp3':  ['-vn', '-c:a', 'libmp3lame', '-q:a', '2'],
    'wav':  ['-vn', '-c:a', 'pcm_s16le'],
    'ogg':  ['-vn', '-c:a', 'libvorbis', '-q:a', '5'],
    'gif':  ['-vf', 'fps=15,scale=480:-1:flags=lanczos', '-loop', '0'],
}

def run_ffmpeg_job(job_id, ffmpeg_path, ffprobe_path, input_path, output_path, target_format):
    """Background thread: run FFmpeg and track progress."""
    try:
        duration = get_duration(ffprobe_path, input_path) if ffprobe_path else 0

        codec_args = FFMPEG_PRESETS.get(target_format, [])
        cmd = [ffmpeg_path, '-y', '-i', input_path, *codec_args, '-progress', 'pipe:1', output_path]

        stderr_chunks = []
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                bufsize=0)

        # Drain stderr in a background thread to prevent deadlock
        def _drain_stderr():
            for chunk in iter(lambda: proc.stderr.read(4096), b''):
                stderr_chunks.append(chunk)
        stderr_thread = threading.Thread(target=_drain_stderr, daemon=True)
        stderr_thread.start()

        for raw_line in proc.stdout:
            line = raw_line.decode('utf-8', errors='replace').strip()
            # FFmpeg outputs both out_time_us and out_time_ms (both in microseconds)
            if duration > 0 and (line.startswith('out_time_us=') or line.startswith('out_time_ms=')):
                try:
                    us = int(line.split('=')[1])
                    pct = min(99, int((us / 1_000_000) / duration * 100))
                    with convert_jobs_lock:
                        if job_id in convert_jobs:
                            convert_jobs[job_id]['progress'] = pct
                except (ValueError, ZeroDivisionError):
                    pass

        proc.wait()
        stderr_thread.join(timeout=5)
        if proc.returncode != 0:
            stderr_text = b''.join(stderr_chunks).decode('utf-8', errors='replace')
            raise RuntimeError(f"FFmpeg failed (code {proc.returncode}): {stderr_text[:500]}")

        with open(output_path, 'rb') as f:
            out_bytes = f.read()

        mime_map = {
            'mp4': 'video/mp4', 'webm': 'video/webm', 'mov': 'video/quicktime',
            'avi': 'video/x-msvideo', 'mkv': 'video/x-matroska',
            'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'ogg': 'audio/ogg',
            'gif': 'image/gif',
        }
        mime = mime_map.get(target_format, 'application/octet-stream')
        b64 = base64.b64encode(out_bytes).decode('utf-8')
        data_url = f"data:{mime};base64,{b64}"

        with convert_jobs_lock:
            if job_id in convert_jobs:
                convert_jobs[job_id].update({
                    'status': 'done', 'progress': 100,
                    'dataUrl': data_url, 'size': len(out_bytes)
                })

    except Exception as e:
        print(f"[Convert] Job {job_id} error: {e}")
        with convert_jobs_lock:
            if job_id in convert_jobs:
                convert_jobs[job_id].update({'status': 'error', 'error': str(e)})

    finally:
        # Cleanup temp files
        try:
            if os.path.exists(input_path):
                os.remove(input_path)
            if os.path.exists(output_path):
                os.remove(output_path)
        except Exception:
            pass


@app.route('/convert/status', methods=['GET'])
def convert_status():
    return jsonify({'ffmpeg': find_ffmpeg() is not None})


@app.route('/convert/image', methods=['POST'])
def convert_image():
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']
    target = request.form.get('format', 'png').lower()

    allowed = {'jpg', 'jpeg', 'png', 'webp', 'bmp', 'tiff'}
    if target not in allowed:
        return jsonify({'error': f'Unsupported format: {target}'}), 400

    try:
        raw = file.read()
        filename = (file.filename or '').lower()

        # AI files are PDF-internally — render via PyMuPDF then hand to Pillow
        if filename.endswith('.ai'):
            doc = fitz.open(stream=raw, filetype='pdf')
            if len(doc) == 0:
                return jsonify({'error': 'AI file has no pages'}), 400
            page = doc[0]
            pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0), alpha=False)
            img = Image.frombytes("RGB", (pix.width, pix.height), pix.samples)
            doc.close()
        else:
            img = Image.open(io.BytesIO(raw))

        # Map target to Pillow format name
        fmt_map = {'jpg': 'JPEG', 'jpeg': 'JPEG', 'png': 'PNG', 'webp': 'WEBP', 'bmp': 'BMP', 'tiff': 'TIFF'}
        pil_format = fmt_map[target]

        # Handle mode conversion
        if pil_format == 'JPEG' and img.mode in ('RGBA', 'P', 'LA'):
            img = img.convert('RGB')
        elif pil_format in ('PNG', 'WEBP') and img.mode not in ('RGB', 'RGBA'):
            img = img.convert('RGBA')
        elif pil_format in ('BMP', 'TIFF') and img.mode not in ('RGB', 'RGBA'):
            img = img.convert('RGB')

        buf = io.BytesIO()
        save_kwargs = {}
        if pil_format == 'JPEG':
            save_kwargs = {'quality': 90, 'optimize': True}
        elif pil_format == 'WEBP':
            save_kwargs = {'quality': 90, 'method': 4}
        elif pil_format == 'PNG':
            save_kwargs = {'optimize': True}

        img.save(buf, format=pil_format, **save_kwargs)
        out_bytes = buf.getvalue()

        mime_map = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png',
                    'webp': 'image/webp', 'bmp': 'image/bmp', 'tiff': 'image/tiff'}
        mime = mime_map[target]
        b64 = base64.b64encode(out_bytes).decode('utf-8')

        return jsonify({
            'data': f'data:{mime};base64,{b64}',
            'format': target,
            'size': len(out_bytes)
        })

    except Exception as e:
        print(f"[Convert Image] Error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/convert/video', methods=['POST'])
def convert_video():
    ffmpeg_path = find_ffmpeg()
    if not ffmpeg_path:
        return jsonify({'error': 'FFmpeg not available'}), 503

    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']
    target = request.form.get('format', 'mp4').lower()

    allowed = set(FFMPEG_PRESETS.keys())
    if target not in allowed:
        return jsonify({'error': f'Unsupported format: {target}'}), 400

    try:
        job_id = str(uuid.uuid4())
        tmp_dir = tempfile.mkdtemp(prefix='convert_')

        # Save input file
        in_ext = os.path.splitext(file.filename or '')[1] or '.mp4'
        input_path = os.path.join(tmp_dir, f'input{in_ext}')
        file.save(input_path)

        output_path = os.path.join(tmp_dir, f'output.{target}')

        with convert_jobs_lock:
            convert_jobs[job_id] = {
                'status': 'processing', 'progress': 0,
                'dataUrl': None, 'size': None, 'error': None
            }

        ffprobe_path = find_ffprobe()
        thread = threading.Thread(
            target=run_ffmpeg_job,
            args=(job_id, ffmpeg_path, ffprobe_path, input_path, output_path, target),
            daemon=True
        )
        thread.start()

        return jsonify({'jobId': job_id})

    except Exception as e:
        print(f"[Convert Video] Error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/convert/video/progress/<job_id>', methods=['GET'])
def convert_video_progress(job_id):
    with convert_jobs_lock:
        job = convert_jobs.get(job_id)

    if not job:
        return jsonify({'error': 'Job not found'}), 404

    result = {
        'status': job['status'],
        'progress': job['progress'],
    }

    if job['status'] == 'done':
        result['dataUrl'] = job['dataUrl']
        result['size'] = job['size']
        # Cleanup job from memory
        with convert_jobs_lock:
            convert_jobs.pop(job_id, None)
    elif job['status'] == 'error':
        result['error'] = job['error']
        with convert_jobs_lock:
            convert_jobs.pop(job_id, None)

    return jsonify(result)


# --- Image Upscaler (Real-ESRGAN) ---

upscale_jobs = {}
upscale_jobs_lock = threading.Lock()

def find_realesrgan():
    """Return path to realesrgan-ncnn-vulkan binary — bundled or system."""
    bundled = os.path.join(os.path.dirname(__file__), 'bin',
                           'realesrgan-ncnn-vulkan.exe' if sys.platform == 'win32' else 'realesrgan-ncnn-vulkan')
    if os.path.isfile(bundled):
        return bundled
    if shutil.which('realesrgan-ncnn-vulkan'):
        return 'realesrgan-ncnn-vulkan'
    return None

def find_models_dir():
    """Return path to the models directory."""
    bundled = os.path.join(os.path.dirname(__file__), 'bin', 'models')
    if os.path.isdir(bundled):
        return bundled
    return None


def run_upscale_job(job_id, exe_path, models_dir, input_path, output_path, scale, model_name):
    """Background thread: run Real-ESRGAN and track progress.

    Keeps the output file on disk (no base64) — the /upscale/result endpoint
    serves it as a binary download to avoid blowing up renderer memory.
    """
    try:
        cmd = [exe_path, '-i', input_path, '-o', output_path,
               '-s', str(scale), '-n', model_name, '-f', 'png']
        if models_dir:
            cmd += ['-m', models_dir]

        stderr_chunks = []
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)

        # Drain stderr in a background thread (progress info comes on stderr)
        def _drain_stderr():
            for chunk in iter(lambda: proc.stderr.read(256), b''):
                stderr_chunks.append(chunk)
                # Parse progress from stderr: "xx.xx%"
                text = chunk.decode('utf-8', errors='replace')
                import re
                pcts = re.findall(r'(\d+(?:\.\d+)?)%', text)
                if pcts:
                    try:
                        pct = min(99, int(float(pcts[-1])))
                        with upscale_jobs_lock:
                            if job_id in upscale_jobs:
                                upscale_jobs[job_id]['progress'] = pct
                    except (ValueError, IndexError):
                        pass
        stderr_thread = threading.Thread(target=_drain_stderr, daemon=True)
        stderr_thread.start()

        # stdout doesn't produce much — just drain it
        proc.stdout.read()
        proc.wait()
        stderr_thread.join(timeout=10)

        if proc.returncode != 0:
            stderr_text = b''.join(stderr_chunks).decode('utf-8', errors='replace')
            raise RuntimeError(f"Real-ESRGAN failed (code {proc.returncode}): {stderr_text[:500]}")

        out_size = os.path.getsize(output_path)

        with upscale_jobs_lock:
            if job_id in upscale_jobs:
                upscale_jobs[job_id].update({
                    'status': 'done', 'progress': 100,
                    'outputPath': output_path, 'size': out_size
                })

        # Clean up input only — output is served by /upscale/result then cleaned
        try:
            if os.path.exists(input_path):
                os.remove(input_path)
        except Exception:
            pass

    except Exception as e:
        print(f"[Upscale] Job {job_id} error: {e}")
        with upscale_jobs_lock:
            if job_id in upscale_jobs:
                upscale_jobs[job_id].update({'status': 'error', 'error': str(e)})
        # Clean everything on error
        try:
            if os.path.exists(input_path):
                os.remove(input_path)
            if os.path.exists(output_path):
                os.remove(output_path)
            tmp_dir = os.path.dirname(input_path)
            if os.path.isdir(tmp_dir) and tmp_dir.startswith(tempfile.gettempdir()):
                shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            pass


@app.route('/upscale/status', methods=['GET'])
def upscale_status():
    return jsonify({'available': find_realesrgan() is not None})


@app.route('/upscale', methods=['POST'])
def upscale_image():
    exe_path = find_realesrgan()
    if not exe_path:
        return jsonify({'error': 'Real-ESRGAN not available'}), 503

    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400

    file = request.files['file']
    scale = int(request.form.get('scale', 4))
    model = request.form.get('model', 'realesrgan-x4plus')

    if scale not in (2, 3, 4):
        return jsonify({'error': f'Invalid scale: {scale}'}), 400

    allowed_models = {'realesrgan-x4plus', 'realesrgan-x4plus-anime'}
    if model not in allowed_models:
        return jsonify({'error': f'Invalid model: {model}'}), 400

    try:
        job_id = str(uuid.uuid4())
        tmp_dir = tempfile.mkdtemp(prefix='upscale_')

        in_ext = os.path.splitext(file.filename or '')[1] or '.png'
        input_path = os.path.join(tmp_dir, f'input{in_ext}')
        file.save(input_path)

        output_path = os.path.join(tmp_dir, 'output.png')
        models_dir = find_models_dir()

        with upscale_jobs_lock:
            upscale_jobs[job_id] = {
                'status': 'processing', 'progress': 0,
                'outputPath': None, 'size': None, 'error': None
            }

        thread = threading.Thread(
            target=run_upscale_job,
            args=(job_id, exe_path, models_dir, input_path, output_path, scale, model),
            daemon=True
        )
        thread.start()

        return jsonify({'jobId': job_id})

    except Exception as e:
        print(f"[Upscale] Error: {e}")
        return jsonify({'error': str(e)}), 500


@app.route('/upscale/progress/<job_id>', methods=['GET'])
def upscale_progress(job_id):
    with upscale_jobs_lock:
        job = upscale_jobs.get(job_id)

    if not job:
        return jsonify({'error': 'Job not found'}), 404

    result = {
        'status': job['status'],
        'progress': job['progress'],
    }

    if job['status'] == 'done':
        result['size'] = job['size']
        # Don't remove job — /upscale/result/<job_id> still needs to serve the file
    elif job['status'] == 'error':
        result['error'] = job['error']
        with upscale_jobs_lock:
            upscale_jobs.pop(job_id, None)

    return jsonify(result)


@app.route('/upscale/result/<job_id>', methods=['GET'])
def upscale_result(job_id):
    """Serve the upscaled image as a binary file.

    Does NOT auto-cleanup — the frontend calls /upscale/cleanup/<job_id>
    when the user removes the item, clears the list, or closes the tool.
    This avoids holding any image data in the Electron renderer's memory.
    """
    with upscale_jobs_lock:
        job = upscale_jobs.get(job_id)

    if not job:
        return jsonify({'error': 'Job not found'}), 404

    if job['status'] != 'done' or not job.get('outputPath'):
        return jsonify({'error': 'Result not ready'}), 409

    output_path = job['outputPath']
    if not os.path.isfile(output_path):
        with upscale_jobs_lock:
            upscale_jobs.pop(job_id, None)
        return jsonify({'error': 'Result file missing'}), 410

    return send_file(output_path, mimetype='image/png')


@app.route('/upscale/cleanup/<job_id>', methods=['POST'])
def upscale_cleanup(job_id):
    """Explicitly clean up a finished upscale job's temp files."""
    with upscale_jobs_lock:
        job = upscale_jobs.pop(job_id, None)

    if not job:
        return jsonify({'ok': True})   # already gone — fine

    output_path = job.get('outputPath')
    if output_path:
        try:
            if os.path.exists(output_path):
                os.remove(output_path)
            tmp_dir = os.path.dirname(output_path)
            if os.path.isdir(tmp_dir) and tmp_dir.startswith(tempfile.gettempdir()):
                shutil.rmtree(tmp_dir, ignore_errors=True)
        except Exception:
            pass

    return jsonify({'ok': True})


# ── Metadata Scrubber ───────────────────────────────────────────────

@app.route('/scrub-metadata', methods=['POST'])
def scrub_metadata():
    """Strip EXIF / document metadata from images and PDFs."""
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files['file']
    filename = (file.filename or '').lower()
    raw = file.read()
    original_size = len(raw)

    try:
        removed_fields = {}

        if filename.endswith('.pdf'):
            doc = fitz.open(stream=raw, filetype='pdf')
            old_meta = doc.metadata or {}
            removed_fields = {k: v for k, v in old_meta.items() if v}
            doc.set_metadata({})
            try:
                doc.del_xml_metadata()
            except Exception:
                pass
            out_bytes = doc.tobytes(deflate=True, garbage=4)
            doc.close()
            mime = 'application/pdf'
        else:
            img = Image.open(io.BytesIO(raw))
            fmt = (img.format or 'PNG').upper()

            # Collect EXIF info before removal
            from PIL.ExifTags import TAGS
            exif = img.getexif()
            if exif:
                for tag_id, value in exif.items():
                    tag_name = TAGS.get(tag_id, str(tag_id))
                    try:
                        removed_fields[tag_name] = str(value)[:100]
                    except Exception:
                        removed_fields[tag_name] = '<binary>'

            # Also check img.info for other metadata
            for key in ('exif', 'icc_profile', 'xmp', 'photoshop'):
                if key in img.info:
                    if key not in removed_fields:
                        removed_fields[key] = 'present'

            # Strip all metadata: create new image from pixel data only
            clean = Image.new(img.mode, img.size)
            clean.putdata(list(img.getdata()))

            buf = io.BytesIO()
            save_kwargs = {'format': fmt, 'optimize': True}
            if fmt == 'JPEG':
                save_kwargs['quality'] = 95
            elif fmt == 'PNG':
                save_kwargs['optimize'] = True
            clean.save(buf, **save_kwargs)
            out_bytes = buf.getvalue()

            fmt_lower = fmt.lower()
            if fmt_lower in ('jpg', 'jpeg'):
                mime = 'image/jpeg'
            else:
                mime = f'image/{fmt_lower}'

        b64 = base64.b64encode(out_bytes).decode('utf-8')
        return jsonify({
            "data": b64,
            "mime": mime,
            "originalSize": original_size,
            "newSize": len(out_bytes),
            "removedFields": removed_fields,
        })

    except Exception as e:
        print(f"[Metadata] Error: {e}")
        return jsonify({"error": str(e)}), 500


# ── Color Palette ───────────────────────────────────────────────────

@app.route('/extract-palette', methods=['POST'])
def extract_palette():
    """Extract dominant colors from an image."""
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files['file']
    count = int(request.form.get('count', 8))
    count = max(2, min(count, 16))

    try:
        raw = file.read()
        img = Image.open(io.BytesIO(raw)).convert('RGB')

        # Resize for speed (max 150px on longest side)
        img.thumbnail((150, 150), Image.LANCZOS)

        # Quantize to more colors than needed, then filter by distance
        oversample = min(count * 3, 32)
        quantized = img.quantize(colors=oversample, method=Image.Quantize.MEDIANCUT)
        palette_data = quantized.getpalette()  # flat [R,G,B,R,G,B,...]
        pixels = list(quantized.getdata())
        total = len(pixels)

        # Count frequency of each color index
        freq = {}
        for idx in pixels:
            freq[idx] = freq.get(idx, 0) + 1

        # Build candidate list sorted by frequency (most dominant first)
        candidates = []
        for idx, count_val in sorted(freq.items(), key=lambda x: -x[1]):
            if idx * 3 + 2 >= len(palette_data):
                continue
            r = palette_data[idx * 3]
            g = palette_data[idx * 3 + 1]
            b = palette_data[idx * 3 + 2]
            percentage = round((count_val / total) * 100, 1)
            candidates.append({"rgb": (r, g, b), "percentage": percentage})

        # Greedy selection: pick most dominant, then skip colors too close
        MIN_DIST = 35  # minimum Euclidean distance in RGB space
        selected = []
        for c in candidates:
            if len(selected) >= count:
                break
            too_close = False
            for s in selected:
                dr = c["rgb"][0] - s["rgb"][0]
                dg = c["rgb"][1] - s["rgb"][1]
                db = c["rgb"][2] - s["rgb"][2]
                if (dr*dr + dg*dg + db*db) ** 0.5 < MIN_DIST:
                    too_close = True
                    break
            if not too_close:
                selected.append(c)

        colors = []
        for c in selected:
            r, g, b = c["rgb"]
            colors.append({
                "hex": f'#{r:02X}{g:02X}{b:02X}',
                "rgb": [r, g, b],
                "percentage": c["percentage"],
            })

        return jsonify({"colors": colors})

    except Exception as e:
        print(f"[Palette] Error: {e}")
        return jsonify({"error": str(e)}), 500


# ── Watermark ───────────────────────────────────────────────────────

@app.route('/watermark', methods=['POST'])
def watermark():
    """Add text watermark to images and PDFs."""
    if 'file' not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files['file']
    text = request.form.get('text', 'Watermark')
    opacity = int(request.form.get('opacity', 30))
    font_size = int(request.form.get('fontSize', 36))
    style = request.form.get('style', 'diagonal')  # diagonal | center | corner
    color_hex = request.form.get('color', '#888888')
    filename = (file.filename or '').lower()
    raw = file.read()

    # Parse hex color
    try:
        color_hex = color_hex.lstrip('#')
        cr = int(color_hex[0:2], 16)
        cg = int(color_hex[2:4], 16)
        cb = int(color_hex[4:6], 16)
    except Exception:
        cr, cg, cb = 136, 136, 136

    try:
        if filename.endswith('.pdf'):
            doc = fitz.open(stream=raw, filetype='pdf')
            color_fitz = (cr / 255, cg / 255, cb / 255)

            for page in doc:
                rect = page.rect
                if style == 'diagonal':
                    step_x = font_size * max(len(text), 4) * 0.6 + 80
                    step_y = font_size * 3
                    y = 0
                    while y < rect.height + rect.width:
                        x = -rect.width * 0.5
                        while x < rect.width * 1.5:
                            page.insert_text(
                                (x, y), text,
                                fontsize=font_size,
                                fontname="helv",
                                color=color_fitz,
                                rotate=45,
                                overlay=True,
                                fill_opacity=opacity / 100,
                            )
                            x += step_x
                        y += step_y
                elif style == 'center':
                    tw = fitz.get_text_length(text, fontname="helv", fontsize=font_size * 2)
                    x = (rect.width - tw) / 2
                    y = rect.height / 2
                    page.insert_text(
                        (x, y), text,
                        fontsize=font_size * 2,
                        fontname="helv",
                        color=color_fitz,
                        overlay=True,
                        fill_opacity=opacity / 100,
                    )
                else:  # corner
                    tw = fitz.get_text_length(text, fontname="helv", fontsize=font_size)
                    x = rect.width - tw - 20
                    y = rect.height - 20
                    page.insert_text(
                        (x, y), text,
                        fontsize=font_size,
                        fontname="helv",
                        color=color_fitz,
                        overlay=True,
                        fill_opacity=opacity / 100,
                    )

            out_bytes = doc.tobytes(deflate=True)
            doc.close()
            b64 = base64.b64encode(out_bytes).decode('utf-8')
            return jsonify({"data": b64, "mime": "application/pdf", "size": len(out_bytes)})

        else:
            # Image watermark via Pillow
            from PIL import ImageDraw, ImageFont
            import math

            img = Image.open(io.BytesIO(raw)).convert('RGBA')
            w, h = img.size

            # Load font — try system fonts with Arabic support
            font = None
            for font_path in [
                'C:/Windows/Fonts/tahoma.ttf',
                'C:/Windows/Fonts/arial.ttf',
                '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
            ]:
                try:
                    font = ImageFont.truetype(font_path, font_size)
                    break
                except Exception:
                    continue
            if font is None:
                font = ImageFont.load_default()

            alpha = int(255 * opacity / 100)
            color = (cr, cg, cb, alpha)

            watermark_layer = Image.new('RGBA', (w, h), (0, 0, 0, 0))
            draw = ImageDraw.Draw(watermark_layer)

            if style == 'diagonal':
                # Measure text
                bbox = draw.textbbox((0, 0), text, font=font)
                tw = bbox[2] - bbox[0]
                th = bbox[3] - bbox[1]

                # Create a single text tile, then rotate
                tile_w = tw + 80
                tile_h = th + 20
                tile = Image.new('RGBA', (tile_w, tile_h), (0, 0, 0, 0))
                tile_draw = ImageDraw.Draw(tile)
                tile_draw.text((0, 0), text, fill=color, font=font)
                rotated = tile.rotate(35, expand=True, resample=Image.BICUBIC)
                rw, rh = rotated.size

                # Tile across the image
                for ty in range(-rh, h + rh, rh + 30):
                    for tx in range(-rw, w + rw, rw + 40):
                        watermark_layer.paste(rotated, (tx, ty), rotated)

            elif style == 'center':
                big_font = None
                for font_path in [
                    'C:/Windows/Fonts/tahoma.ttf',
                    'C:/Windows/Fonts/arial.ttf',
                    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
                ]:
                    try:
                        big_font = ImageFont.truetype(font_path, font_size * 2)
                        break
                    except Exception:
                        continue
                if big_font is None:
                    big_font = font

                bbox = draw.textbbox((0, 0), text, font=big_font)
                tw = bbox[2] - bbox[0]
                th = bbox[3] - bbox[1]
                x = (w - tw) // 2
                y = (h - th) // 2
                draw.text((x, y), text, fill=color, font=big_font)

            else:  # corner (bottom-right)
                bbox = draw.textbbox((0, 0), text, font=font)
                tw = bbox[2] - bbox[0]
                th = bbox[3] - bbox[1]
                x = w - tw - 20
                y = h - th - 20
                draw.text((x, y), text, fill=color, font=font)

            result = Image.alpha_composite(img, watermark_layer)

            # Save as PNG to preserve quality
            buf = io.BytesIO()
            result.save(buf, format='PNG')
            out_bytes = buf.getvalue()

            b64 = base64.b64encode(out_bytes).decode('utf-8')
            return jsonify({"data": b64, "mime": "image/png", "size": len(out_bytes)})

    except Exception as e:
        print(f"[Watermark] Error: {e}")
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    app.run(port=5000)
