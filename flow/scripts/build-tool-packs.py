# Build per-platform on-demand tool assets for github.com/Abdessamed-98/flow-tools.
#
# Produces (in release-assets/packs/out/):
#   converter-darwin-arm64.zip / converter-darwin-x64.zip   (ffmpeg + ffprobe, static mac builds)
#   upscaler-darwin-arm64.zip  / upscaler-darwin-x64.zip    (realesrgan-ncnn-vulkan x86_64 + models)
#   remover-win-x64.zip        / remover-darwin-arm64.zip   (BEN2 dependency packs: lib/ site-packages)
#
# Runs entirely on Windows. CRITICAL zip detail: entries are written with
# create_system=3 (Unix) + unix modes in external_attr, otherwise macOS `unzip`
# ignores permissions and the binaries extract non-executable.
#
# Usage:  venv\Scripts\python.exe scripts\build-tool-packs.py [--only converter,upscaler,remover]

import argparse
import io
import os
import shutil
import subprocess
import sys
import urllib.request
import zipfile

FLOW = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.join(FLOW, 'release-assets', 'packs')
DL   = os.path.join(ROOT, 'downloads')
WORK = os.path.join(ROOT, 'work')
OUT  = os.path.join(ROOT, 'out')
PY   = sys.executable

# Exact versions proven in the dev venv the frozen backend was built from.
REMOVER_PINS = {
    'torch': '2.10.0', 'torchvision': '0.25.0', 'timm': '1.0.27', 'einops': '0.8.2',
    'huggingface_hub': '1.4.1', 'safetensors': '0.7.0', 'PyYAML': '6.0.2',
    'numpy': '2.3.0', 'pillow': '12.1.1',
}
BEN2_GIT = 'git+https://github.com/PramaLLC/BEN2.git'

FFMPEG_BASE = 'https://ffmpeg.martin-riedl.de/redirect/latest/macos/{arch}/release/{tool}.zip'
REALESRGAN_MAC = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-macos.zip'
UPSCALER_MODELS = [
    'realesrgan-x4plus.bin', 'realesrgan-x4plus.param',
    'realesrgan-x4plus-anime.bin', 'realesrgan-x4plus-anime.param',
]

EXEC_EXTS = {'.so', '.dylib', '.dll', '.pyd'}


def log(msg):
    print(f'[packs] {msg}', flush=True)


def download(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        log(f'cached: {os.path.basename(dest)}')
        return dest
    log(f'downloading {url}')
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    req = urllib.request.Request(url, headers={'User-Agent': 'dragin-flow-packs/1.0'})
    with urllib.request.urlopen(req) as r, open(dest + '.part', 'wb') as f:
        shutil.copyfileobj(r, f, 1024 * 256)
    os.replace(dest + '.part', dest)
    log(f'  -> {os.path.getsize(dest) / 1e6:.1f} MB')
    return dest


def is_executable(relpath):
    base = os.path.basename(relpath)
    ext = os.path.splitext(base)[1].lower()
    return ext in EXEC_EXTS or base in ('ffmpeg', 'ffprobe', 'realesrgan-ncnn-vulkan')


def write_unix_zip(zip_path, entries):
    """entries: list of (abs_src_path, arcname). Writes a zip macOS unzip restores
    permissions from: create_system=3 + unix mode in external_attr."""
    os.makedirs(os.path.dirname(zip_path), exist_ok=True)
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for src, arc in entries:
            mode = 0o755 if is_executable(arc) else 0o644
            zi = zipfile.ZipInfo(arc.replace('\\', '/'))
            zi.create_system = 3                    # Unix host — REQUIRED for perm restore
            zi.external_attr = (mode << 16)
            zi.compress_type = zipfile.ZIP_DEFLATED
            with open(src, 'rb') as f:
                z.writestr(zi, f.read())
    log(f'wrote {os.path.basename(zip_path)} ({os.path.getsize(zip_path) / 1e6:.1f} MB)')


def walk_entries(base_dir, arc_prefix=''):
    out = []
    for dirpath, _dirs, files in os.walk(base_dir):
        for fn in files:
            src = os.path.join(dirpath, fn)
            rel = os.path.relpath(src, base_dir)
            out.append((src, os.path.join(arc_prefix, rel)))
    return sorted(out, key=lambda e: e[1].lower())


def extract_single(zip_path, member_basename, dest):
    """Extract the (single) member whose basename matches, to dest."""
    with zipfile.ZipFile(zip_path) as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            if os.path.basename(info.filename) == member_basename:
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with z.open(info) as srcf, open(dest, 'wb') as dstf:
                    shutil.copyfileobj(srcf, dstf)
                return dest
    raise FileNotFoundError(f'{member_basename} not found in {zip_path}')


def run(cmd, **kw):
    log('> ' + ' '.join(cmd if isinstance(cmd, list) else [cmd]))
    subprocess.run(cmd, check=True, **kw)


# ── converter ────────────────────────────────────────────────────────────────
def build_converter():
    for arch, plat in (('arm64', 'darwin-arm64'), ('amd64', 'darwin-x64')):
        stage = os.path.join(WORK, f'converter-{plat}')
        shutil.rmtree(stage, ignore_errors=True)
        for tool in ('ffmpeg', 'ffprobe'):
            zp = download(FFMPEG_BASE.format(arch=arch, tool=tool), os.path.join(DL, f'{tool}-macos-{arch}.zip'))
            extract_single(zp, tool, os.path.join(stage, tool))
        write_unix_zip(os.path.join(OUT, f'converter-{plat}.zip'), walk_entries(stage))


# ── upscaler ─────────────────────────────────────────────────────────────────
def build_upscaler():
    zp = download(REALESRGAN_MAC, os.path.join(DL, 'realesrgan-macos.zip'))
    stage = os.path.join(WORK, 'upscaler-darwin')
    shutil.rmtree(stage, ignore_errors=True)
    extract_single(zp, 'realesrgan-ncnn-vulkan', os.path.join(stage, 'realesrgan-ncnn-vulkan'))
    # Also carry any dylibs shipped next to the binary (vulkan loader etc.), if present.
    with zipfile.ZipFile(zp) as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            base = os.path.basename(info.filename)
            if base.endswith('.dylib'):
                with z.open(info) as srcf, open(os.path.join(stage, base), 'wb') as dstf:
                    shutil.copyfileobj(srcf, dstf)
    for model in UPSCALER_MODELS:
        extract_single(zp, model, os.path.join(stage, 'models', model))
    entries = walk_entries(stage)
    # Identical payload for both arches (x86_64 binary; Rosetta 2 on Apple Silicon).
    write_unix_zip(os.path.join(OUT, 'upscaler-darwin-arm64.zip'), entries)
    write_unix_zip(os.path.join(OUT, 'upscaler-darwin-x64.zip'), entries)


# ── remover (BEN2 dependency packs) ──────────────────────────────────────────
def _constraints_file():
    path = os.path.join(WORK, 'remover-constraints.txt')
    os.makedirs(WORK, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        for pkg, ver in REMOVER_PINS.items():
            f.write(f'{pkg}=={ver}\n')
    return path


def _ben2_wheel():
    wheel_dir = os.path.join(WORK, 'wheels')
    os.makedirs(wheel_dir, exist_ok=True)
    existing = [f for f in os.listdir(wheel_dir) if f.startswith('ben2-') and f.endswith('.whl')]
    if existing:
        return os.path.join(wheel_dir, existing[0])
    run([PY, '-m', 'pip', 'wheel', '--no-deps', BEN2_GIT, '-w', wheel_dir])
    existing = [f for f in os.listdir(wheel_dir) if f.startswith('ben2-') and f.endswith('.whl')]
    if not existing:
        raise RuntimeError('ben2 wheel build produced no wheel')
    return os.path.join(wheel_dir, existing[0])


def _unpack_wheel(whl, lib_dir):
    """Unpack a wheel (it's a zip) into lib_dir, merging any .data purelib/platlib."""
    with zipfile.ZipFile(whl) as z:
        z.extractall(lib_dir)
    for entry in list(os.listdir(lib_dir)):
        if not entry.endswith('.data'):
            continue
        data_dir = os.path.join(lib_dir, entry)
        for sub in ('purelib', 'platlib'):
            subdir = os.path.join(data_dir, sub)
            if os.path.isdir(subdir):
                shutil.copytree(subdir, lib_dir, dirs_exist_ok=True)
        shutil.rmtree(data_dir, ignore_errors=True)


def build_remover():
    constraints = _constraints_file()
    ben2 = _ben2_wheel()

    # win-x64: native pip install --target (host IS win/cp312; PyPI win torch is the CPU build).
    win_lib = os.path.join(WORK, 'remover-win', 'lib')
    if not os.path.isdir(os.path.join(win_lib, 'torch')):
        shutil.rmtree(os.path.dirname(win_lib), ignore_errors=True)
        run([PY, '-m', 'pip', 'install', '--no-compile', '--target', win_lib, '-c', constraints, ben2])
    write_unix_zip(os.path.join(OUT, 'remover-win-x64.zip'), walk_entries(win_lib, 'lib'))

    # darwin-arm64: cross-download binary wheels, then unpack them (no install step).
    mac_dl = os.path.join(DL, 'remover-mac-wheels')
    mac_lib = os.path.join(WORK, 'remover-mac', 'lib')
    if not os.path.isdir(os.path.join(mac_lib, 'torch')):
        os.makedirs(mac_dl, exist_ok=True)
        run([PY, '-m', 'pip', 'download', ben2,
             '-d', mac_dl, '-c', constraints,
             '--only-binary=:all:',                 # fail HERE (not on the user's Mac) if any wheel is missing
             '--python-version', '312', '--implementation', 'cp',
             '--platform', 'macosx_11_0_arm64',
             '--platform', 'macosx_12_0_arm64',
             '--platform', 'macosx_13_0_arm64',
             '--platform', 'macosx_14_0_arm64',
             '--platform', 'macosx_15_0_arm64',
             '--platform', 'macosx_10_13_universal2',
             '--platform', 'macosx_11_0_universal2'])
        shutil.rmtree(os.path.dirname(mac_lib), ignore_errors=True)
        os.makedirs(mac_lib, exist_ok=True)
        wheels = [f for f in os.listdir(mac_dl) if f.endswith('.whl')]
        log(f'unpacking {len(wheels)} mac wheels')
        for whl in sorted(wheels):
            _unpack_wheel(os.path.join(mac_dl, whl), mac_lib)
    write_unix_zip(os.path.join(OUT, 'remover-darwin-arm64.zip'), walk_entries(mac_lib, 'lib'))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--only', default='converter,upscaler,remover')
    args = ap.parse_args()
    targets = {t.strip() for t in args.only.split(',') if t.strip()}

    for d in (DL, WORK, OUT):
        os.makedirs(d, exist_ok=True)

    if 'converter' in targets:
        build_converter()
    if 'upscaler' in targets:
        build_upscaler()
    if 'remover' in targets:
        build_remover()

    log('done. assets in ' + OUT)
    for f in sorted(os.listdir(OUT)):
        log(f'  {f}  {os.path.getsize(os.path.join(OUT, f)) / 1e6:.1f} MB')


if __name__ == '__main__':
    main()
