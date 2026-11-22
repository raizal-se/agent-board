import { createReadStream, cpSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
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

/**
 * A .br and .gz copy of each text file of the build, so the CLI serves compressed files without
 * compressing on every request (apps/cli/src/server.ts). Fonts (woff2) are compressed already.
 */
function precompress(): Plugin {
  let outDir = 'dist';
  const TEXT = new Set(['.html', '.js', '.css', '.svg', '.json']);
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
  return {
    name: 'precompress',
    apply: 'build',
    configResolved(c) {
      outDir = resolve(c.root, c.build.outDir);
    },
    closeBundle() {
      for (const file of walk(outDir)) {
        if (!TEXT.has(extname(file))) continue;
        const raw = readFileSync(file);
        if (raw.length < 1024) continue;
        const br = brotliCompressSync(raw, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: raw.length } });
        const gz = gzipSync(raw, { level: 9 });
        if (br.length < raw.length) writeFileSync(`${file}.br`, br);
        if (gz.length < raw.length) writeFileSync(`${file}.gz`, gz);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), excalidrawFonts(), precompress()],
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
