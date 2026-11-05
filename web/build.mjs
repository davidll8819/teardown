import {build} from 'esbuild';
import {mkdir, copyFile} from 'node:fs/promises';
await mkdir('web-dist/assets', {recursive: true});
await build({entryPoints: ['web/app.jsx'], outfile: 'web-dist/assets/app.js', bundle: true, external: ['/assets/*'], minify: true, platform: 'browser', target: 'es2022', define: {'process.env.NODE_ENV': '"production"'}, loader: {'.js': 'jsx'}});
await copyFile('web/index.html', 'web-dist/index.html');

await copyFile('node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2', 'web-dist/assets/inter-latin.woff2');
