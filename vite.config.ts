import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

function pwaShell(): Plugin {
  let directory: string;
  return {
    name: 'p-note-pwa-shell', apply: 'build',
    configResolved(config) { directory = resolve(config.root, config.build.outDir); },
    async writeBundle(_, bundle) {
      const template = await readFile('public/sw.js', 'utf8');
      const urls = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png',
        ...Object.keys(bundle).filter(file => /\.(js|css)$/.test(file)).sort().map(file => '/' + file)];
      const hash = createHash('sha256').update(template);
      for (const url of urls) hash.update(await readFile(resolve(directory, url === '/' ? 'index.html' : url.slice(1))));
      const source = template.replace('__P_NOTE_VERSION__', hash.digest('hex').slice(0, 16))
        .replace(/\/\* __P_NOTE_PRECACHE__ \*\/ \[[^;]+\]/, JSON.stringify(urls));
      await writeFile(resolve(directory, 'sw.js'), source);
    },
  };
}

const api = process.env.P_NOTE_API ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react(), pwaShell()],
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    proxy: { '/api': api, '/__test': api, '/parties': { target: api, ws: true } },
  },
});
