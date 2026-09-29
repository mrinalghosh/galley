import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import galley from 'galley/vite';

// galley/vite resolves to the root package's dist/, so run `npm run build` at the repo root first.
export default defineConfig({
  plugins: [galley(), react()],
  server: { port: 5210, strictPort: true },
});
