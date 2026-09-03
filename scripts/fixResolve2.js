const fs = require('fs');

// 1. Fix printRenderer.js
const file = 'server/utils/printRenderer.js';
let content = fs.readFileSync(file, 'utf8');

const regex = /const cleanCandidate[\s\S]*?if \(!resolved\.startsWith\(path\.resolve\(UPLOADS_DIR\)\)\) continue;/;
const replacement = `
    const cleanCandidate = candidate.startsWith('/') ? candidate.slice(1) : candidate;
    const basename = path.basename(cleanCandidate);
    
    // We should check BOTH the base uploads dir AND the originals dir
    const possiblePaths = [
      path.join(UPLOADS_DIR, basename),
      path.join(UPLOADS_DIR, 'originals', basename)
    ];

    for (const full of possiblePaths) {
      const resolved = path.resolve(full);
      if (!resolved.startsWith(path.resolve(UPLOADS_DIR))) continue;
      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
    }
    continue; // if none match, continue to next candidate
`;

content = content.replace(regex, replacement.trim());
fs.writeFileSync(file, content);
console.log('Fixed printRenderer.js');
