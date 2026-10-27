import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Notes viewer bundle: the same antd Tree and Markdown renderer the editor
// uses, emitted as one IIFE so a plain page can mount it.
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  cacheDir: fileURLToPath(new URL('../node_modules/.vite-notes-viewer', import.meta.url)),
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
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env': '{}',
  },
  build: {
    outDir: fileURLToPath(new URL('../../mde-server/src/site/notes/csharp', import.meta.url)),
    emptyOutDir: false,
    target: 'esnext',
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL('./src/main.jsx', import.meta.url)),
      name: 'MokiNotesViewer',
      formats: ['iife'],
      fileName: () => 'notes-viewer.js',
      cssFileName: 'notes-viewer',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
