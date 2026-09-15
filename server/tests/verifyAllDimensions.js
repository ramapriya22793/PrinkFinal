const fs = require('fs');
const path = require('path');
const {
  SHEET_WIDTH_MM,
  SHEET_HEIGHT_MM,
  GRID_WIDTH_MM,
  GRID_HEIGHT_MM,
  MARGIN_X_MM,
  MARGIN_BOTTOM_MM,
  GRID_START_Y_MM,
  CARD_WIDTH_MM,
  PHOTO_HEIGHT_MM,
  CHIN_HEIGHT_MM,
  CARD_HEIGHT_MM,
  COL_GAP_MM,
  COL_PITCH_MM,
  HALF_GAP_MM,
  BARCODE_BOX_WIDTH_MM,
  BARCODE_BOX_HEIGHT_MM,
  COLS,
  ROWS
} = require('../utils/polaroidGenerator');

console.log('===============================================================');
console.log('   THE PRINK - POLAROID TEMPLATE EXACT DIMENSION AUDIT');
console.log('===============================================================');

const approx = (a, b) => Math.abs(a - b) < 0.001;

// Blueprint & Production Sample Verified Specifications
const BP = {
  sheetWidthMm: 330.148,
  sheetHeightMm: 498.900,
  gridWidthMm: 304.799,
  gridHeightMm: 457.200,
  cols: 4,
  rows: 5,
  cardWidthMm: 69.916,
  photoHeightMm: 71.162,
  chinHeightMm: 20.278,
  cardHeightMm: 91.440,
  colGapMm: 6.284,
  colPitchMm: 76.200,
  halfGapMm: 3.142,
  topMarginMm: 24.966,
  bottomMarginMm: 16.734,
  sideMarginMm: 12.6745,
  barcodeBoxWidthMm: 30.000,
  barcodeBoxHeightMm: 11.681
};

console.log('\n--- 1. OVERALL SHEET & GRID ---');
console.log(`Sheet Width:       Target = ${BP.sheetWidthMm} mm | Code = ${SHEET_WIDTH_MM} mm | Match: ${approx(SHEET_WIDTH_MM, BP.sheetWidthMm)}`);
console.log(`Sheet Height:      Target = ${BP.sheetHeightMm} mm | Code = ${SHEET_HEIGHT_MM} mm | Match: ${approx(SHEET_HEIGHT_MM, BP.sheetHeightMm)}`);
console.log(`Grid Width (Red):  Target = ${BP.gridWidthMm} mm | Code = ${GRID_WIDTH_MM} mm | Match: ${approx(GRID_WIDTH_MM, BP.gridWidthMm)}`);
console.log(`Grid Height:       Target = ${BP.gridHeightMm} mm | Code = ${GRID_HEIGHT_MM} mm | Match: ${approx(GRID_HEIGHT_MM, BP.gridHeightMm)}`);
console.log(`Grid Columns:      Target = ${BP.cols} | Code = ${COLS} | Match: ${COLS === BP.cols}`);
console.log(`Grid Rows:         Target = ${BP.rows} | Code = ${ROWS} | Match: ${ROWS === BP.rows}`);
console.log(`Total Cards/Sheet: Target = 20 | Code = ${COLS * ROWS} | Match: ${COLS * ROWS === 20}`);

console.log('\n--- 2. INDIVIDUAL CARD & CHIN ---');
console.log(`Card Width:        Target = ${BP.cardWidthMm} mm | Code = ${CARD_WIDTH_MM} mm | Match: ${approx(CARD_WIDTH_MM, BP.cardWidthMm)}`);
console.log(`Photo Area Height: Target = ${BP.photoHeightMm} mm | Code = ${PHOTO_HEIGHT_MM} mm | Match: ${approx(PHOTO_HEIGHT_MM, BP.photoHeightMm)}`);
console.log(`Chin (Text) Height:Target = ${BP.chinHeightMm} mm | Code = ${CHIN_HEIGHT_MM} mm | Match: ${approx(CHIN_HEIGHT_MM, BP.chinHeightMm)}`);
console.log(`Total Card Height: Target = ${BP.cardHeightMm} mm | Code = ${CARD_HEIGHT_MM} mm | Match: ${approx(CARD_HEIGHT_MM, BP.cardHeightMm)}`);

console.log('\n--- 3. SPACING & MARGINS ---');
console.log(`Column Gap:        Target = ${BP.colGapMm} mm | Code = ${COL_GAP_MM} mm | Match: ${approx(COL_GAP_MM, BP.colGapMm)}`);
console.log(`Column Pitch:      Target = ${BP.colPitchMm} mm | Code = ${COL_PITCH_MM} mm | Match: ${approx(COL_PITCH_MM, BP.colPitchMm)}`);
console.log(`Outer Left/Right:  Target = ${BP.halfGapMm} mm | Code = ${HALF_GAP_MM} mm | Match: ${approx(HALF_GAP_MM, BP.halfGapMm)}`);
console.log(`Side Margins (X):  Target = ${BP.sideMarginMm} mm | Code = ${MARGIN_X_MM.toFixed(4)} mm | Match: ${approx(MARGIN_X_MM, BP.sideMarginMm)}`);
console.log(`Top Margin (Y):    Target = ${BP.topMarginMm} mm | Code = ${GRID_START_Y_MM.toFixed(4)} mm | Match: ${approx(GRID_START_Y_MM, BP.topMarginMm)}`);
console.log(`Bottom Margin:     Target = ${BP.bottomMarginMm} mm | Code = ${MARGIN_BOTTOM_MM} mm | Match: ${approx(MARGIN_BOTTOM_MM, BP.bottomMarginMm)}`);

console.log('\n--- 4. TOP BARCODE HEADER BLOCKS ---');
console.log(`Barcode Box Width: Target = ${BP.barcodeBoxWidthMm} mm | Code = ${BARCODE_BOX_WIDTH_MM} mm | Match: ${approx(BARCODE_BOX_WIDTH_MM, BP.barcodeBoxWidthMm)}`);
console.log(`Barcode Box Height:Target = ${BP.barcodeBoxHeightMm} mm | Code = ${BARCODE_BOX_HEIGHT_MM} mm | Match: ${approx(BARCODE_BOX_HEIGHT_MM, BP.barcodeBoxHeightMm)}`);
console.log(`Number of Boxes:   4 (One aligned above each column)`);
for (let c = 0; c < BP.cols; c++) {
  const cardLeft = BP.sideMarginMm + BP.halfGapMm + (c * BP.colPitchMm);
  console.log(`  Box ${c + 1} (Col ${c + 1}): Card Left = ${cardLeft.toFixed(3)} mm, Barcode Box = ${cardLeft.toFixed(3)} to ${(cardLeft + BP.barcodeBoxWidthMm).toFixed(3)} mm, Order Text beside`);
}

console.log('\n--- 5. CARD POSITIONS IN 4x5 GRID ---');
for (let r = 0; r < ROWS; r++) {
  const y = BP.topMarginMm + (r * BP.cardHeightMm);
  console.log(`Row ${r + 1}: Y = ${y.toFixed(3)} mm to ${(y + BP.cardHeightMm).toFixed(3)} mm (Photo: ${y.toFixed(3)}..${(y + BP.photoHeightMm).toFixed(3)} mm, Chin: ${(y + BP.photoHeightMm).toFixed(3)}..${(y + BP.cardHeightMm).toFixed(3)} mm)`);
}

console.log('\n--- 6. VERIFICATION SUMMARY ---');
const allMatch = 
  approx(SHEET_WIDTH_MM, BP.sheetWidthMm) &&
  approx(SHEET_HEIGHT_MM, BP.sheetHeightMm) &&
  approx(GRID_WIDTH_MM, BP.gridWidthMm) &&
  approx(GRID_HEIGHT_MM, BP.gridHeightMm) &&
  approx(CARD_WIDTH_MM, BP.cardWidthMm) &&
  approx(PHOTO_HEIGHT_MM, BP.photoHeightMm) &&
  approx(CHIN_HEIGHT_MM, BP.chinHeightMm) &&
  approx(CARD_HEIGHT_MM, BP.cardHeightMm) &&
  approx(COL_GAP_MM, BP.colGapMm) &&
  approx(COL_PITCH_MM, BP.colPitchMm) &&
  approx(HALF_GAP_MM, BP.halfGapMm) &&
  approx(MARGIN_X_MM, BP.sideMarginMm) &&
  approx(MARGIN_BOTTOM_MM, BP.bottomMarginMm) &&
  approx(GRID_START_Y_MM, BP.topMarginMm) &&
  approx(BARCODE_BOX_WIDTH_MM, BP.barcodeBoxWidthMm) &&
  approx(BARCODE_BOX_HEIGHT_MM, BP.barcodeBoxHeightMm) &&
  COLS === BP.cols &&
  ROWS === BP.rows;

console.log(`ALL DIMENSIONS EXACT TO BLUEPRINT & SAMPLE: ${allMatch ? 'YES (100% VERIFIED)' : 'NO'}`);
console.log('===============================================================');
