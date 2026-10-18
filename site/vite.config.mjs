import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// The marketing site is plain HTML/CSS/JS served by mde-server. This project
// builds only the interactive parts that need the real application components:
// the feature sections and the live editor. Everything is emitted as one
// self-contained IIFE plus a stylesheet so the site can mount it with a script.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../node_modules/.vite-site', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('../src', import.meta.url)),
      '@utils': fileURLToPath(new URL('../src/utils', import.meta.url)),
      '@components': fileURLToPath(new URL('../src/components', import.meta.url)),
      '@store': fileURLToPath(new URL('../src/store', import.meta.url)),
      '@services': fileURLToPath(new URL('../src/services', import.meta.url)),
      '@hooks': fileURLToPath(new URL('../src/hooks', import.meta.url)),
      '@configs': fileURLToPath(new URL('../src/configs', import.meta.url)),
    },
  },
  server: { port: 1460, host: '127.0.0.1', strictPort: true },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL('./src/main.jsx', import.meta.url)),
      name: 'MokiSite',
      formats: ['iife'],
      fileName: () => 'moki-site.js',
      cssFileName: 'moki-site',
    },
    // The installer lazily loads the Milkdown scene; an IIFE bundle cannot
    // code-split, so inline it and keep one script the site can include.
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
