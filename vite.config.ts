import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import pkg from './package.json';

export default defineConfig({
  plugins: [react()],
  // 相对路径：Electron(file://)、Capacitor、GitHub Pages 子目录都能用
  base: './',
  define: {
    __APP_NAME__: JSON.stringify(pkg.name),
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_DESC__: JSON.stringify(pkg.description),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        sassOptions: {
          outputStyle: 'expanded',
          quietDeps: true,
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: false,
    hmr: { overlay: false },
    cors: true,
  },
  build: {
    // Electron 从这里读取：dist/renderer/index.html
    outDir: 'dist/renderer',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'antd-vendor': ['antd', '@ant-design/icons'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'antd', 'axios', 'zustand'],
  },
});
