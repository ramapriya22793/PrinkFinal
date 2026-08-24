const fs = require('fs');
let bFile = fs.readFileSync('server/services/butterflyAllocation.service.js', 'utf8');
bFile = bFile.replace(/\\\`/g, '`');
fs.writeFileSync('server/services/butterflyAllocation.service.js', bFile);

let pFile = fs.readFileSync('server/routes/publicUpload.routes.js', 'utf8');
pFile = pFile.replace(/\\\`/g, '`');
fs.writeFileSync('server/routes/publicUpload.routes.js', pFile);
