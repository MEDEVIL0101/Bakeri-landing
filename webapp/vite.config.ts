import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

// The web app is served by GitHub Pages at bakeriapp.com/app/ from the
// committed build output in ../app (same repo, same deploy as the rest of
// the site — no CI step). Source lives here in webapp/.

const SITE_ROOT = resolve(__dirname, '..');
const TYPES: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json',
};

/**
 * Dev only: serve the site's own /baker and /assets from the repo so the
 * storefront builder's preview iframe is same-origin with the app, exactly
 * like production (bakeriapp.com/app + bakeriapp.com/baker).
 */
function siteFiles(): Plugin {
  return {
    name: 'bakeri-site-files',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = (req.url ?? '').split('?')[0];
        if (!url.startsWith('/baker/') && !url.startsWith('/assets/')) return next();
        const file = normalize(join(SITE_ROOT, decodeURIComponent(url)));
        if (!file.startsWith(SITE_ROOT)) return next();
        try {
          const body = await readFile(file);
          res.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream');
          res.end(body);
        } catch {
          next();
        }
      });
    },
  };
}

export default defineConfig({
  base: '/app/',
  plugins: [react(), siteFiles()],
  build: {
    outDir: '../app',
    emptyOutDir: true,
  },
  server: { port: 5174 },
});
