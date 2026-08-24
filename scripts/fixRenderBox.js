const fs = require('fs');

const editorFile = 'apps/admin/src/components/AdminDesignEditor.tsx';
let lines = fs.readFileSync(editorFile, 'utf8').split('\n');

const newRenderBox = `
    const renderBox = (idx: number, x: number, y: number, size: number, color: string, orderSource: any = null) => {
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

let startIdx = -1;
let endIdx = -1;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('const renderBox = (idx: number, x: number, y: number, size: number, color: string, showPhoto: boolean = true) => {')) {
    startIdx = i;
  }
  if (startIdx !== -1 && i > startIdx && lines[i].includes('    };')) {
    endIdx = i;
    break;
  }
}

if (startIdx !== -1 && endIdx !== -1) {
  lines.splice(startIdx, endIdx - startIdx + 1, newRenderBox.trim());
  fs.writeFileSync(editorFile, lines.join('\n'));
  console.log("Replaced using lines.splice()");
} else {
  console.log("Could not find start or end!");
}
