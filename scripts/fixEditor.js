const fs = require('fs');

// 1. Update AdminPortal.tsx to pass linkedOrder
const portalFile = 'apps/admin/src/components/AdminPortal.tsx';
let portalContent = fs.readFileSync(portalFile, 'utf8');
portalContent = portalContent.replace(
  /<AdminDesignEditor\s*\n\s*order=\{reviewingOrder\}/,
  `<AdminDesignEditor\n          order={reviewingOrder}\n          linkedOrder={reviewingOrder.linkedOrderId ? orders.find(o => o.id === reviewingOrder.linkedOrderId) : undefined}`
);
fs.writeFileSync(portalFile, portalContent);
console.log('Updated AdminPortal.tsx');

// 2. Update AdminDesignEditor.tsx
const editorFile = 'apps/admin/src/components/AdminDesignEditor.tsx';
let editorContent = fs.readFileSync(editorFile, 'utf8');

// A. Add linkedOrder to props
editorContent = editorContent.replace(
  /order: Order;\n  onClose: \(\) => void;/,
  `order: Order;\n  linkedOrder?: Order;\n  onClose: () => void;`
);

editorContent = editorContent.replace(
  /const AdminDesignEditor: React\.FC<AdminDesignEditorProps> = \(\{\n  order,\n  onClose,/,
  `const AdminDesignEditor: React.FC<AdminDesignEditorProps> = ({\n  order,\n  linkedOrder,\n  onClose,`
);

// B. Update renderBox definition
const oldRenderBox = /const renderBox = \(idx: number, x: number, y: number, size: number, color: string, showPhoto: boolean = true\) => \{[\s\S]*?<\/div>\n      \);\n    \};/m;

const newRenderBox = `
    const renderBox = (idx: number, x: number, y: number, size: number, color: string, orderSource?: Order | null) => {
      const crop = butterflyCrops[idx] || { scale: 1, rotation: 0, x: 0, y: 0 };
      const ratio = size / 140;
      const isActive = !isReview && activeButterflyIndex === idx && !!orderSource;
      return (
        <div key={idx + '-' + x} style={{ position: 'absolute', left: x + 'px', top: y + 'px', width: size + 'px', height: size + 'px', border: \`1.5px solid \${color}\`, background: '#f8fafc', overflow: 'hidden' }}>
          {orderSource ? (
            <div onClick={() => !isReview && changeActiveButterflyPhoto(idx)} style={{ width: '100%', height: '100%', position: 'absolute', left: 0, top: 0, cursor: isReview ? 'default' : 'pointer', outline: isActive ? \`2px solid \${color}\` : 'none', outlineOffset: '-2px', zIndex: isActive ? 10 : 1, overflow: 'hidden' }}>
              {(orderSource.images || [])[idx] ? (
                <img crossOrigin="anonymous" src={(orderSource.images || [])[idx].src} alt={\`photo-\${idx}\`} style={{ position: 'absolute', left: 0, top: 0, transformOrigin: 'center', width: '100%', height: '100%', objectFit: 'cover', transform: \`translate(\${crop.x * ratio}px, \${crop.y * ratio}px) scale(\${crop.scale}) rotate(\${crop.rotation}deg)\`, transition: 'transform 0.1s' }} />
              ) : <div style={{ width: '100%', height: '100%', background: '#f1f5f9' }} />}
              <div style={{ position: 'absolute', bottom: '1px', left: '1px', background: 'rgba(255,255,255,0.8)', color: color, fontSize: '5px', fontWeight: 700, padding: '1px 3px', borderRadius: '1px' }}>Photo {idx + 1}</div>
            </div>
          ) : (
             <div style={{ width: '100%', height: '100%', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span style={{ fontSize: '8px', color: '#cbd5e1', fontWeight: 600 }}>EMPTY</span>
             </div>
          )}
        </div>
      );
    };
`;

editorContent = editorContent.replace(oldRenderBox, newRenderBox.trim());

// C. Update P1/P2 large/small calls
const oldCalls = /\{\/\* P1 Large \*\/\}[\s\S]*?\{\/\* P2 Small \*\/\}[\s\S]*?\#dc2626', false\)\)\}/m;

const newCalls = `
        {/* P1 Large */}
        {p1_large.map((coord, i) => renderBox(i, coord.x, coord.y, 81, '#2563eb', order.templateSide === 'RED' ? linkedOrder : order))}
        {/* P2 Large */}
        {p2_large.map((coord, i) => renderBox(i, coord.x, coord.y, 81, '#dc2626', order.templateSide === 'RED' ? order : linkedOrder))}
        {/* P1 Small */}
        {p1_small.map((coord, i) => renderBox(i + 4, coord.x, coord.y, 73, '#2563eb', order.templateSide === 'RED' ? linkedOrder : order))}
        {/* P2 Small */}
        {p2_small.map((coord, i) => renderBox(i + 4, coord.x, coord.y, 73, '#dc2626', order.templateSide === 'RED' ? order : linkedOrder))}
`;

editorContent = editorContent.replace(oldCalls, newCalls.trim());

// Ensure the replace actually happened for calls
if (!editorContent.includes('order.templateSide === \'RED\' ? linkedOrder : order')) {
  console.log("Failed to replace P1/P2 calls. Will do line-by-line replace.");
  let lines = editorContent.split('\\n');
  for (let i=0; i<lines.length; i++) {
    if (lines[i].includes('p1_large.map')) lines[i] = "        {p1_large.map((coord, i) => renderBox(i, coord.x, coord.y, 81, '#2563eb', order.templateSide === 'RED' ? linkedOrder : order))}";
    if (lines[i].includes('p2_large.map')) lines[i] = "        {p2_large.map((coord, i) => renderBox(i, coord.x, coord.y, 81, '#dc2626', order.templateSide === 'RED' ? order : linkedOrder))}";
    if (lines[i].includes('p1_small.map')) lines[i] = "        {p1_small.map((coord, i) => renderBox(i + 4, coord.x, coord.y, 73, '#2563eb', order.templateSide === 'RED' ? linkedOrder : order))}";
    if (lines[i].includes('p2_small.map')) lines[i] = "        {p2_small.map((coord, i) => renderBox(i + 4, coord.x, coord.y, 73, '#dc2626', order.templateSide === 'RED' ? order : linkedOrder))}";
  }
  editorContent = lines.join('\\n');
}

fs.writeFileSync(editorFile, editorContent);
console.log('Updated AdminDesignEditor.tsx');
