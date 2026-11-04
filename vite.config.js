import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base so the build works under GitHub Pages' /<repo>/ path.
export default defineConfig({ base: './', plugins: [react()] })
