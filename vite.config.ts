import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages normally serves project sites from /<repository-name>/.
// A relative base keeps the app working regardless of the repository name.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    host: '0.0.0.0'
  },
  preview: {
    port: 4173,
    host: '0.0.0.0'
  }
});
