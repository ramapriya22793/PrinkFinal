const fs = require('fs');
const path = 'src/components/CustomerPortal.tsx';
let content = fs.readFileSync(path, 'utf8');

if (!content.includes('const isCustomizable =')) {
  content = content.replace(
    /const CustomerPortal: React\.FC<CustomerPortalProps> = \(\{\s*onLogout,\s*initialView\s*\}\) => \{/,
    'const CustomerPortal: React.FC<CustomerPortalProps> = ({ onLogout, initialView }) => {\n  const isCustomizable = (o: any) => {\n    if (!o) return false;\n    const t = (o.productType || \'\').toLowerCase();\n    const p = (o.product || \'\').toLowerCase();\n    return t.includes(\'butterfly\') || p.includes(\'butterfly\') || t.includes(\'magazine\') || p.includes(\'magazine\');\n  };\n'
  );
}

content = content.replace(
  /<button className=\"btn btn-outline\" style=\{\{ border: '1px solid var\(--border-color\)', color: 'var\(--text-primary\)', borderRadius: 12, padding: '8px 16px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 \}\}\s*onClick=\{\(\) => navTo\('preview'\)\}>\s*<UploadCloud style=\{\{ width: 14, height: 14 \}\} \/> Upload Photos\s*<\/button>/,
  '{activeOnly.some(isCustomizable) && (\n                  <button className=\"btn btn-outline\" style={{ border: \'1px solid var(--border-color)\', color: \'var(--text-primary)\', borderRadius: 12, padding: \'8px 16px\', fontSize: 13, display: \'flex\', alignItems: \'center\', gap: 6 }}\n                    onClick={() => navTo(\'preview\')}>\n                    <UploadCloud style={{ width: 14, height: 14 }} /> Upload Photos\n                  </button>\n                  )}'
);

content = content.replace(
  /\{activeOnly\.length > 0 && \(\s*<button className=\"btn\" style=\{\{ background: 'var\(--primary\)', color: '#FFFFFF', borderRadius: 12, padding: '8px 16px', fontSize: 13, border: 'none', display: 'flex', alignItems: 'center', gap: 6 \}\}\s*onClick=\{\(\) => loadSkuTemplate\(activeOnly\[0\]\)\}>\s*<Palette style=\{\{ width: 14, height: 14 \}\} \/> Continue Design\s*<\/button>\s*\)\}/,
  '{activeOnly.length > 0 && isCustomizable(activeOnly[0]) && (\n                    <button className=\"btn\" style={{ background: \'var(--primary)\', color: \'#FFFFFF\', borderRadius: 12, padding: \'8px 16px\', fontSize: 13, border: \'none\', display: \'flex\', alignItems: \'center\', gap: 6 }}\n                      onClick={() => loadSkuTemplate(activeOnly[0])}>\n                      <Palette style={{ width: 14, height: 14 }} /> Continue Design\n                    </button>\n                  )}'
);

content = content.replace(
  /<button className=\"btn btn-outline btn-sm\" style=\{\{ borderRadius: 8 \}\} onClick=\{\(\) => \{ setActiveOrder\(order\); navTo\('preview'\); \}\}>\s*<UploadCloud style=\{\{ width: 12, height: 12 \}\} \/> Upload Photos\s*<\/button>\s*<button className=\"btn btn-primary btn-sm\" style=\{\{ borderRadius: 8, background: 'var\(--primary\)', color: '#fff', border: 'none' \}\} onClick=\{\(\) => loadSkuTemplate\(order\)\}>\s*<Palette style=\{\{ width: 12, height: 12 \}\} \/> \{isCompleted \? 'View Design' : isInProgress \? 'Resume Lab' : 'Customize Design'\}\s*<\/button>/g,
  '{isCustomizable(order) && (\n                            <>\n                              <button className=\"btn btn-outline btn-sm\" style={{ borderRadius: 8 }} onClick={() => { setActiveOrder(order); navTo(\'preview\'); }}>\n                                <UploadCloud style={{ width: 12, height: 12 }} /> Upload Photos\n                              </button>\n                              <button className=\"btn btn-primary btn-sm\" style={{ borderRadius: 8, background: \'var(--primary)\', color: \'#fff\', border: \'none\' }} onClick={() => loadSkuTemplate(order)}>\n                                <Palette style={{ width: 12, height: 12 }} /> {isCompleted ? \'View Design\' : isInProgress ? \'Resume Lab\' : \'Customize Design\'}\n                              </button>\n                            </>\n                          )}'
);

content = content.replace(
  /<button className=\"btn btn-outline btn-sm\" onClick=\{\(\) => \{ setActiveOrder\(order\); navTo\('preview'\); \}\}>\s*<i className=\"bi bi-cloud-upload\" \/> Upload Photos\s*<\/button>\s*\{order\.deliveryStatus !== 'delivered' && \(\s*<button className=\"btn btn-primary btn-sm\" onClick=\{\(\) => loadSkuTemplate\(order\)\}>\s*<i className=\{\`bi \$\{isCompleted \? 'bi-eye' : 'bi-palette'\}\`\} \/>\s*\{isCompleted \? 'View Design' : isInProgress \? 'Resume Lab' : 'Customize Design'\}\s*<\/button>\s*\)\}/g,
  '{isCustomizable(order) && (\n                            <>\n                              <button className=\"btn btn-outline btn-sm\" onClick={() => { setActiveOrder(order); navTo(\'preview\'); }}>\n                                <i className=\"bi bi-cloud-upload\" /> Upload Photos\n                              </button>\n                              {order.deliveryStatus !== \'delivered\' && (\n                                <button className=\"btn btn-primary btn-sm\" onClick={() => loadSkuTemplate(order)}>\n                                  <i className={`bi ${isCompleted ? \'bi-eye\' : \'bi-palette\'}`} />\n                                  {isCompleted ? \'View Design\' : isInProgress ? \'Resume Lab\' : \'Customize Design\'}\n                                </button>\n                              )}\n                            </>\n                          )}'
);

content = content.replace(
  /\{ key: 'preview',   icon: UploadCloud,      label: 'Upload Photos' \},/,
  '...((allOrders || []).some(isCustomizable) ? [{ key: \'preview\',   icon: UploadCloud,      label: \'Upload Photos\' }] : []),'
);

content = content.replace(
  /<button className=\"btn btn-primary btn-sm\" onClick=\{\(\) => navTo\('preview'\)\}>\s*<i className=\"bi bi-cloud-upload\" \/> Upload Photos\s*<\/button>/,
  '{allOrders.some(isCustomizable) && (\n              <button className=\"btn btn-primary btn-sm\" onClick={() => navTo(\'preview\')}>\n                <i className=\"bi bi-cloud-upload\" /> Upload Photos\n              </button>\n              )}'
);

fs.writeFileSync(path, content);
console.log('Update Complete.');
