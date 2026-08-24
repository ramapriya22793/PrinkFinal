const fs = require('fs');

const file = 'apps/admin/src/components/AdminPortal.tsx';
let content = fs.readFileSync(file, 'utf8');

const startStr = `<div style={{ display: 'flex', flexDirection: 'column' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            {(() => {
                              const custVal = o.customer as any;`;

const endStr = `                              </div>
                            </div>
                          )}
                        </div>`;

const startIdx = content.indexOf(startStr);
const endIdx = content.indexOf(endStr, startIdx);

if (startIdx === -1) {
  console.error("Start string not found");
  process.exit(1);
}
if (endIdx === -1) {
  console.error("End string not found");
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

content = content.slice(0, startIdx) + replacement.trim() + content.slice(endIdx + endStr.length);
fs.writeFileSync(file, content);
console.log('Replaced inline <td> logic successfully');
