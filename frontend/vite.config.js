import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom', 'react-router-dom'],
          mantine: ['@mantine/core', '@mantine/dates'],
          charts: ['recharts'],
          html2canvas: ['html2canvas'],
          jspdf: ['jspdf'],
        },
      },
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api/admin': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        timeout: 600000,       // 10 min for large file uploads
        proxyTimeout: 600000,
      },
      '/api/analysis': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/analysis/, ''),
        timeout: 600000,       // 10 min for large inference
        proxyTimeout: 600000,
      },
      '/api/predict': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        timeout: 600000,       // 10 min for large inference
        proxyTimeout: 600000,
      },
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
      }
    }
  }
});
