import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base: './'` produit des URLs relatives : le site fonctionne aussi bien sur
// https://<user>.github.io/<repo>/ que sur un domaine perso ou en ouverture locale.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1500,
  },
});
