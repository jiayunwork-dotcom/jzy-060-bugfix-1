import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 开发态把接口与长连接代理到本机后端；生产态由后端一体静态托管
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
