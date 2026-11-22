import { createReadStream, cpSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, normalize, resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const CLI = 'http://127.0.0.1:4747';

/** Excalidraw's own fonts (dist/prod/fonts), served from our origin so the board loads nothing from outside. */
const FONTS = join(dirname(createRequire(import.meta.url).resolve('@excalidraw/excalidraw')), 'fonts');

function excalidrawFonts(): Plugin {
  let outDir = 'dist';
  return {
    name: 'excalidraw-fonts',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use('/fonts', (req, res, next) => {
        const file = normalize(join(FONTS, decodeURIComponent((req.url ?? '/').split('?')[0]!)));
        if (!file.startsWith(FONTS + sep) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader('Content-Type', 'font/woff2');
        createReadStream(file).pipe(res);
      });
    },
    closeBundle() {
      cpSync(FONTS, join(outDir, 'fonts'), { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), excalidrawFonts()],
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
