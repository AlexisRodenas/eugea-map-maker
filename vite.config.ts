import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build` produit un unique dist/index.html utilisable hors-ligne (double-clic).
export default defineConfig({
  plugins: [viteSingleFile()],
  build: { target: 'es2020' },
});
