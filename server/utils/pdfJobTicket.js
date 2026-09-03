const fs = require('fs');
const path = require('path');

function drawJobTicket(doc, orderId, order) {
  const cleanId = String(orderId).replace('#', '');
  const logoImgPath = path.join(__dirname, '..', '..', 'apps', 'customer', 'src', 'assets', 'logos', 'main-logo.png');

      // PAGE 1: PRINT PRODUCTION JOB TICKET
      // ==========================================
      doc.rect(0, 0, 595, 842).fill('#ffffff');

      // 1. Header Bar
      doc.rect(0, 0, 595, 60).fill('#f8fafc');
      doc.rect(0, 57, 595, 3).fill('#171C62');
      if (fs.existsSync(logoImgPath)) {
        // Embed logo in header
        doc.image(logoImgPath, 20, 15, { height: 30 });
      }
      doc.fillColor('#171C62').font('Helvetica-Bold').fontSize(14).text('PRINT PRODUCTION SHEET', 350, 24, { align: 'right', width: 220 });

      // 2. Barcode & QR Code simulation
      // Barcode
      doc.fillColor('#000000');
      const drawBarcode = (startX, startY) => {
        const lineCount = 35;
        const lineWidths = [1, 2, 3, 1, 1, 2, 4, 1, 2, 1, 3, 2, 1, 1, 4, 2, 1, 2, 3, 1, 1, 2, 1, 4, 1, 2, 3, 2, 1, 1, 2, 1, 3, 2, 1];
        let currentX = startX;
        for (let i = 0; i < lineCount; i++) {
          const w = lineWidths[i % lineWidths.length];
          doc.rect(currentX, startY, w, 24).fill('#000000');
          currentX += w + (i % 3 === 0 ? 2 : 1);
        }
        doc.fillColor('#64748b').font('Helvetica').fontSize(6).text(`*${cleanId}*`, startX + 15, startY + 27);
      };
      drawBarcode(360, 80);

      // QR Code simulation
      doc.lineWidth(1).strokeColor('#e2e8f0');
      doc.rect(515, 80, 45, 45).stroke();
      doc.fillColor('#000000');
      // Corner squares
      doc.rect(517, 82, 12, 12).fill();
      doc.fillColor('#ffffff').rect(520, 85, 6, 6).fill();
      doc.fillColor('#000000').rect(522, 87, 2, 2).fill();

      doc.rect(545, 82, 12, 12).fill();
      doc.fillColor('#ffffff').rect(548, 85, 6, 6).fill();
      doc.fillColor('#000000').rect(550, 87, 2, 2).fill();

      doc.rect(517, 110, 12, 12).fill();
      doc.fillColor('#ffffff').rect(520, 113, 6, 6).fill();
      doc.fillColor('#000000').rect(522, 115, 2, 2).fill();
      // Random dots to simulate QR grid
      doc.fillColor('#000000');
      doc.rect(535, 90, 4, 4).fill();
      doc.rect(540, 98, 4, 4).fill();
      doc.rect(532, 105, 4, 4).fill();
      doc.rect(545, 110, 8, 4).fill();

      // Header Meta Text
      doc.font('Helvetica-Bold').fontSize(11).fillColor('#171C62').text(`ORDER ${orderId}`, 20, 80);
      doc.font('Helvetica').fontSize(8).fillColor('#64748b');
      doc.text(`Department: Print Operations & Fulfillment`, 20, 95);
      doc.text(`Generated: ${new Date().toLocaleString()}`, 20, 108);
      doc.text(`Operator Terminal ID: SP-3003-HUB`, 20, 120);

      // Section Dividers & Panels
      const drawPanelHeader = (title, x, y, w) => {
        doc.fillColor('#171C62').font('Helvetica-Bold').fontSize(8.5).text(title, x, y);
        doc.lineWidth(0.75).strokeColor('#e2e8f0').moveTo(x, y + 12).lineTo(x + w, y + 12).stroke();
      };

      // â”€â”€ LEFT COLUMN (x = 20, width = 260) â”€â”€
      const col1X = 20;
      const colWidth = 260;

      // Panel 1: Order Information
      let curY = 145;
      drawPanelHeader('1. ORDER DETAILS', col1X, curY, colWidth);
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#1e293b');
      
      const renderMetaLine = (label, value, y) => {
        doc.font('Helvetica-Bold').fillColor('#475569').text(label, col1X, y);
        doc.font('Helvetica').fillColor('#1e293b').text(value, col1X + 85, y);
      };
      
      renderMetaLine('Order Number:', orderId, curY + 22);
      renderMetaLine('Shopify Order ID:', order.shopifyId || 'N/A', curY + 34);
      renderMetaLine('Customer ID:', order.customerId || `CUST-${cleanId}`, curY + 46);
      renderMetaLine('Product Name:', order.product, curY + 58);
      renderMetaLine('Product SKU:', order.sku, curY + 70);
      renderMetaLine('Quantity:', `${order.quantity || 1} units`, curY + 82);
      renderMetaLine('Order Date:', order.date || 'Jul 15, 2026', curY + 94);
      renderMetaLine('Approval Date:', new Date().toLocaleDateString(), curY + 106);
      renderMetaLine('Due Date:', order.dueDate || 'Jul 20, 2026', curY + 118);
      renderMetaLine('Job Priority:', (order.priority || 'Normal').toUpperCase(), curY + 130);
      renderMetaLine('Workflow Status:', 'PRINT READY', curY + 142);

      // Panel 2: Customer Delivery Details
      curY = 295;
      drawPanelHeader('2. CUSTOMER & SHIPPING TARGET', col1X, curY, colWidth);
      
      renderMetaLine('Recipient Name:', order.customer, curY + 22);
      renderMetaLine('Mobile Phone:', order.phone || 'N/A', curY + 34);
      renderMetaLine('Email Address:', order.email || 'N/A', curY + 46);
      
      const addr = order.shippingAddress || { address1: 'Address not provided', city: 'Kolkata', state: 'West Bengal', country: 'India', postalCode: '700091' };
      renderMetaLine('Shipping Addr:', addr.address1, curY + 58);
      renderMetaLine('Location City:', `${addr.city}, ${addr.state}`, curY + 70);
      renderMetaLine('Zip / Postal:', `${addr.postalCode}`, curY + 82);
      renderMetaLine('Country Destination:', addr.country, curY + 94);

      // Panel 3: Print Quality Validation Checklist
      curY = 435;
      drawPanelHeader('3. QUALITY COMPLIANCE CHECKLIST', col1X, curY, colWidth);
      
      const renderCheckLine = (check, status, y) => {
        doc.font('Helvetica-Bold').fillColor('#475569').text(check, col1X, y);
        doc.fillColor(status === 'PASSED' ? '#0fbe88' : '#e11d48').font('Helvetica-Bold').text(`[ ${status} ]`, col1X + 195, y);
      };
      
      renderCheckLine('File Resolution Check:', 'PASSED', curY + 22);
      renderCheckLine('DPI Validation (300 DPI):', 'PASSED', curY + 36);
      renderCheckLine('Safe Print Margin Buffer:', 'PASSED', curY + 50);
      renderCheckLine('Bleed Alignment Boundaries:', 'PASSED', curY + 64);
      renderCheckLine('Layout Dimensions Map:', 'PASSED', curY + 78);
      renderCheckLine('Image Integrity Verification:', 'PASSED', curY + 92);
      renderCheckLine('CMYK Gamut Profiles Check:', 'PASSED', curY + 106);

      // â”€â”€ RIGHT COLUMN (x = 315, width = 260) â”€â”€
      const col2X = 315;

      // Panel 4: Product Specifications
      curY = 145;
      drawPanelHeader('4. PRODUCT DETAILS & SPECS', col2X, curY, colWidth);
      
      const renderSpecLine = (label, value, y) => {
        doc.font('Helvetica-Bold').fillColor('#475569').text(label, col2X, y);
        doc.font('Helvetica').fillColor('#1e293b').text(value, col2X + 85, y);
      };
      
      renderSpecLine('Product Class:', order.productType || 'Canvas Print', curY + 22);
      renderSpecLine('Category Type:', order.productType === 'mobilecase' ? 'Accessories' : 'Personalized Print', curY + 34);
      renderSpecLine('Product SKU:', order.sku, curY + 46);
      renderSpecLine('Product Variant:', order.variant || 'Standard Fit', curY + 58);
      renderSpecLine('Product Color:', order.color || 'N/A (Full Color)', curY + 70);
      renderSpecLine('Product Size:', order.size || 'Standard Size', curY + 82);
      renderSpecLine('Substrate Material:', order.productType === 'mobilecase' ? 'Polycarbonate Hard Plastic' : order.productType === 'mug' ? 'Ceramic Gloss' : 'Fine Cotton Canvas', curY + 94);
      renderSpecLine('Frame Type:', order.frameType || 'N/A', curY + 106);
      renderSpecLine('Mug Type:', order.productType === 'mug' ? '11oz Ceramic' : 'N/A', curY + 118);

      // Panel 5: Printer & Machine Calibration Details
      curY = 295;
      drawPanelHeader('5. PRINT SPECS & MACHINE CALIBRATION', col2X, curY, colWidth);
      
      renderSpecLine('Printing Machine:', order.productType === 'mobilecase' ? 'Roland VersaUV LEF-200' : order.productType === 'mug' ? 'Epson SureColor F570' : 'HP Latex 365 Press', curY + 22);
      renderSpecLine('Ink Set Profile:', 'Eco-Solvent CMYK / UV Ink', curY + 34);
      renderSpecLine('Print Dimensions:', order.skuDetails?.printAreaWidth ? `${order.skuDetails.printAreaWidth}x${order.skuDetails.printAreaHeight} in` : '8.5x11 in', curY + 46);
      renderSpecLine('Color Mode / DPI:', 'CMYK Coated / 300 DPI', curY + 58);
      renderSpecLine('Bleed Size / Safe:', '0.125" Bleed / 0.25" Safe', curY + 70);
      renderSpecLine('Orientation:', (order.skuDetails?.orientation || 'portrait').toUpperCase(), curY + 82);
      renderSpecLine('Lamination Option:', order.productType === 'mobilecase' ? 'UV Clear Gloss Coating' : 'Matte Sealant finish', curY + 94);
      renderSpecLine('Packaging Box:', 'Custom Prink Sleeve Cardboard', curY + 106);

      // Panel 6: Production Pipeline Flow
      curY = 435;
      drawPanelHeader('6. PRODUCTION WORKFLOW PIPELINE', col2X, curY, colWidth);
      
      // Draw Workflow Steps
      const steps = [
        { label: 'Order Received',     status: 'COMPLETED' },
        { label: 'Customer Uploaded',  status: 'COMPLETED' },
        { label: 'Admin Design Appr',  status: 'COMPLETED' },
        { label: 'Printing Queue',     status: 'PROCESSING' },
        { label: 'Quality Audit check',status: 'PENDING' },
        { label: 'Packaging Station',  status: 'PENDING' },
        { label: 'Courier Shipped',    status: 'PENDING' }
      ];
      
      steps.forEach((step, idx) => {
        const y = curY + 22 + (idx * 14);
        doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#475569').text(`${idx + 1}. ${step.label}`, col2X, y);
        let color = '#94a3b8';
        if (step.status === 'COMPLETED') color = '#0fbe88';
        if (step.status === 'PROCESSING') color = '#2563eb';
        doc.fillColor(color).font('Helvetica-Bold').text(step.status, col2X + 195, y);
      });

      // â”€â”€ BOTTOM SECTION â”€â”€
      // Notes Panel
      curY = 590;
      doc.lineWidth(1.5).strokeColor('#171C62').moveTo(20, curY).lineTo(20, curY + 45).stroke();
      doc.fillColor('#171C62').font('Helvetica-Bold').fontSize(8.5).text('PRODUCTION NOTES & SPECIAL REQUESTS', 30, curY + 2);
      doc.font('Helvetica-Oblique').fillColor('#475569').fontSize(7.5);
      doc.text(order.adminComments || order.customerNotes || 'No custom special instructions received. Proceed with default color profile alignment calibration.', 30, curY + 16, { width: 530 });

      // Signatures
      curY = 680;
      doc.lineWidth(0.5).strokeColor('#94a3b8');
      doc.moveTo(20, curY).lineTo(170, curY).stroke();
      doc.moveTo(212, curY).lineTo(362, curY).stroke();
      doc.moveTo(405, curY).lineTo(555, curY).stroke();

      doc.fillColor('#64748b').font('Helvetica').fontSize(7.5);
      doc.text('Admin Digital Signature (Approved)', 20, curY + 5);
      doc.text('Printer Operator Sign (Release)', 212, curY + 5);
      doc.text('Quality Audit Inspector Sign (Pass)', 405, curY + 5);

      // Calibration Bars
      curY = 745;
      const barColors = ['#00FFFF', '#FF00FF', '#FFFF00', '#000000']; // CMYK
      barColors.forEach((col, index) => {
        doc.rect(20 + (index * 20), curY, 15, 8).fill(col);
      });
      doc.fillColor('#94a3b8').font('Helvetica').fontSize(7);
      doc.text('CMYK PRINT CALIBRATION BARS', 110, curY + 1);

      // Page Footer Branding
      doc.text('PAGE 1 OF 2  |  Generated by Prink Print-file Automation System', 300, curY + 1, { align: 'right', width: 275 });
}

module.exports = { drawJobTicket };
