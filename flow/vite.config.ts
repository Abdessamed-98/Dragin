import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [react()],
    base: './', // Create relative paths for Electron
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    build: {
        outDir: 'dist',
        emptyOutDir: true,
    },
    // Dev-startup: electron launches as soon as the port opens (wait-on tcp),
    // but vite used to transform + prebundle everything ON the first request —
    // a 20s+ first load. Pre-bundle the known deps at server start and pre-warm
    // the entry graph so the work overlaps electron's boot instead.
    optimizeDeps: {
        include: ['react', 'react-dom', 'framer-motion', 'lucide-react', 'clsx'],
    },
    server: {
        port: 5173,
        strictPort: true,
        warmup: {
            clientFiles: ['./src/main.tsx', './src/components/DockApp.tsx', './src/components/shell/shellTools.tsx'],
        },
    }
})
