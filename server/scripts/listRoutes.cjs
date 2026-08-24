/**
 * Dev utility: print every route Express has actually registered, so frontend
 * calls can be diffed against real backend contracts.
 *   node scripts/listRoutes.cjs
 */
const app = require('../index.js');

const out = [];
const router = app._router || app.router;

function baseOf(layer) {
  // Recover the mount path from the layer's regexp.
  const src = layer.regexp && layer.regexp.source;
  if (!src) return '';
  const m = src.match(/^\^\\\/(.*?)\\\/\?/);
  if (!m) return '';
  return '/' + m[1].replace(/\\\//g, '/').replace(/\\\./g, '.');
}

for (const layer of router.stack) {
  if (layer.route) {
    out.push(`${Object.keys(layer.route.methods).join(',').toUpperCase()} ${layer.route.path}`);
  } else if (layer.name === 'router' && layer.handle && layer.handle.stack) {
    const base = baseOf(layer);
    for (const sub of layer.handle.stack) {
      if (sub.route) {
        const p = (base + sub.route.path).replace(/\/+/g, '/');
        out.push(`${Object.keys(sub.route.methods).join(',').toUpperCase()} ${p}`);
      }
    }
  }
}

console.log([...new Set(out)].sort().join('\n'));
process.exit(0);
