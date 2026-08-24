import type { Order, ActivityLog, TemplateItem, PrinterQueueItem, AdminSection } from './types';

export const INITIAL_ORDERS: Order[] = [];

export const ACTIVITY_LOG: ActivityLog[] = [];

export const TEMPLATES: TemplateItem[] = [];

export const INITIAL_QUEUE: PrinterQueueItem[] = [];

export const SECTIONS: { id: AdminSection; icon: any; label: string }[] = [
  { id: 'overview',   icon: 'LayoutDashboard',      label: 'Overview'       },
  { id: 'orders',     icon: 'ShoppingCart',         label: 'Orders'         },
  { id: 'monitor',    icon: 'Activity',             label: 'Upload Monitor' },
  { id: 'templates',  icon: 'Image',                label: 'Templates'      },
  { id: 'sku-mappings', icon: 'Tags',               label: 'SKU Rules' },
  { id: 'users',      icon: 'Users',                label: 'User Management'},
  { id: 'queue',      icon: 'Printer',              label: 'Print Queue'    },
  { id: 'reports',    icon: 'BarChart3',            label: 'Reports'        },
  { id: 'workflow',   icon: 'GitCommit',            label: 'Workflow'       },
  { id: 'settings',   icon: 'Settings',             label: 'Settings'       },
];

