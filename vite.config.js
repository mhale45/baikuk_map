// vite.config.js
import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin/index.html'),

        // 루트에 있는 개별 페이지들
        customer_manage:  resolve(__dirname, 'customer_manage.html'),
        listings:         resolve(__dirname, 'listings.html'),
        recommend_imDae:  resolve(__dirname, 'recommend_imDae.html'),
        recommend_maeMae: resolve(__dirname, 'recommend_maeMae.html'),
        reset:            resolve(__dirname, 'reset.html'),
        staff_manage:     resolve(__dirname, 'staff_manage.html'),
      },
    },
  },
})
