import { defineConfig } from 'vite';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const websiteFiles = [
  'assets/18.webp',
  'assets/20.webp',
  'assets/21.webp',
  'assets/22.webp',
  'assets/DT-MAT-SLT.png',
  'assets/KeeponTruckin.ttf',
  'assets/cocoloco-front-view.webp',
  'assets/cover2.webp',
  'assets/dp.webp',
  'assets/editorial-1.jpg',
  'assets/editorial-2.jpg',
  'assets/half-bowl-matcha.webp',
  'assets/light_wood.jpg',
  'assets/matchapowder.png',
  'assets/oatside.png',
  'assets/sogood.png',
  'assets/top-view-matcha-bowl.webp',
];

const posFiles = [
  'assets/21-pos.webp',
  'assets/22-pos.webp',
  'assets/DT-MAT-SLT-pos.webp',
  'assets/DT-LOGO-001.png',
  'assets/DT-LOGO-APPLETOUCH.png',
  'assets/DT-LOGO-APPLETOUCH-192.png',
  'assets/DT-LOGO-APPLETOUCH-512.png',
  'assets/DT-LOGO-TAB-ICON.png',
  'assets/cocoloco-front-view-pos.webp',
  'pos-manifest.webmanifest',
  'pos-sw.js',
];

export default defineConfig(({ command, mode }) => {
  const target = mode === 'pos' ? 'pos' : mode === 'all' ? 'all' : 'website';
  const selectedFiles = target === 'website' ? websiteFiles : target === 'pos' ? posFiles : [...new Set([...websiteFiles, ...posFiles])];
  const input = target === 'website' ? { website: 'index.html' } : target === 'pos' ? { pos: 'pos/index.html' } : { website: 'index.html', pos: 'pos/index.html' };
  return {
    publicDir: command === 'serve' ? 'public' : false,
    define: { __POS_BASE__: JSON.stringify(target === 'pos' ? '/' : '/pos/') },
    plugins: command === 'build' ? [{
      name: 'copy-used-public-assets',
      closeBundle() {
        for (const file of selectedFiles) {
          const output = resolve('dist', file);
          mkdirSync(dirname(output), { recursive: true });
          copyFileSync(resolve('public', file), output);
        }
        if (target === 'pos') {
          copyFileSync(resolve('dist/pos/index.html'), resolve('dist/index.html'));
          const manifestPath = resolve('dist/pos-manifest.webmanifest');
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { start_url: string; scope: string };
          manifest.start_url = '/';
          manifest.scope = '/';
          writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
          const workerPath = resolve('dist/pos-sw.js');
          writeFileSync(workerPath, readFileSync(workerPath, 'utf8').replaceAll("'/pos/'", "'/'"));
        }
      },
    }] : [],
    build: { target: 'safari13', outDir: 'dist', emptyOutDir: true, rollupOptions: { input } },
  };
});
