const fs = require('fs');
const path = 'src/components/CustomerPortal.tsx';
let content = fs.readFileSync(path, 'utf8');

const old = `  const NAV_ITEMS: { key: CustomerSubView; icon: React.ComponentType<any>; label: string; badge?: string }[] = [
    { key: 'upload' as CustomerSubView,    icon: ShoppingBag,      label: 'My Orders', badge: String(activeOnly.length) },
    ...((allOrders || []).some(isCustomizable) ? [{ key: 'preview' as CustomerSubView,   icon: UploadCloud,      label: 'Upload Photos' }] : []),
    { key: 'tracking' as CustomerSubView,  icon: MapPin,           label: 'Track Order' },
    { key: 'profile' as CustomerSubView,   icon: User,             label: 'My Profile'  }
  ];`;

const rep = `  const NAV_ITEMS: any[] = [
    { key: 'dashboard', icon: LayoutDashboard,  label: 'My Dashboard' },
    { key: 'orders',    icon: ShoppingBag,      label: 'My Orders', badge: activeOnly.length ? String(activeOnly.length) : undefined },
    ...((allOrders || []).some(isCustomizable) ? [{ key: 'preview',   icon: UploadCloud,      label: 'Upload Photos' }] : []),
    { key: 'tracking',  icon: MapPin,           label: 'Track Order' },
    { key: 'profile',   icon: User,             label: 'My Profile'  }
  ];`;

if (content.includes(old)) {
  content = content.replace(old, rep);
  fs.writeFileSync(path, content);
  console.log('Fixed exactly!');
} else {
  // Try regex
  content = content.replace(
    /const NAV_ITEMS: \{ key: CustomerSubView; icon: React\.ComponentType<any>; label: string; badge\?: string \}\[\] = \[[\s\S]*?\];/,
    rep
  );
  fs.writeFileSync(path, content);
  console.log('Fixed via regex');
}
