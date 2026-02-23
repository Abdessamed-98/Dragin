// Second instance for testing peer discovery on the same machine.
// Uses a separate user-data dir so it gets its own device ID.
const { spawn } = require('child_process');
const electron = require('electron');

delete process.env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', '--dev', '--test-peer'], {
  stdio: 'inherit',
  env: process.env,
});
child.on('close', (code) => process.exit(code));
