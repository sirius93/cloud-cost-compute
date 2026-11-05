import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { renderSeo } from './src/seo.js'

// Relative base so the build works under GitHub Pages' /<repo>/ path.
export default defineConfig({
  base: './',
  plugins: [react(), { name: 'seo', transformIndexHtml: { order: 'pre', handler: html => renderSeo(html) } }],
})
