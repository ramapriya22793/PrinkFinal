const fs = require('fs');
let bFile = fs.readFileSync('apps/admin/src/components/AdminPortal.tsx', 'utf8');

// Replace literal string "\n" (backslash followed by n) with an actual newline character
bFile = bFile.split('\\n').join('\n');

fs.writeFileSync('apps/admin/src/components/AdminPortal.tsx', bFile);
console.log('Fixed literal newlines');
