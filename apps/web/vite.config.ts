import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const CLI = 'http://127.0.0.1:4747';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    // `pnpm dev` with `agent-board watch <folder>` running: the CLI only accepts its own origin.
    proxy: {
      '/sync': {
        target: CLI,
        ws: true,
        changeOrigin: true,
        configure: (proxy) => proxy.on('proxyReqWs', (req) => req.setHeader('Origin', CLI)),
      },
    },
  },
});
