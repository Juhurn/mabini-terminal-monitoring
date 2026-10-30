import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Replace the repository name if the GitHub repository is renamed.
  base: '/mabini-terminal-monitoring/'
})