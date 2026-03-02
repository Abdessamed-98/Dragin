# -*- mode: python ; coding: utf-8 -*-
# PyInstaller spec for Dragin Flow Python backend
# Uses --onedir mode to avoid zlib conflicts with Pillow.
# Bundles default tools + remover (rembg/onnxruntime/cv2) + OCR (RapidOCR via onnxruntime).

import os
from PyInstaller.utils.hooks import collect_data_files, collect_submodules, collect_all, copy_metadata

block_cipher = None
base_path = os.path.abspath('.')

# Collect everything rembg needs (submodules, data, metadata)
rembg_datas, rembg_binaries, rembg_hiddenimports = collect_all('rembg')

# Collect RapidOCR data files (bundled ONNX models for det/rec/cls)
rapidocr_datas, rapidocr_binaries, rapidocr_hiddenimports = collect_all('rapidocr_onnxruntime')

# Collect template/data files for other packages
pptx_datas = collect_data_files('pptx')
pdf2docx_datas = collect_data_files('pdf2docx')

# Copy metadata for packages that check via importlib.metadata
extra_metadata = []
for pkg in ['pymatting', 'rembg', 'onnxruntime', 'scipy', 'pooch', 'jsonschema',
            'rapidocr_onnxruntime']:
    try:
        extra_metadata += copy_metadata(pkg)
    except Exception:
        pass

a = Analysis(
    ['app.py'],
    pathex=[base_path],
    binaries=rembg_binaries + rapidocr_binaries,
    datas=pptx_datas + pdf2docx_datas + rembg_datas + rapidocr_datas + extra_metadata + [
        ('models/ocr/arabic_rec.onnx', 'models/ocr'),
        ('models/ocr/arabic_dict.txt', 'models/ocr'),
    ],
    hiddenimports=[
        # Flask
        'flask', 'flask_cors', 'werkzeug', 'werkzeug.serving',
        'jinja2', 'markupsafe', 'itsdangerous', 'click', 'blinker',
        # Pillow
        'PIL', 'PIL._imaging', 'PIL.Image', 'PIL.ImageOps',
        'PIL.ImageEnhance', 'PIL.ImageFilter', 'PIL.ImageDraw',
        'PIL.ImageFont', 'PIL.ExifTags',
        # PyMuPDF
        'fitz', 'pymupdf',
        # Vectorizer (Rust native)
        'vtracer',
        # NumPy
        'numpy', 'numpy.core', 'numpy.lib',
        # OpenCV
        'cv2',
        # pdf2docx
        'pdf2docx', 'docx',
        # python-pptx
        'pptx', 'pptx.util',
        # Background removal (rembg + deps)
        'onnxruntime', 'scipy', 'pymatting', 'pooch',
        # OCR (RapidOCR — reuses onnxruntime already bundled above)
        'rapidocr_onnxruntime',
    ] + rembg_hiddenimports + rapidocr_hiddenimports,
    excludes=[
        # Not needed — keep these out
        'easyocr', 'torch', 'torchvision', 'paddlepaddle', 'paddleocr', 'paddle',
        # Dev-only
        'psutil',
        # Unnecessary large packages
        'matplotlib', 'pandas', 'tkinter',
    ],
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='app',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    icon='icon.ico',
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='app',
)
