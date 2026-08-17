const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const renderer = path.join(root, 'renderer');
const sourcePath = path.join(renderer, 'index.source.html');
const targetPath = path.join(renderer, 'index.html');
const source = fs.readFileSync(sourcePath, 'utf8');

const styles = [...source.matchAll(/<link\s+rel=["']stylesheet["']\s+href=["']([^"']+)["']\s*\/?>/gi)].map(match => match[1]);
const scripts = [...source.matchAll(/<script\s+src=["']([^"']+)["']\s*>\s*<\/script>/gi)].map(match => match[1]);

if (!styles.length || !scripts.length) throw new Error('renderer_manifest_empty');

const css = styles.map(file => `/* ---- ${file} ---- */\n${fs.readFileSync(path.join(renderer, file), 'utf8')}`).join('\n\n');
const js = scripts.map(file => `/* ---- ${file} ---- */\n${fs.readFileSync(path.join(renderer, file), 'utf8')}\n;`).join('\n\n');

fs.writeFileSync(path.join(renderer, 'thorpdv.bundle.css'), css);
fs.writeFileSync(path.join(renderer, 'thorpdv.bundle.js'), js);

const html = source
  .replace(/<link\s+rel=["']stylesheet["']\s+href=["'][^"']+["']\s*\/?>/gi, '')
  .replace(/<script\s+src=["'][^"']+["']\s*>\s*<\/script>/gi, '')
  .replace('</head>', '<link rel="stylesheet" href="thorpdv.bundle.css"></head>')
  .replace('</body>', '<script src="thorpdv.bundle.js"></script></body>');

fs.writeFileSync(targetPath, html);
console.log(`Renderer consolidado: ${styles.length} CSS + ${scripts.length} JS -> 2 arquivos`);
