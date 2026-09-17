const fs = require('fs');

const BP = {
  sheetWidthMm: 330.20,
  sheetHeightMm: 482.60,
  safeOffsetX: 5.00,
  safeOffsetY: 17.45,
  safeWidthMm: 320.20,
  safeHeightMm: 460.10,

  p1_small: [
    { x: 13.10, y: 36.60, size: 73.00 },
    { x: 90.10, y: 36.60, size: 73.00 },
    { x: 167.10, y: 36.60, size: 73.00 },
    { x: 244.10, y: 36.60, size: 73.00 }
  ],
  p1_large: [
    { x: 13.10, y: 132.60, size: 81.00 },
    { x: 13.10, y: 217.60, size: 81.00 },
    { x: 13.10, y: 302.60, size: 81.00 },
    { x: 13.10, y: 387.60, size: 81.00 }
  ],
  p2_large: [
    { x: 159.10, y: 132.60, size: 81.00 },
    { x: 159.10, y: 217.60, size: 81.00 },
    { x: 159.10, y: 302.60, size: 81.00 },
    { x: 159.10, y: 387.60, size: 81.00 }
  ],
  p2_small: [
    { x: 244.10, y: 164.60, size: 73.00 },
    { x: 244.10, y: 241.60, size: 73.00 },
    { x: 244.10, y: 318.60, size: 73.00 },
    { x: 244.10, y: 395.60, size: 73.00 }
  ]
};

console.log('--- TECHNICAL BLUEPRINT GEOMETRY VERIFICATION ---');
let allMathOk = true;

// 1. Top Row Width & Centering
const topRowWidth = 4 * 73.00 + 3 * 4.00;
const topRowSideMargin = (BP.safeWidthMm - topRowWidth) / 2;
const topRowX0 = BP.safeOffsetX + topRowSideMargin;
console.log('Top Row: Left X = ' + topRowX0 + ' mm (Expected 13.10 mm: ' + (topRowX0 === 13.10 ? 'OK' : 'MISMATCH') + ')');
if (topRowX0 !== 13.10) allMathOk = false;

// 2. Gaps
for (let i = 0; i < 3; i++) {
  const gap = BP.p1_large[i + 1].y - (BP.p1_large[i].y + 81.00);
  console.log('P1 Large Gap ' + (i + 1) + '->' + (i + 2) + ': ' + gap.toFixed(2) + ' mm');
  if (Math.abs(gap - 4.00) >= 0.01) allMathOk = false;
}

const topToColGap = BP.p1_large[0].y - (BP.p1_small[0].y + 73.00);
console.log('Gap Top Row to Left Column: ' + topToColGap.toFixed(2) + ' mm (Expected 23.00 mm)');
if (Math.abs(topToColGap - 23.00) >= 0.01) allMathOk = false;

const blueToRedGap = BP.p2_large[0].x - (BP.p1_large[0].x + 81.00);
console.log('Gap Blue 81mm to Red 81mm: ' + blueToRedGap.toFixed(2) + ' mm (Expected 65.00 mm)');
if (Math.abs(blueToRedGap - 65.00) >= 0.01) allMathOk = false;

const redLargeToSmallGap = BP.p2_small[0].x - (BP.p2_large[0].x + 81.00);
console.log('Gap Red 81mm to Red 73mm: ' + redLargeToSmallGap.toFixed(2) + ' mm (Expected 4.00 mm)');
if (Math.abs(redLargeToSmallGap - 4.00) >= 0.01) allMathOk = false;

const p1Bottom = BP.p1_large[3].y + 81.00;
const p2LargeBottom = BP.p2_large[3].y + 81.00;
const p2SmallBottom = BP.p2_small[3].y + 73.00;
console.log('Bottom Alignments: ' + p1Bottom.toFixed(2) + ' mm, ' + p2LargeBottom.toFixed(2) + ' mm, ' + p2SmallBottom.toFixed(2) + ' mm');
if (p1Bottom !== p2LargeBottom || p1Bottom !== p2SmallBottom) allMathOk = false;

console.log('All Checks Passed: ' + allMathOk);
