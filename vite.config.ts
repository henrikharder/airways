import { defineConfig } from 'vite';

// Relative asset paths so the build works from any sub-path (GitHub Pages serves it at /airways/).
export default defineConfig({ base: './' });
