/**
 * Dragin Flow — Full build orchestration (cross-platform)
 * 1. Build frontend (Vite)
 * 2. Build Python backend (PyInstaller)
 * 3. Package Electron app (electron-builder)
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';

function run(cmd, label) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${label}`);
    console.log(`${'='.repeat(60)}\n`);
    console.log(`> ${cmd}\n`);
    execSync(cmd, { cwd: root, stdio: 'inherit' });
}

// ── Step 1: Build frontend ──────────────────────────────────
run('npx vite build', 'Step 1/3 — Building frontend (Vite)');

const indexHtml = path.join(root, 'dist', 'index.html');
if (!fs.existsSync(indexHtml)) {
    console.error('\nERROR: Vite build did not produce dist/index.html');
    process.exit(1);
}
console.log('\nFrontend built successfully.');

// ── Step 2: Build Python backend ────────────────────────────
const venvPython = isWin
    ? path.join(root, 'venv', 'Scripts', 'python.exe')
    : path.join(root, 'venv', 'bin', 'python');
const pythonExe = fs.existsSync(venvPython) ? `"${venvPython}"` : 'python';

run(
    `${pythonExe} -m PyInstaller app.spec --distpath pyinstaller_dist --workpath pyinstaller_build --clean --noconfirm`,
    'Step 2/3 — Building Python backend (PyInstaller)'
);

const appBinary = isWin ? 'app.exe' : 'app';
const appPath = path.join(root, 'pyinstaller_dist', 'app', appBinary);
if (!fs.existsSync(appPath)) {
    console.error(`\nERROR: PyInstaller did not produce pyinstaller_dist/app/${appBinary}`);
    process.exit(1);
}
const sizeMB = (fs.statSync(appPath).size / 1024 / 1024).toFixed(1);
console.log(`\nPython backend built: app/${appBinary} (${sizeMB} MB)`);

// ── Step 3: Package Electron app ────────────────────────────
let builderFlags;
if (isWin) {
    builderFlags = '--win --x64';
} else if (isMac) {
    const arch = process.arch === 'arm64' ? '--arm64' : '--x64';
    builderFlags = `--mac ${arch}`;
} else {
    builderFlags = '--linux --x64';
}

run(`npx electron-builder ${builderFlags}`, 'Step 3/3 — Packaging Electron app (electron-builder)');

console.log(`\n${'='.repeat(60)}`);
console.log('  Build complete! Check the release/ directory.');
console.log(`${'='.repeat(60)}\n`);
