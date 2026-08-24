const fs = require('fs');
const path = 'c:/Users/CHENNAMMAL/Downloads/Prink-main (5) (1)/Prink-main (5)/Prink-main/apps/customer/src/components/CustomerPortal.tsx';
let content = fs.readFileSync(path, 'utf8');

content = content.replace(
  /gridTemplateColumns: 'repeat\(4, 1fr\)', gridTemplateRows: 'repeat\(2, 1fr\)'/g,
  "gridTemplateColumns: 'repeat(2, 1fr)', gridTemplateRows: 'repeat(2, 1fr)'"
);

content = content.replace(
  /\{\[0,1,2,3,4,5,6,7\]\.map\(idx => \(/g,
  "{[0,1,2,3].map(idx => ("
);

// Also change Array.from({ length: 8 }) to 4 for Magazine upload grid if it's there
content = content.replace(
  /Array\.from\(\{ length: 8 \}\)\.map\(\(_, idx\)/g,
  "Array.from({ length: isMagazine(activeOrder) ? 4 : 8 }).map((_, idx)"
);

fs.writeFileSync(path, content);
console.log('CustomerPortal updated: renderMagazinePreview now shows 4 items.');
