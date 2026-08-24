
const fs = require('fs');
const path = 'src/components/CustomerPortal.tsx';
let content = fs.readFileSync(path, 'utf8');

const inner = \const CustomerPortal: React.FC<CustomerPortalProps> = ({ onLogout, initialView }) => {
  const isCustomizable = (o: any) => {
    if (!o) return false;
    const t = (o.productType || '').toLowerCase();
    const p = (o.product || '').toLowerCase();
    return t.includes('butterfly') || p.includes('butterfly') || t.includes('magazine') || p.includes('magazine');
  };\;

if (content.includes(inner)) {
  content = content.replace(inner, 'const CustomerPortal: React.FC<CustomerPortalProps> = ({ onLogout, initialView }) => {');
}

const outer = \export const isCustomizable = (o: any) => {
  if (!o) return false;
  const t = (o.productType || '').toLowerCase();
  const p = (o.product || '').toLowerCase();
  return t.includes('butterfly') || p.includes('butterfly') || t.includes('magazine') || p.includes('magazine');
};\;

if (!content.includes('export const isCustomizable =')) {
  content = content.replace('import React', outer + '\n\nimport React');
}

fs.writeFileSync(path, content);

