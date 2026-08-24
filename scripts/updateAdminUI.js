const fs = require('fs');

const file = 'apps/admin/src/components/AdminPortal.tsx';
let content = fs.readFileSync(file, 'utf8');

// 1. Filter out RED side orders
const filteredOrdersOld = `  const filteredOrders = orders
    .filter(o => orderTab === 'all' || o.uploadStatus === orderTab)`;
const filteredOrdersNew = `  const filteredOrders = orders
    .filter(o => o.templateSide !== 'RED')
    .filter(o => orderTab === 'all' || o.uploadStatus === orderTab)`;

if (content.includes(filteredOrdersOld)) {
  content = content.replace(filteredOrdersOld, filteredOrdersNew);
} else {
  console.error("Could not find filteredOrders definition");
  process.exit(1);
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

// Insert the helper function right before "const exportReport" or "const filteredOrders"
const insertTarget = "const startIndex = (currentPage - 1) * itemsPerPage;";
if (content.includes(insertTarget)) {
  content = content.replace(insertTarget, renderCustomerDetailsLogic + '\n  ' + insertTarget);
} else {
  console.error("Could not find insert target for renderCustomerDetails");
  process.exit(1);
}

// 3. Replace the inline <td> code with the helper function call
const oldTdContentStart = `<div style={{ display: 'flex', flexDirection: 'column' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>`;
const oldTdContentEnd = `</div>
                          )}
                        </div>`;

const startIdx = content.indexOf(oldTdContentStart);
const endIdx = content.indexOf(oldTdContentEnd, startIdx) + oldTdContentEnd.length;

if (startIdx === -1 || content.indexOf(oldTdContentEnd) === -1) {
  console.error("Could not find <td> content to replace");
  process.exit(1);
}

const replacement = `
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

content = content.slice(0, startIdx) + replacement.trim() + content.slice(endIdx);
fs.writeFileSync(file, content);
console.log('Updated AdminPortal.tsx successfully');
