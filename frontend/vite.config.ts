import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';

// Images/documents are stored as relative paths (e.g. /uploads/products/x.png)
// so they resolve against whatever origin serves the page. In production nginx
// proxies /uploads to the backend; in local dev there's no nginx, so the Vite
// dev server proxies /uploads to the backend the same way — otherwise <img>
// tags resolve against :5173 and render as broken images.
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    proxy: {
      // Backend origin in local dev. Change the port here if your backend
      // doesn't run on 4000.
      '/uploads': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
