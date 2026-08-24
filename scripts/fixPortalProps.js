const fs = require('fs');

const file = 'apps/admin/src/components/AdminPortal.tsx';
let lines = fs.readFileSync(file, 'utf8').split('\n');

for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('<AdminDesignEditor') && lines[i+1].includes('order={reviewingOrder}')) {
    if (!lines[i+2].includes('linkedOrder')) {
      lines.splice(i + 2, 0, '          linkedOrder={reviewingOrder.linkedOrderId ? orders.find(o => o.id === reviewingOrder.linkedOrderId) : undefined}');
      console.log('Inserted linkedOrder');
    }
    break;
  }
}

fs.writeFileSync(file, lines.join('\n'));
console.log('Fixed AdminPortal.tsx');
