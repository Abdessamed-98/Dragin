// Launcher that clears ELECTRON_RUN_AS_NODE before starting Electron.
// VSCode sets this env var which prevents Electron from initializing as an app.
const { spawn } = require('child_process');
const electron = require('electron');

delete process.env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', '--dev'], { stdio: 'inherit', env: process.env });
child.on('close', (code) => process.exit(code));
