const fs = require('fs');

const file = 'apps/admin/src/components/AdminPortal.tsx';
let lines = fs.readFileSync(file, 'utf8').split('\n');

// 1. Filter out RED side orders
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('const filteredOrders = orders')) {
    if (!lines[i+1].includes('o.templateSide !== \'RED\'')) {
      lines.splice(i + 1, 0, "    .filter(o => o.templateSide !== 'RED')");
    }
    break;
  }
}

// 2. Refactor Customer Details renderer
const renderCustomerDetailsLogic = `
  const renderCustomerDetails = (o: Order, isRed: boolean = false) => {
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {(() => {
            const custVal = o.customer as any;
            const nameStr = (custVal && typeof custVal === 'object')
              ? \`\${custVal.name || custVal.firstName || ''} \${custVal.lastName || ''}\`.trim()
              : String(custVal || 'Guest');
            return (
              <>
                <div className="avatar" style={{ width: 28, height: 28, fontSize: '0.7rem', flexShrink: 0, backgroundColor: isRed ? '#ef4444' : undefined }}>
                  {nameStr[0] || 'G'}
                </div>
                {nameStr} {isRed && <span style={{ fontSize: '0.65rem', color: '#ef4444', fontWeight: 600, border: '1px solid #ef4444', padding: '1px 4px', borderRadius: '4px' }}>RED SIDE</span>}
              </>
            );
          })()}
        </div>
        <div style={{ fontSize: '0.75rem', color: '#6b7280', paddingLeft: '2.25rem', marginTop: '0.1rem' }}>
          {o.customerEmail || (o.customer && typeof o.customer === 'object' ? (o.customer as any).email : '') || o.email || 'N/A'}
        </div>

        {o.images && o.images.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.25rem', paddingLeft: '2.25rem' }}>
            <a 
              href="#" 
              onClick={(e) => { e.preventDefault(); setActivePhotosModalOrder(o); }}
              style={{ fontSize: '0.75rem', color: '#4f46e5', fontWeight: 600, textDecoration: 'underline', display: 'inline-flex', alignItems: 'center', gap: '0.2rem' }}
            >
              <i className="bi bi-eye-fill" /> View Photos ({o.images.length})
            </a>
            <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
              {o.images.map((img: any, idx: number) => {
                let url = img.src || img.url || '';
                if (url && !url.startsWith('/') && !url.startsWith('http') && !url.startsWith('data:') && !url.startsWith('blob:')) {
                  url = '/' + url;
                }
                return (
                  <div key={img.id || idx} style={{ position: 'relative', display: 'inline-block' }}>
                    <img
                      src={url}
                      alt="preview"
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); setActivePhotosModalOrder(o); }}
                      onError={(e) => {
                        e.currentTarget.src = "https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=80";
                      }}
                      style={{ width: '32px', height: '32px', objectFit: 'cover', borderRadius: '4px', border: '1px solid var(--border-color)', cursor: 'pointer' }}
                      title="Click to view full image popup"
                    />
                    <a
                      href={url}
                      download={img.name || \`photo_\${idx + 1}.jpg\`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        position: 'absolute',
                        bottom: '-2px',
                        right: '-2px',
                        background: 'rgba(23, 28, 98, 0.85)',
                        color: 'white',
                        borderRadius: '50%',
                        width: '14px',
                        height: '14px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '8px',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                        cursor: 'pointer',
                        zIndex: 5
                      }}
                      onClick={(e) => e.stopPropagation()}
                      title="Download this photo"
                    >
                      <i className="bi bi-download" />
                    </a>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };
`;

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('const startIndex = (currentPage - 1) * itemsPerPage;')) {
    if (!lines[i-1].includes('renderCustomerDetails')) {
       lines.splice(i, 0, renderCustomerDetailsLogic);
    }
    break;
  }
}

// 3. Replace inline TD
const replacementTd = `
                        {renderCustomerDetails(o)}
                        
                        {o.templateSide === 'BLUE' && (
                          o.linkedOrderId ? (() => {
                            const redOrder = orders.find(ro => ro.id === o.linkedOrderId);
                            if (!redOrder) return null;
                            return (
                              <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px dashed #e5e7eb' }}>
                                {renderCustomerDetails(redOrder, true)}
                              </div>
                            );
                          })() : (
                            <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px dashed #e5e7eb', color: '#dc2626', fontSize: '0.75rem', fontWeight: 600 }}>
                              <i className="bi bi-hourglass-split" /> Waiting for Second Customer... (Red Side Empty)
                            </div>
                          )
                        )}
`;

let startIdx = -1;
let endIdx = -1;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('<div style={{ display: \'flex\', flexDirection: \'column\' }}>') && lines[i+1].includes('<div style={{ display: \'flex\', alignItems: \'center\', gap: \'0.5rem\' }}>')) {
    startIdx = i;
  }
  if (startIdx !== -1 && i > startIdx && lines[i].includes('                      <td className="text-sm text-muted">{o.phone}</td>')) {
    endIdx = i - 2; // Pointing to the </div></div>)}</div> that ends the block before the </td>
    break;
  }
}

if (startIdx !== -1 && endIdx !== -1) {
  lines.splice(startIdx, endIdx - startIdx + 1, replacementTd);
  fs.writeFileSync(file, lines.join('\n'));
  console.log('Successfully replaced logic natively');
} else {
  console.log('Could not find boundaries', startIdx, endIdx);
}
