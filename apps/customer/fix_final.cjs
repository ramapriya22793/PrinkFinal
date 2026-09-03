const fs = require('fs');
const filePath = 'src/components/CustomerPortal.tsx';
let content = fs.readFileSync(filePath, 'utf-8');

const findStr = "SUBVIEW: UPLOAD PHOTOS (preview key used as upload center)\r\n        {activeSubView === 'preview' && (";
const replaceStr = "SUBVIEW: UPLOAD PHOTOS (preview key used as upload center)\r\n            ================================================================== */}\r\n        {activeSubView === 'preview' && (";

if (content.includes(findStr)) {
  content = content.replace(findStr, replaceStr);
  fs.writeFileSync(filePath, content);
  console.log("Fixed missing */}");
} else {
  const findStr2 = "SUBVIEW: UPLOAD PHOTOS (preview key used as upload center)\n        {activeSubView === 'preview' && (";
  const replaceStr2 = "SUBVIEW: UPLOAD PHOTOS (preview key used as upload center)\n            ================================================================== */}\n        {activeSubView === 'preview' && (";
  if (content.includes(findStr2)) {
    content = content.replace(findStr2, replaceStr2);
    fs.writeFileSync(filePath, content);
    console.log("Fixed missing */} (LF)");
  } else {
    console.log("Still not found");
  }
}
