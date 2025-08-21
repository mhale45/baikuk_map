import { defineConfig } from 'vite'

export default defineConfig({
  root: '.', // 기본 루트
  build: {
    outDir: 'dist', // 빌드 결과물 폴더
    emptyOutDir: true
  },
  server: {
    port: 5173,
    open: true,
    // SPA 라우팅을 위한 설정
    historyApiFallback: true
  },
  // SPA 라우팅을 위한 설정
  preview: {
    port: 5173,
    historyApiFallback: true
  }
})
