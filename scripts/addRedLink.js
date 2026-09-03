const fs = require('fs');

const file = 'apps/admin/src/components/AdminPortal.tsx';
let content = fs.readFileSync(file, 'utf8');

const targetStr = `                            return (
                              <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px dashed #e5e7eb' }}>
                                {renderCustomerDetails(redOrder, true)}
                              </div>
                            );`;

const replacementStr = `                            return (
                              <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px dashed #e5e7eb' }}>
                                <a 
                                  href="#" 
                                  onClick={(e) => { e.preventDefault(); setEditingOrder(redOrder); }}
                                  style={{ fontWeight: 700, color: '#4f46e5', textDecoration: 'underline', fontSize: '0.8rem', display: 'block', marginBottom: '0.25rem' }}
                                  title="Click to open design editor for Red Side order"
                                >
                                  {redOrder.id}
                                </a>
                                {renderCustomerDetails(redOrder, true)}
                              </div>
                            );`;

if (content.includes(targetStr)) {
  content = content.replace(targetStr, replacementStr);
  fs.writeFileSync(file, content);
  console.log('Fixed link successfully');
} else {
  console.log('Could not find target string');
}
