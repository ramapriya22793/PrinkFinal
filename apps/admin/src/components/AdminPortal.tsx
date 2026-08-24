import React, { useEffect, useState, useRef } from 'react';
import AdminEditor from './AdminEditor';
import AdminDesignEditor from "./AdminDesignEditor";
import type { Order, AdminSection, ActivityLog, TemplateItem, PrinterQueueItem, ProductType, SkuMapping, CanvasElement } from '../types';
import AdminSKUManager from './AdminSKUManager';
import AdminUserManager from './AdminUserManager';
import { useToast } from '../context/ToastContext';
import logoBlack from '../assets/logos/logo-black.png';
import whiteLogo from '../assets/logos/white-logo.png';
import websiteLogo from '../assets/logos/website-logo.png';


// ─── Seed Data ───────────────────────────────────────────────────────────────
// All data is loaded from the real API — no mock seed data.

const ACTIVITY_LOG: ActivityLog[] = [];

const TEMPLATES: TemplateItem[] = [
  { id: 't1', name: 'Classic Mug Wrap',     productType: 'mug',       thumbnail: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=200', usageCount: 142, lastModified: 'Jun 15, 2026', tags: ['popular']  },
  { id: 't2', name: 'Ocean Canvas',         productType: 'canvas',    thumbnail: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?q=80&w=200', usageCount: 98,  lastModified: 'Jun 12, 2026', tags: ['new']      },
  { id: 't3', name: 'Portrait Frame',       productType: 'frame',     thumbnail: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?q=80&w=200', usageCount: 67,  lastModified: 'Jun 10, 2026', tags: []           },
  { id: 't4', name: '2027 Family Calendar', productType: 'calendar',  thumbnail: 'https://images.unsplash.com/photo-1506905925346-21bda4d32df4?q=80&w=200', usageCount: 34,  lastModified: 'Jun 8, 2026',  tags: ['seasonal'] },
  { id: 't5', name: 'Rose Photo Book',      productType: 'photobook', thumbnail: 'https://images.unsplash.com/photo-1519741497674-611481863552?q=80&w=200', usageCount: 23,  lastModified: 'Jun 5, 2026',  tags: []           },
];

const SECTIONS: { id: AdminSection; icon: string; label: string }[] = [
  { id: 'overview',   icon: 'bi-grid-1x2',            label: 'Overview'       },
  { id: 'orders',     icon: 'bi-cart3',               label: 'Orders'         },
  { id: 'customers',  icon: 'bi-person-badge',        label: 'Customers'      },
  { id: 'monitor',    icon: 'bi-activity',            label: 'Upload Monitor' },
  { id: 'templates',  icon: 'bi-file-earmark-image',  label: 'Templates'      },
  { id: 'sku-mappings', icon: 'bi-tags-fill',          label: 'SKU Mapping Rules' },
  { id: 'users',        icon: 'bi-people',             label: 'User Management' },
  { id: 'queue',      icon: 'bi-printer',             label: 'Print Queue'    },
  { id: 'reports',    icon: 'bi-graph-up',            label: 'Reports'        },
  { id: 'settings',   icon: 'bi-gear',               label: 'Settings'       },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface AdminPortalProps {
  initialState?: 'login' | 'dashboard';
  onRouteToPrinter?: (order: Order) => void;
}

// ─── Helper Badge Renderers ────────────────────────────────────────────────────

function dpiStatusBadge(status: string, label: string) {
  if (status === 'ok')   return <span className="badge badge-success">{label}</span>;
  if (status === 'low')  return <span className="badge badge-warning">{label}</span>;
  return                         <span className="badge badge-error">{label}</span>;
}

export const hasCustomizationBeenReceived = (o: any): boolean => {
  if (!o) return false;
  return !!(
    o.customizationStatus === 'completed' ||
    o.designLockedAt ||
    (o.images && o.images.length > 0) ||
    ['photo_uploaded', 'approved', 'sent_to_printer', 'printer_processing', 'printing', 'ready_for_dispatch', 'in_transit', 'delivered', 'completed'].includes(o.workflowStatus) ||
    o.uploadStatus === 'ready'
  );
};

function uploadStatusBadge(status: string, submissionStatus?: string) {
  if (submissionStatus === 'Submitted for Admin Review' || status === 'ready') {
    return <span className="badge badge-success">Ready</span>;
  }
  if (status === 'pending' || status === 'awaiting') {
    return <span className="badge badge-warning">Pending</span>;
  }
  return <span className="badge badge-success">Ready</span>;
}

function workflowStatusBadge(ws: string | undefined | null, fallbackUploadStatus?: string) {
  if (!ws) {
    // Fall back to legacy upload status if no workflow status set
    return uploadStatusBadge(fallbackUploadStatus || 'pending');
  }
  const meta: Record<string, { cls: string; label: string }> = {
    order_received:          { cls: 'badge-info',    label: '🛒 Order Received' },
    personalization_pending: { cls: 'badge-warning', label: '📷 Personalization Pending' },
    photo_uploaded:          { cls: 'badge-info',    label: '📷 Personalization Submitted' },
    approved:                { cls: 'badge-success', label: '✅ Approved' },
    rejected:                { cls: 'badge-error',   label: '❌ Rejected' },
    sent_to_printer:         { cls: 'badge-primary', label: '🖨️ Printing' },
    printer_processing:      { cls: 'badge-warning', label: '⚙️ Printing' },
    printing:                { cls: 'badge-warning', label: '🖨️ Printing' },
    ready_for_dispatch:      { cls: 'badge-accent',  label: '📦 Ready for Dispatch' },
    in_transit:              { cls: 'badge-accent',  label: '🚚 In Transit' },
    delivered:               { cls: 'badge-success', label: '🎉 Delivered' },
    completed:               { cls: 'badge-success', label: '🎉 Delivered' },
  };
  const m = meta[ws];
  return m ? <span className={`badge ${m.cls}`}>{m.label}</span> : <span className="badge badge-primary">{ws}</span>;
}


function StatusChip({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    pending:       { label: '⏳ Pending',     cls: 'badge-warning' },
    'print-ready': { label: '📋 Print Ready', cls: 'badge-info' },
    ready:         { label: '📋 Print Ready', cls: 'badge-info' },
    printing:      { label: '🖨️ Printing',   cls: 'badge-primary' },
    processing:    { label: '🖨️ Printing',   cls: 'badge-primary' },
    completed:     { label: '🎉 Completed',  cls: 'badge-success' }
  };
  const item = map[status] || { label: status, cls: 'badge-secondary' };
  return <span className={`badge ${item.cls}`} style={{ fontWeight: 600 }}>{item.label}</span>;
}

function PriorityBadge({ priority }: { priority: PrinterQueueItem['priority'] }) {
  return <span className={`priority-badge ${priority}`}>{priority.charAt(0).toUpperCase() + priority.slice(1)}</span>;
}

// ─── Line Chart placeholder (no mock data) ────────────────────────────────────
// Chart removed — will be powered by real order analytics data when available.

// ─── MAIN COMPONENT ────────────────────────────────────────────────────────────

const AdminPortal: React.FC<AdminPortalProps> = ({ onRouteToPrinter }) => {
  const { showToast } = useToast();

  // Auth
  const [screen, setScreen] = useState<'login' | 'dashboard'>(() => {
    return localStorage.getItem('admin_token') ? 'dashboard' : 'login';
  });
  const [email, setEmail]     = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [loginErr, setLoginErr] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [isRegister, setIsRegister] = useState(false);
  const [regName, setRegName] = useState('');
  const [regPhone, setRegPhone] = useState('');

  // Dashboard
  const [section, setSection] = useState<AdminSection>('overview');
  const [loadingData, setLoadingData] = useState(true);

  // Orders
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderSearch, setOrderSearch] = useState('');
  const [customers, setCustomers] = useState<any[]>([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [orderTab, setOrderTab] = useState<'all' | 'ready' | 'pending' | 'photo_uploaded' | 'approved' | 'rejected' | 'sent_to_printer' | 'printer_processing' | 'completed'>('all');
  const [monitorTab, setMonitorTab] = useState<'all' | 'ready' | 'pending'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [orderTotalPages, setOrderTotalPages] = useState(1);
  const [orderStats, setOrderStats] = useState({ total: 0, pending: 0, ready: 0, revision: 0 });
  const [tabCounts, setTabCounts] = useState<Record<string, number>>({ all: 0, ready: 0, pending: 0, approved: 0, sent_to_printer: 0, completed: 0 });
  const itemsPerPage = 50; // Server-side pagination handles this

  useEffect(() => {
    setCurrentPage(1);
  }, [orderTab, orderSearch]);

  // Templates
  const [templateSearch, setTemplateSearch] = useState('');
  const [hoveredTemplate, setHoveredTemplate] = useState<string | null>(null);

  // Print Queue
  const [printQueue, setPrintQueue] = useState<PrinterQueueItem[]>([]);
  const [queueTab, setQueueTab] = useState<'all' | PrinterQueueItem['status']>('all');

  // Settings toggles
  const [toggles, setToggles] = useState({
    whatsapp: true,
    email: true,
    lowDpi: true,
    dailySummary: false,
    autoUpscale: true,
  });
  const [dpiThreshold, setDpiThreshold] = useState(300);
  const [maxFileMB, setMaxFileMB] = useState(20);

  const [shopifyStore, setShopifyStore] = useState('prink-in.myshopify.com');
  const [shopifyAccessToken, setShopifyAccessToken] = useState('');
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<{ success: boolean; message: string; scopes?: string[] } | null>(null);
  const [isSyncingShopify, setIsSyncingShopify] = useState(false);

  // Upscaler
  const [upscalerRunning, setUpscalerRunning] = useState(false);

  // Sidebar collapsed (mobile)
  const [sidebarOpen, setSidebarOpen] = useState(window.innerWidth > 768);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 768) {
        setSidebarOpen(false);
      } else {
        setSidebarOpen(true);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // SKU Mappings States
  const [skuMappings, setSkuMappings] = useState<SkuMapping[]>([]);
  const [showSkuModal, setShowSkuModal] = useState(false);
  const [editingMapping, setEditingMapping] = useState<Partial<SkuMapping> | null>(null);

  // Database Templates States
  const [dbTemplates, setDbTemplates] = useState<TemplateItem[]>([]);
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<Partial<TemplateItem> | null>(null);

  // Review states
  const [reviewingOrder, setReviewingOrder] = useState<Order | null>(null);
  const [activePhotosModalOrder, setActivePhotosModalOrder] = useState<Order | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);

  const renderNotificationBell = () => {
    const readyOrders = orders.filter(o => o.uploadStatus === 'ready');
    return (
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <button 
          className="btn btn-outline btn-sm" 
          onClick={() => setShowNotifications(!showNotifications)}
          style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
        >
          <i className="bi bi-bell-fill" style={{ color: readyOrders.length > 0 ? '#eab308' : 'inherit' }} />
          <span>Notifications</span>
          {readyOrders.length > 0 && (
            <span style={{
              position: 'absolute',
              top: '-6px',
              right: '-6px',
              background: '#dc2626',
              color: 'white',
              fontSize: '0.6rem',
              borderRadius: '50%',
              width: '16px',
              height: '16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 'bold'
            }}>
              {readyOrders.length}
            </span>
          )}
        </button>
        {showNotifications && (
          <div style={{
            position: 'absolute',
            right: 0,
            top: '38px',
            background: 'white',
            border: '1px solid var(--border-color)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            borderRadius: '8px',
            width: '280px',
            zIndex: 1000,
            maxHeight: '300px',
            overflowY: 'auto',
            padding: '0.5rem'
          }}>
            <h4 style={{ margin: '0.25rem 0.5rem 0.5rem 0.5rem', fontSize: '0.85rem', fontWeight: 'bold', color: 'var(--primary)', borderBottom: '1px solid #f3f4f6', paddingBottom: '0.35rem' }}>
              Customer Photo Uploads ({readyOrders.length})
            </h4>
            {readyOrders.length === 0 ? (
              <div style={{ padding: '1rem', textAlign: 'center', color: '#9ca3af', fontSize: '0.8rem' }}>
                No new photo uploads.
              </div>
            ) : (
              readyOrders.map(o => (
                <div 
                  key={o.id} 
                  onClick={() => { setEditingOrder(o); setShowNotifications(false); }}
                  style={{ 
                    padding: '0.5rem', 
                    borderRadius: '6px', 
                    cursor: 'pointer', 
                    fontSize: '0.75rem', 
                    borderBottom: '1px solid #f9fafb',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem'
                  }}
                  className="hover:bg-gray-50"
                >
                  <div className="avatar" style={{ width: 24, height: 24, fontSize: '0.65rem' }}>
                    {((typeof o.customer === 'object' ? o.customer?.name : o.customer) || 'C')[0]}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 'semibold', color: 'var(--primary)' }} className="truncate">
                      {(typeof o.customer === 'object' ? o.customer?.name : o.customer) || 'Customer'}
                    </div>
                    <div style={{ color: '#6b7280' }} className="truncate">
                      Uploaded photos for {o.id}
                    </div>
                  </div>
                  <span style={{ fontSize: '0.65rem', color: '#10b981', fontWeight: 'bold' }}>Ready</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    );
  };
  const [isRoutingToPrinter, setIsRoutingToPrinter] = useState(false);
  const [reviewComments, setReviewComments] = useState('');
  const [simulatedUploadLink, setSimulatedUploadLink] = useState('');
  const [simulatedOrderId, setSimulatedOrderId] = useState('');

  const emailRef = useRef<HTMLInputElement>(null);
  
  // Guard refs to prevent stacking parallel requests
  const isFetchingCustomers = useRef(false);
  const isFetchingOrders = useRef(false);
  const isFetchingQueue = useRef(false);

  useEffect(() => {
    if (screen === 'login') emailRef.current?.focus();
  }, [screen]);

  // ── Persistent Data Fetchers ────────────────────────────────────────────────
  const fetchCustomers = async () => {
    if (isFetchingCustomers.current) return;
    isFetchingCustomers.current = true;
    try {
      const res = await fetch('/api/customers', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setCustomers(Array.isArray(data) ? data : (data.customers || []));
      }
    } catch (err) {
      console.error('Failed to fetch customers:', err);
    } finally {
      isFetchingCustomers.current = false;
    }
  };

  const fetchOrders = async (retryCount = 0, page = 1, status = orderTab, search = orderSearch) => {
    if (isFetchingOrders.current) {
      console.log('[fetchOrders] SKIPPED - already in progress');
      return;
    }
    isFetchingOrders.current = true;
    if (orders.length === 0) {
      setLoadingData(true);
    }
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: '50',
        ...(status && status !== 'all' ? { status } : {}),
        ...(search.trim() ? { search: search.trim() } : {})
      });
      const url = '/api/orders?' + params.toString();
      console.log('[fetchOrders] Calling:', url);
      const res = await fetch(url, {
        headers: {
          'Authorization': 'Bearer ' + localStorage.getItem('admin_token'),
          'Cache-Control': 'no-cache'
        }
      });
      console.log('[fetchOrders] Status:', res.status, res.ok);
      if (res.ok) {
        const data = await res.json();
        console.log('[fetchOrders] orders:', data.orders?.length, 'stats:', JSON.stringify(data.stats));
        const list = data.orders || (Array.isArray(data) ? data : []);
        const sortedList = (list || []).sort((a: any, b: any) => {
          const timeA = new Date(a.createdAt || a.date || 0).getTime();
          const timeB = new Date(b.createdAt || b.date || 0).getTime();
          if (timeA !== timeB) return timeB - timeA;
          const numA = parseInt(String(a.orderNumber || a.id).replace(/\D/g, '')) || 0;
          const numB = parseInt(String(b.orderNumber || b.id).replace(/\D/g, '')) || 0;
          return numB - numA;
        });
        setOrders(sortedList);
        if (data.pagination) {
          setOrderTotalPages(data.pagination.pages || 1);
        }
        if (data.stats) {
          setOrderStats(data.stats);
        }
        if (data.tabCounts) {
          setTabCounts(data.tabCounts);
        }
        console.log('[fetchOrders] setOrders called with', list.length, 'items');
      } else if (res.status === 401 || res.status === 403) {
        console.warn('[fetchOrders] Auth error - logging out');
        localStorage.removeItem('admin_token');
        setScreen('login');
        showToast('Session expired. Please log in again.', 'error');
      } else if (res.status >= 500 && retryCount < 3) {
        console.warn('[fetchOrders] Server error ' + res.status + ', retry ' + (retryCount + 1));
        isFetchingOrders.current = false;
        await new Promise(r => setTimeout(r, 1500 * (retryCount + 1)));
        return fetchOrders(retryCount + 1, page, status, search);
      } else {
        console.error('[fetchOrders] Unexpected status:', res.status);
        showToast('Could not load orders. Click Sync Shopify Orders to retry.', 'error');
      }
    } catch (err) {
      console.error('[fetchOrders] Exception:', err);
    } finally {
      isFetchingOrders.current = false;
      setLoadingData(false);
    }
  };


  const fetchQueue = async () => {
    if (isFetchingQueue.current) return;
    isFetchingQueue.current = true;
    try {
      const res = await fetch('/api/printer/queue', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.queue || []);
        setPrintQueue(list);
      }
    } catch (err) {
      console.error('Failed to fetch print queue:', err);
    } finally {
      isFetchingQueue.current = false;
    }
  };


  const fetchSkuMappings = async () => {
    try {
      const res = await fetch('/api/skus', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSkuMappings(Array.isArray(data) ? data : (data.skus || []));
      }
    } catch (err) {
      console.error('Failed to fetch SKU mappings:', err);
    }
  };

  const fetchDbTemplates = async () => {
    try {
      const res = await fetch('/api/templates', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setDbTemplates(Array.isArray(data) ? data : (data.templates || []));
      }
    } catch (err) {
      console.error('Failed to fetch templates:', err);
    }
  };

  // ── fetchSettings ────────────────────────────────────────────────────────────
  const fetchSettings = async () => {
    try {
      const res = await fetch('/api/settings', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setToggles({
          whatsapp:     data.whatsappEnabled     ?? true,
          email:        data.emailEnabled         ?? true,
          lowDpi:       data.lowDpiAlertsEnabled  ?? true,
          dailySummary: data.dailySummaryEnabled  ?? false,
          autoUpscale:  data.autoUpscaleEnabled   ?? true,
        });
        if (data.dpiThreshold) setDpiThreshold(data.dpiThreshold);
        if (data.maxFileMB)    setMaxFileMB(data.maxFileMB);
        if (data.shopifyStore) setShopifyStore(data.shopifyStore);
        if (data.shopifyAccessToken !== undefined) setShopifyAccessToken(data.shopifyAccessToken);
      }
    } catch (err) {
      console.error('Failed to fetch settings:', err);
    }
  };

  const saveSkuMapping = async () => {
    if (!editingMapping?.sku || !editingMapping?.productType) {
      showToast('SKU and Product Type are required.', 'warning');
      return;
    }
    try {
      const isNew = !editingMapping.id;
      const url = isNew ? '/api/skus' : `/api/skus/${editingMapping.id}`;
      const method = isNew ? 'POST' : 'PUT';
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
        },
        body: JSON.stringify(editingMapping)
      });
      if (res.ok) {
        showToast(`SKU Mapping ${isNew ? 'created' : 'updated'} successfully!`, 'success');
        setShowSkuModal(false);
        fetchSkuMappings();
      } else {
        const data = await res.json();
        showToast(data.error || 'Failed to save SKU mapping.', 'error');
      }
    } catch (err) {
      console.error('Error saving SKU mapping:', err);
    }
  };

  const deleteSkuMapping = async (id: string) => {
    if (!confirm('Are you sure you want to delete this SKU mapping?')) return;
    try {
      const res = await fetch(`/api/skus/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_token')}` }
      });
      if (res.ok) {
        showToast('SKU Mapping deleted.', 'success');
        fetchSkuMappings();
      }
    } catch (err) {
      console.error('Error deleting SKU mapping:', err);
    }
  };

  const saveTemplate = async () => {
    if (!editingTemplate?.name || !editingTemplate?.productType) {
      showToast('Name and Product Type are required.', 'warning');
      return;
    }
    try {
      const isNew = !editingTemplate.id;
      const url = isNew ? '/api/templates' : `/api/templates/${editingTemplate.id}`;
      const method = isNew ? 'POST' : 'PUT';
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
        },
        body: JSON.stringify(editingTemplate)
      });
      if (res.ok) {
        showToast(`Template ${isNew ? 'created' : 'updated'} successfully!`, 'success');
        setShowTemplateModal(false);
        fetchDbTemplates();
      } else {
        const data = await res.json();
        showToast(data.error || 'Failed to save template.', 'error');
      }
    } catch (err) {
      console.error('Error saving template:', err);
    }
  };

  const deleteTemplate = async (id: string) => {
    if (!confirm('Are you sure you want to delete this template?')) return;
    try {
      const res = await fetch(`/api/templates/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_token')}` }
      });
      if (res.ok) {
        showToast('Template deleted.', 'success');
        fetchDbTemplates();
      }
    } catch (err) {
      console.error('Error deleting template:', err);
    }
  };

  const duplicateTemplate = async (template: TemplateItem) => {
    try {
      const duplicated: Partial<TemplateItem> = {
        name: `${template.name} (Copy)`,
        productType: template.productType,
        category: template.category || 'mug',
        thumbnail: template.thumbnail,
        tags: [...(template.tags || []), 'duplicated'],
        elements: template.elements || []
      };
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
        },
        body: JSON.stringify(duplicated)
      });
      if (res.ok) {
        showToast('Template duplicated successfully!', 'success');
        fetchDbTemplates();
      } else {
        showToast('Failed to duplicate template.', 'error');
      }
    } catch (err) {
      console.error('Error duplicating template:', err);
    }
  };


  const handleReviewDecision = async (action: 'approve' | 'reject' | 'request_reupload') => {
    if (!reviewingOrder) return;
    try {
      const res = await fetch(`/api/orders/${reviewingOrder.id}/review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
        },
        body: JSON.stringify({ action, comments: reviewComments })
      });
      if (res.ok) {
        let msg = 'Design approved and enqueued into Printer Queue!';
        if (action === 'request_reupload') msg = 'Re-upload request sent to customer.';
        else if (action === 'reject') msg = 'Design rejected. Customer asked to make corrections.';
        
        showToast(msg, action === 'approve' ? 'success' : 'warning');
        setReviewingOrder(null);
        setReviewComments('');
        fetchOrders();
      } else {
        const data = await res.json();
        showToast(data.error || 'Failed to submit review decision.', 'error');
      }
    } catch (err) {
      console.error('Error submitting review decision:', err);
    }
  };

  useEffect(() => {
    if (screen === 'dashboard') {
      fetchOrders();

      // Fetch all other lists in the background without blocking the main KPI Overview
      fetchCustomers();
      fetchQueue();
      fetchSettings();
      fetchSkuMappings();
      fetchDbTemplates();

      // Poll database updates automatically every 10 seconds
      // so the admin dashboard gets updated without overloading the database.
      const interval = setInterval(() => {
        fetchOrders();
        fetchQueue();
      }, 10000);

      return () => clearInterval(interval);
    }
  }, [screen]);

  // ── Auth ──────────────────────────────────────────────────────────────────────
  const handleRegister = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!regName.trim() || !email.trim() || !password.trim()) { setLoginErr('Please enter name, email and password.'); return; }
    setLoginErr('');
    setLoggingIn(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: regName, email, phone: regPhone, password, role: 'admin' }),
      });
      const data = await res.json();
      setLoggingIn(false);
      if (res.ok && data.success) {
        localStorage.setItem('admin_token', data.token);
        setScreen('dashboard');
        showToast('Account created! Welcome, Admin!', 'success');
      } else {
        setLoginErr(data.error || 'Registration failed.');
      }
    } catch (err) {
      setLoggingIn(false);
      setLoginErr('Unable to reach server. Please try again.');
    }
  };

  const handleAdminDirectUpload = async (e: React.ChangeEvent<HTMLInputElement>, orderId: string) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    showToast('Uploading photo(s) to order...', 'info');
    
    try {
      // Upload through the customer's own tokenised portal endpoints rather
      // than a separate admin path, so originals, resolution validation and
      // transform handling stay identical however a photo arrives.
      const tokenRes = await fetch(`/api/orders/${encodeURIComponent(orderId)}/upload-token`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_token')}` }
      });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.token) {
        showToast(tokenData.error || 'This order has no upload link.', 'error');
        return;
      }
      const base = `/api/public/order/${encodeURIComponent(tokenData.token)}`;

      for (let i = 0; i < files.length; i++) {
        const formData = new FormData();
        formData.append('image', files[i]);

        const res = await fetch(`${base}/upload`, { method: 'POST', body: formData });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.success) {
          // Surface the real reason (too small, wrong type, limit reached)
          // instead of a generic failure.
          showToast(data.error || `Failed to upload ${files[i].name}.`, 'error');
          return;
        }
      }

      await fetch(`${base}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes: 'Uploaded by Admin' })
      });

      showToast('Photos uploaded successfully.', 'success');
      fetchOrders();
    } catch (err) {
      console.error(err);
      showToast('Failed to upload photos.', 'error');
    } finally {
      e.target.value = '';
    }
  };

  const handleDeletePhoto = async (orderId: string, photoId: string) => {
    if (!window.confirm('Are you sure you want to delete this photo? This will delete both the database entry and filesystem files.')) return;
    try {
      const res = await fetch(`/api/orders/${orderId}/photos/${photoId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer ' + localStorage.getItem('admin_token')
        }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('Photo deleted successfully.', 'success');
        setActivePhotosModalOrder(data.order);
        isFetchingOrders.current = false;
        await fetchOrders();
      } else {
        showToast(data.error || 'Failed to delete photo.', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error deleting photo.', 'error');
    }
  };

  const handleDeleteAllPhotos = async (orderId: string) => {
    if (!window.confirm('Are you sure you want to delete ALL photos from this order? This cannot be undone.')) return;
    try {
      const res = await fetch(`/api/orders/${orderId}/photos`, {
        method: 'DELETE',
        headers: {
          'Authorization': 'Bearer ' + localStorage.getItem('admin_token')
        }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        showToast('All photos cleared successfully.', 'success');
        setActivePhotosModalOrder(data.order);
        isFetchingOrders.current = false;
        await fetchOrders();
      } else {
        showToast(data.error || 'Failed to clear photos.', 'error');
      }
    } catch (err: any) {
      showToast(err.message || 'Error clearing photos.', 'error');
    }
  };

  const handleLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!email.trim() || !password.trim()) { setLoginErr('Please enter email and password.'); return; }
    setLoginErr('');
    setLoggingIn(true);
    try {
      const res = await fetch('/api/auth/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      setLoggingIn(false);
      if (res.ok && data.success) {
        localStorage.setItem('admin_token', data.token);
        setScreen('dashboard');
        showToast('Welcome back, Admin!', 'success');
      } else {
        setLoginErr(data.error || 'Invalid credentials.');
      }
    } catch (err) {
      setLoggingIn(false);
      setLoginErr('Unable to reach server. Please try again.');
    }
  };

  // ── Admin Functions ───────────────────────────────────────────────────────────
  const runUpscaler = async () => {
    if (upscalerRunning) return;
    setUpscalerRunning(true);
    showToast('AI Upscaler started — processing low-DPI images…', 'info');
    
    const lowDpiOrders = orders.filter(o => o.dpiStatus === 'low');
    let upscaledCount = 0;
    
    for (const order of lowDpiOrders) {
      try {
        const res = await fetch(`/api/orders/${encodeURIComponent(order.id)}/upscale`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
          }
        });
        if (res.ok) {
          upscaledCount++;
        }
      } catch (err) {
        console.error('Upscale failed for:', order.id, err);
      }
    }
    
    setUpscalerRunning(false);
    if (upscaledCount > 0) {
      showToast(`AI Upscaler complete — ${upscaledCount} images upscaled to 300 DPI (AI↑)`, 'success');
      fetchOrders();
    } else {
      showToast('No low-DPI images found to upscale.', 'warning');
    }
  };

  const sendWhatsApp = async (id: string, customer: string) => {
    showToast(`Sending WhatsApp upload link to ${customer}…`, 'info');
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(id)}/notify`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
        }
      });
      if (res.ok) {
        showToast(`Upload link sent to ${customer} for order ${id}`, 'success');
      } else {
        showToast('Failed to dispatch alert.', 'error');
      }
    } catch (err) {
      showToast('Error dispatching WhatsApp reminder.', 'error');
    }
  };

  const forceApprove = async (id: string) => {
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(id)}/force-approve`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
        }
      });
      if (res.ok) {
        showToast(`Order ${id} force-approved and marked as ready`, 'warning');
        fetchOrders();
      } else {
        showToast('Failed to force approve order.', 'error');
      }
    } catch (err) {
      showToast('Error sending approval request.', 'error');
    }
  };

  const routeToPrinter = async (order: Order) => {
    setIsRoutingToPrinter(true);
    showToast(`Routing order ${order.id} to Printer Operator…`, 'info');
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(order.id)}/route-to-printer`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
        }
      });
      if (res.ok) {
        showToast(`Order ${order.id} sent to print queue`, 'success');
        onRouteToPrinter?.(order);
        fetchOrders();
        fetchQueue();
      } else {
        showToast('Failed to route order to print queue.', 'error');
      }
    } catch (err) {
      showToast('Error routing order.', 'error');
      }
      setIsRoutingToPrinter(false);
  };

  const markComplete = (id: string) => {
    setPrintQueue(prev => prev.map(q => q.id === id ? { ...q, status: 'completed' } : q));
    showToast(`Order ${id} marked as completed`, 'success');
  };

  const saveSettings = async () => {
    try {
      // The settings endpoint is PUT; POST is not routed and 404s.
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('admin_token')}`
        },
        body: JSON.stringify({
          shopifyStore,
          shopifyAccessToken,
          whatsappEnabled: toggles.whatsapp,
          emailEnabled: toggles.email,
          lowDpiAlertsEnabled: toggles.lowDpi,
          dailySummaryEnabled: toggles.dailySummary,
          autoUpscaleEnabled: toggles.autoUpscale,
          dpiThreshold,
          maxFileMB
        })
      });
      if (res.ok) {
        showToast('Settings saved successfully', 'success');
        fetchSettings();
      } else {
        const data = await res.json();
        showToast(data.error || 'Failed to save settings', 'error');
      }
    } catch (err) {
      console.error('Error saving settings:', err);
      showToast('Error saving settings', 'error');
    }
  };

  const syncShopify = async () => {
    setIsSyncingShopify(true);
    showToast('Shopify sync started…', 'info');
    try {
      const res = await fetch('/api/shopify/sync', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('admin_token')}` 
        }
      });

      if (res.ok) {
        showToast('Shopify sync completed successfully!', 'success');
        fetchOrders();
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Shopify sync failed. Verify your credentials.', 'warning');
      }
    } catch (err) {
      console.error('Shopify sync error:', err);
      showToast('Failed to complete Shopify sync.', 'error');
    } finally {
      setIsSyncingShopify(false);
    }
  };

  const testShopifyConnection = async () => {
    setIsTestingConnection(true);
    setConnectionStatus(null);
    try {
      const res = await fetch('/api/shopify/test-connection', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('admin_token')}` }
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setConnectionStatus({
          success: true,
          message: 'Connection successful!',
          scopes: data.scopes
        });
        showToast('Shopify connection tested successfully!', 'success');
      } else {
        setConnectionStatus({
          success: false,
          message: data.error || 'Connection failed. Please check your credentials.'
        });
        showToast('Shopify connection test failed.', 'error');
      }
    } catch (err: any) {
      console.error(err);
      setConnectionStatus({
        success: false,
        message: err.message || 'Error testing connection'
      });
      showToast('Error testing connection.', 'error');
    } finally {
      setIsTestingConnection(false);
    }
  };

  const genAllPDFs   = () => showToast('Generating PDFs for all ready orders…', 'info');
  const exportReport = () => showToast('Exporting report as CSV…', 'info');

  // ── Derived ───────────────────────────────────────────────────────────────────
  const filteredOrders = orders
    .filter(o => o.templateSide !== 'RED')
    .filter(o => {
      if (orderTab === 'all') return true;
      if (orderTab === 'ready') return hasCustomizationBeenReceived(o);
      if (orderTab === 'pending') return !hasCustomizationBeenReceived(o);
      if (orderTab === 'photo_uploaded') return hasCustomizationBeenReceived(o);
      if (o.workflowStatus) return o.workflowStatus === orderTab;
      if (orderTab === 'approved') return o.adminApprovalStatus === 'approved';
      if (orderTab === 'rejected') return o.adminApprovalStatus === 'rejected';
      return false;
    })
    .filter(o =>
      orderSearch.trim() === '' ||
      o.id.toLowerCase().includes(orderSearch.toLowerCase()) ||
      (typeof o.customer === 'object' ? (o.customer as any)?.name || 'Guest' : o.customer || 'Guest').toLowerCase().includes(orderSearch.toLowerCase()) ||
      o.product.toLowerCase().includes(orderSearch.toLowerCase())
    )
    .sort((a, b) => {
      const timeA = new Date(a.createdAt || a.date || 0).getTime();
      const timeB = new Date(b.createdAt || b.date || 0).getTime();
      if (timeA !== timeB) return timeB - timeA;
      const numA = parseInt(String(a.orderNumber || a.id).replace(/\D/g, '')) || 0;
      const numB = parseInt(String(b.orderNumber || b.id).replace(/\D/g, '')) || 0;
      return numB - numA;
    });


  const renderCustomerDetails = (o: Order, isRed: boolean = false) => {
    return (
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {(() => {
            const custVal = o.customer as any;
            const nameStr = (custVal && typeof custVal === 'object')
              ? `${custVal.name || custVal.firstName || ''} ${custVal.lastName || ''}`.trim()
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
        {(o.shippingAddress || o.deliveryTemplate) && (
          <div style={{ fontSize: '0.7rem', color: '#4b5563', paddingLeft: '2.25rem', marginTop: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.3rem', flexWrap: 'wrap' }}>
            <i className="bi bi-geo-alt-fill" style={{ color: '#ec4899' }} />
            <span>
              {o.shippingAddress
                ? (typeof o.shippingAddress === 'object'
                  ? `${(o.shippingAddress as any).address1 || ''}, ${(o.shippingAddress as any).city || ''} ${(o.shippingAddress as any).zip || ''}`
                  : String(o.shippingAddress))
                : 'Standard Delivery'}
            </span>
            {(o.deliveryTemplate || o.shippingMethod || o.courierName) && (
              <span className="badge badge-info" style={{ fontSize: '0.65rem', padding: '1px 5px' }}>
                🚚 {o.deliveryTemplate || o.shippingMethod || o.courierName}
              </span>
            )}
          </div>
        )}

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
                      download={img.name || `photo_${idx + 1}.jpg`}
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

  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedOrders = filteredOrders.slice(startIndex, startIndex + itemsPerPage);
  const totalPages = Math.ceil(filteredOrders.length / itemsPerPage);

  const filteredTemplates = TEMPLATES.filter(t =>
    templateSearch.trim() === '' ||
    t.name.toLowerCase().includes(templateSearch.toLowerCase()) ||
    t.productType.toLowerCase().includes(templateSearch.toLowerCase())
  );

  const filteredQueue = printQueue.filter(q => {
    if (queueTab === 'all') return true;
    if (queueTab === 'print-ready') return q.status === 'print-ready' || (q.status as string) === 'ready';
    if (queueTab === 'printing') return q.status === 'printing' || (q.status as string) === 'processing';
    return q.status === queueTab;
  });

  const photoUploadedCount  = orders.filter(o => o.workflowStatus === 'photo_uploaded' || (!o.workflowStatus && o.uploadStatus === 'ready')).length;
  const approvedCount       = orders.filter(o => o.workflowStatus === 'approved' || (!o.workflowStatus && o.adminApprovalStatus === 'approved')).length;
  const rejectedCount       = orders.filter(o => o.workflowStatus === 'rejected' || (!o.workflowStatus && o.adminApprovalStatus === 'rejected')).length;
  const sentToPrinterCount  = orders.filter(o => o.workflowStatus === 'sent_to_printer').length;
  const processingCount     = orders.filter(o => o.workflowStatus === 'printer_processing').length;
  const completedCount      = orders.filter(o => o.workflowStatus === 'completed').length;

  // Legacy counts for KPI cards
  const readyCount    = orders.filter(o => o.uploadStatus === 'ready').length;
  const awaitingCount = orders.filter(o => o.uploadStatus === 'awaiting').length;
  const pendingCount  = orders.filter(o => o.uploadStatus === 'pending').length;

  useEffect(() => {
    if (activePhotosModalOrder) {
      const latest = orders.find(o => o.id === activePhotosModalOrder.id);
      if (latest) {
        setActivePhotosModalOrder(latest);
      }
    }
    if (reviewingOrder) {
      const latest = orders.find(o => o.id === reviewingOrder.id);
      if (latest) {
        setReviewingOrder(latest);
      }
    }
    if (editingOrder) {
      const latest = orders.find(o => o.id === editingOrder.id);
      if (latest) {
        setEditingOrder(latest);
      }
    }
  }, [orders, activePhotosModalOrder, reviewingOrder, editingOrder]);

  const activityDotColor = (type: ActivityLog['type']) => {
    const map = { order: 'order', upload: 'upload', print: 'print', system: 'system' };
    return map[type] ?? 'system';
  };

  // ── LOGIN SCREEN ──────────────────────────────────────────────────────────────
  if (screen === 'login') {
    return (
      <div className="admin-split-layout">
        {/* Left – Form */}
        <div className="admin-split-left">
          <div className="admin-login-form-wrap">
            <div className="admin-login-logo" style={{ marginBottom: '20px' }}>
              <img src={logoBlack} alt="the Prink Logo" style={{ height: '48px', width: 'auto', display: 'block' }} />
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--primary)', marginBottom: '0.25rem' }}>
              Admin Portal
            </h2>
            <p style={{ color: '#6b7280', marginBottom: '2rem', fontSize: '0.875rem' }}>
              Sign in to access the dashboard
            </p>
            <form onSubmit={isRegister ? handleRegister : handleLogin} autoComplete="off">
                {isRegister && (
                  <>
                    <div className="input-group" style={{ marginBottom: '1rem' }}>
                      <label className="label" htmlFor="admin-name">Full Name</label>
                      <input
                        id="admin-name"
                        className="input"
                        type="text"
                        placeholder="Admin Name"
                        value={regName}
                        onChange={e => setRegName(e.target.value)}
                      />
                    </div>
                    <div className="input-group" style={{ marginBottom: '1rem' }}>
                      <label className="label" htmlFor="admin-phone">Phone Number</label>
                      <input
                        id="admin-phone"
                        className="input"
                        type="tel"
                        placeholder="Optional"
                        value={regPhone}
                        onChange={e => setRegPhone(e.target.value)}
                      />
                    </div>
                  </>
                )}
                <div className="input-group" style={{ marginBottom: '1rem' }}>
                <label className="label" htmlFor="admin-email">Email Address</label>
                <input
                  id="admin-email"
                  ref={emailRef}
                  className="input"
                  type="email"
                  placeholder="admin@theprink.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLogin()}
                  autoComplete="new-password"
                />
              </div>
              <div className="input-group" style={{ marginBottom: '1.5rem' }}>
                <label className="label" htmlFor="admin-password">Password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="admin-password"
                    className="input"
                    style={{ width: '100%', paddingRight: '2.5rem' }}
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleLogin()}
                    autoComplete="new-password"
                  />
                  <button 
                    type="button"
                    style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer' }}
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    <i className={`bi bi-eye${showPassword ? '-slash' : ''}`} />
                  </button>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: '1.5rem', fontSize: 13, color: 'var(--text-secondary)' }}>
                <input 
                  type="checkbox" 
                  id="admin-remember" 
                  checked={rememberMe}
                  onChange={e => setRememberMe(e.target.checked)}
                  style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--primary)' }} 
                />
                <label htmlFor="admin-remember" style={{ cursor: 'pointer' }}>Remember me</label>
              </div>

              {loginErr && (
                <div style={{
                  background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px',
                  padding: '0.75rem 1rem', color: '#dc2626', fontSize: '0.8125rem', marginBottom: '1rem'
                }}>
                  <i className="bi bi-exclamation-triangle-fill" style={{ marginRight: '0.4rem' }} />
                  {loginErr}
                </div>
              )}
              <button
                id="admin-login-btn"
                type="submit"
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', padding: '0.75rem 1rem' }}
                  onClick={isRegister ? handleRegister : handleLogin}
                  disabled={loggingIn}
                >
                  {loggingIn ? <span className="spinner" style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} /> : <><i className="bi bi-shield-lock" /> {isRegister ? 'Register' : 'Access Dashboard'}</>}
                </button>
              </form>
              <div style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.875rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>{isRegister ? 'Already have an account?' : 'First time user?'} </span>
                <button type="button" onClick={() => setIsRegister(!isRegister)} style={{ background: 'none', border: 'none', color: 'var(--primary)', fontWeight: 600, cursor: 'pointer' }}>{isRegister ? 'Sign in' : 'Sign up'}</button>
              </div>
            {/* Demo credentials text removed */}
            <div style={{ textAlign: 'center', opacity: 0.5 }}>
              <img src={websiteLogo} alt="the Prink Website Logo" style={{ height: '22px', width: 'auto', display: 'inline-block' }} />
            </div>
          </div>
        </div>

        {/* Right – Feature Panel */}
        <div className="admin-split-right">
          <div className="admin-split-right-content">
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
              background: 'rgba(255,255,255,0.15)', borderRadius: '20px',
              padding: '0.375rem 0.875rem', marginBottom: '2rem'
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4ade80', display: 'inline-block' }} />
              <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>All Systems Operational</span>
            </div>
            <h2 style={{ fontSize: '2rem', fontWeight: 800, color: '#fff', lineHeight: 1.2, marginBottom: '0.75rem' }}>
              Production Command Centre
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.95rem', marginBottom: '2.5rem', lineHeight: 1.6 }}>
              Manage orders, monitor uploads, control print queues — all from a single intelligent dashboard.
            </p>
            <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {[
                { icon: 'bi-arrow-repeat',         text: 'Live Shopify order sync'          },
                { icon: 'bi-stars',                text: 'AI-powered DPI upscaler'          },
                { icon: 'bi-printer-fill',         text: 'One-click PDF routing to printer' },
                { icon: 'bi-graph-up-arrow',       text: 'Revenue & fulfillment analytics'  },
                { icon: 'bi-whatsapp',             text: 'WhatsApp upload reminders'        },
              ].map(f => (
                <li key={f.icon} style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                  <span style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: 'rgba(255,255,255,0.15)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                  }}>
                    <i className={`bi ${f.icon}`} style={{ color: '#fff', fontSize: '0.95rem' }} />
                  </span>
                  <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: '0.9rem' }}>{f.text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  // ── DASHBOARD ─────────────────────────────────────────────────────────────────
  return (
    <div className="portal-layout" style={{ position: 'relative' }}>
      {/* ── Sidebar Backdrop (Mobile Only) ── */}
      {sidebarOpen && (
        <div className="sidebar-backdrop show-mobile" onClick={() => setSidebarOpen(false)} />
      )}

      {/* ── Sidebar ── */}
      <aside className={`portal-sidebar admin-sidebar collapsible-sidebar${sidebarOpen ? ' open mobile-open' : ''}`}>
        <div className="sidebar-logo-area" style={{ display: 'flex', alignItems: 'center', padding: '12px 16px' }}>
          <img src={whiteLogo} alt="the Prink Admin" style={{ height: '32px', width: 'auto', display: 'block' }} />
          <button className="btn btn-outline btn-sm show-mobile" style={{ marginLeft: 'auto', padding: '4px 8px', color: '#fff', borderColor: 'rgba(255,255,255,0.2)' }} onClick={() => setSidebarOpen(false)}>
            <i className="bi bi-x-lg" />
          </button>
        </div>

        <span className="sidebar-section-label">Main Menu</span>
        <nav>
          {SECTIONS.map(s => {
            const readyCount = orders.filter(o => o.uploadStatus === 'ready').length;
            return (
              <button
                key={s.id}
                id={`nav-${s.id}`}
                className={`sidebar-item${section === s.id ? ' active' : ''}`}
                onClick={() => {
                  setSection(s.id);
                  if (window.innerWidth <= 768) {
                    setSidebarOpen(false);
                  }
                }}
                style={{ display: 'flex', alignItems: 'center', width: '100%' }}
              >
                <i className={`bi ${s.icon}`} />
                <span>{s.label}</span>
                {s.id === 'monitor' && readyCount > 0 && (
                  <span 
                    className="badge" 
                    style={{ 
                      marginLeft: 'auto', 
                      background: '#dc2626', 
                      color: '#fff', 
                      fontSize: '0.7rem', 
                      padding: '2px 6px', 
                      borderRadius: '50%',
                      fontWeight: 'bold',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minWidth: '18px',
                      height: '18px'
                    }}
                  >
                    {readyCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div style={{ marginTop: 'auto', padding: '1rem 1.25rem', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div className="avatar" style={{ background: 'var(--accent)' }}>A</div>
            <div>
              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#fff' }}>Admin</div>
              <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,0.45)' }}>admin@theprink.com</div>
            </div>
            <button
              style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.45)' }}
              title="Sign out"
              onClick={() => {
                localStorage.removeItem('admin_token');
                setScreen('login');
              }}
            >
              <i className="bi bi-box-arrow-right" />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main Content Area ── */}
      <div className="flex flex-col w-full h-full" style={{ overflow: 'hidden' }}>
        {/* Mobile Toggle Bar */}
        <div className="admin-mobile-toggle-bar">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <img src={whiteLogo} alt="the Prink Logo" style={{ height: '20px', width: 'auto' }} />
            <span style={{ fontWeight: 'bold', fontSize: '13px' }}>Admin Dashboard</span>
          </div>
          <button className="admin-mobile-toggle-btn" onClick={() => setSidebarOpen(true)}>
            <i className="bi bi-list" style={{ marginRight: '4px' }} />
            Menu
          </button>
        </div>

        <section className="portal-content" style={{ flex: 1, overflowY: 'auto' }}>
        {editingOrder ? (
          <div style={{ margin: '-2rem', height: 'calc(100vh - 72px)' }}>
            <AdminEditor order={editingOrder} onBack={() => { setEditingOrder(null); fetchOrders(); }} />
          </div>
        ) : (
          <>
        {/* ── OVERVIEW ── */}
        {section === 'overview' && (
          <div>
            <div className="section-header">
              <div>
                <h1 className="page-heading">Dashboard Overview</h1>
                <p className="text-sm text-muted">Today — {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
              </div>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                {renderNotificationBell()}
                <button className="btn btn-outline btn-sm" onClick={() => {
                  localStorage.removeItem('admin_token');
                  setScreen('login');
                }}>
                  <i className="bi bi-box-arrow-right" /> Sign Out
                </button>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="quick-actions-row mb-4">
              <button id="qa-sync"    className="quick-action-btn" onClick={syncShopify}>
                <i className="bi bi-arrow-repeat" /> Sync Shopify Orders
              </button>
              <button id="qa-upscale" className="quick-action-btn" onClick={runUpscaler} disabled={upscalerRunning}>
                <i className={`bi bi-stars${upscalerRunning ? ' spin' : ''}`} />
                {upscalerRunning ? 'Upscaling…' : 'Upscale Low-DPI'}
              </button>
              <button id="qa-pdf"     className="quick-action-btn" onClick={genAllPDFs}>
                <i className="bi bi-file-earmark-pdf" /> Generate All PDFs
              </button>
              <button id="qa-export"  className="quick-action-btn" onClick={exportReport}>
                <i className="bi bi-download" /> Export Report
              </button>
            </div>

            {/* KPI Grid */}
            <div className="kpi-grid mb-6">
              <div className="kpi-card">
                <div className="kpi-card-icon"><i className="bi bi-cart-check" /></div>
                <div className="kpi-card-label">Total Purchases</div>
                <div className="kpi-card-value">
                  {loadingData ? (
                    <i className="bi bi-arrow-clockwise animate-spin text-muted" style={{ display: 'inline-block', fontSize: '1.2rem' }} />
                  ) : (
                    orderStats.total || orders.length
                  )}
                </div>
                <div className="kpi-card-sub">Active Shopify Sync</div>
              </div>
              <div className="kpi-card accent">
                <div className="kpi-card-icon"><i className="bi bi-palette" /></div>
                <div className="kpi-card-label">Pending Customization</div>
                <div className="kpi-card-value">
                  {loadingData ? (
                    <i className="bi bi-arrow-clockwise animate-spin text-muted" style={{ display: 'inline-block', fontSize: '1.2rem' }} />
                  ) : (
                    orderStats.pending
                  )}
                </div>
                <div className="kpi-card-sub">Customer editing drafts</div>
              </div>
              <div className="kpi-card success">
                <div className="kpi-card-icon"><i className="bi bi-check-circle" /></div>
                <div className="kpi-card-label">Print Ready (Approved)</div>
                <div className="kpi-card-value">
                  {loadingData ? (
                    <i className="bi bi-arrow-clockwise animate-spin text-muted" style={{ display: 'inline-block', fontSize: '1.2rem' }} />
                  ) : (
                    orderStats.ready
                  )}
                </div>
                <div className="kpi-card-sub">Verified high-DPI graphics</div>
              </div>
              <div className="kpi-card" style={{ borderLeft: '4px solid var(--error)' }}>
                <div className="kpi-card-icon"><i className="bi bi-exclamation-triangle" style={{ color: 'var(--error)' }} /></div>
                <div className="kpi-card-label">Revision Requested</div>
                <div className="kpi-card-value">
                  {loadingData ? (
                    <i className="bi bi-arrow-clockwise animate-spin text-muted" style={{ display: 'inline-block', fontSize: '1.2rem' }} />
                  ) : (
                    orderStats.revision
                  )}
                </div>
                <div className="kpi-card-sub">Requires client revision</div>
              </div>
            </div>

            {/* Two-column grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: '1.5rem', alignItems: 'start' }}>
              {/* Recent Orders */}
              <div className="card p-6">
                <div className="flex justify-between align-center mb-4">
                  <h3 style={{ fontWeight: 700, color: 'var(--primary)', fontSize: '1rem' }}>Recent Orders</h3>
                  <button className="btn btn-outline btn-sm" onClick={() => setSection('orders')}>View All</button>
                </div>
                <div className="clean-table-wrapper">
                  <table className="clean-table">
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Customer</th>
                        <th>Product</th>
                        <th>DPI</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingData && (
                        <tr>
                          <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                            <i className="bi bi-arrow-clockwise animate-spin" style={{ display: 'inline-block', marginRight: '6px' }} />
                            Loading orders...
                          </td>
                        </tr>
                      )}
                      {!loadingData && orders.length === 0 && (
                        <tr>
                          <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                            No orders found.
                          </td>
                        </tr>
                      )}
                      {!loadingData && orders.slice(0, 4).map(o => (
                        <tr key={o.id}>
                          <td>
                            <a 
                              href="#" 
                              onClick={(e) => { e.preventDefault(); setEditingOrder(o); }}
                              style={{ fontWeight: 600, color: '#4f46e5', textDecoration: 'underline' }}
                              title="Click to open design editor"
                            >
                              {o.id}
                            </a>
                          </td>
                          <td>
                            <div>
                              {(() => {
                                const custVal = o.customer as any;
                                return (custVal && typeof custVal === 'object')
                                  ? `${custVal.name || custVal.firstName || ''} ${custVal.lastName || ''}`.trim()
                                  : String(custVal || 'Guest');
                              })()}
                            </div>
                            {o.images && o.images.length > 0 && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.15rem' }}>
                                <a 
                                  href="#" 
                                  onClick={(e) => { e.preventDefault(); setActivePhotosModalOrder(o); }}
                                  style={{ fontSize: '0.75rem', color: '#4f46e5', fontWeight: 600, textDecoration: 'underline', display: 'flex', alignItems: 'center', gap: '0.2rem' }}
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
                                          download={img.name || `photo_${idx + 1}.jpg`}
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
                          </td>
                          <td style={{ maxWidth: 160 }}><span style={{ fontSize: '0.8rem' }}>{o.product}</span></td>
                          <td>{dpiStatusBadge(o.dpiStatus, o.dpi)}</td>
                          <td>{uploadStatusBadge(o.uploadStatus)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Activity Log */}
              <div className="card p-6">
                <h3 style={{ fontWeight: 700, color: 'var(--primary)', fontSize: '1rem', marginBottom: '1rem' }}>
                  Activity Log
                </h3>
                <ul className="activity-list">
                  {ACTIVITY_LOG.map(a => (
                    <li key={a.id} className="activity-item">
                      <span className={`activity-dot ${activityDotColor(a.type)}`} />
                      <div className="activity-content">
                        <span className="activity-action">{a.action}</span>
                        <span className="activity-meta">{a.user} · {a.timestamp}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* ── ORDERS ── */}
        {section === 'orders' && (
          <div>
            <div className="section-header">
              <div>
                <h1 className="page-heading">Orders</h1>
                <p className="text-sm text-muted">Manage and track all print orders</p>
              </div>
              {renderNotificationBell()}
            </div>

            {/* Tab bar */}
            <div className="tab-bar mb-4">
              {([
                { key: 'all',               label: 'All',                count: tabCounts.all || orders.length },
                { key: 'ready',             label: '✅ Ready (Uploaded)',count: tabCounts.ready || 0 },
                { key: 'pending',           label: '⏳ Pending Upload',  count: tabCounts.pending || 0 },
                { key: 'approved',          label: '👍 Approved',        count: tabCounts.approved || approvedCount },
                { key: 'sent_to_printer',   label: '🖨️ Printing',        count: tabCounts.sent_to_printer || (sentToPrinterCount + processingCount) },
                { key: 'completed',         label: '🎉 Completed',       count: tabCounts.completed || completedCount },
              ] as const).map(t => (
                <button
                  key={t.key}
                  id={`order-tab-${t.key}`}
                  className={`tab-item${orderTab === t.key ? ' active' : ''}`}
                  onClick={() => setOrderTab(t.key)}
                >
                  {t.label}
                  <span className="tab-count">{t.count}</span>
                </button>
              ))}
            </div>

            {/* Search */}
            <div style={{ marginBottom: '1.25rem' }}>
              <div style={{ position: 'relative', maxWidth: 340 }}>
                <i className="bi bi-search" style={{ position: 'absolute', left: '0.875rem', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                <input
                  id="order-search"
                  className="input"
                  type="search"
                  placeholder="Search orders, customers…"
                  value={orderSearch}
                  onChange={e => setOrderSearch(e.target.value)}
                  style={{ paddingLeft: '2.5rem' }}
                />
              </div>
            </div>

            {/* Orders Table */}
            <div className="clean-table-wrapper">
              <table className="clean-table">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Customer</th>
                    <th>Phone</th>
                    <th>Product</th>
                    <th>DPI Status</th>
                    <th>Upload Status</th>
                    <th>Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingData ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: '#9ca3af' }}>
                        <i className="bi bi-arrow-clockwise animate-spin" style={{ display: 'inline-block', marginRight: '6px' }} />
                        Loading orders...
                      </td>
                    </tr>
                  ) : filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: '#9ca3af' }}>
                        No orders found
                      </td>
                    </tr>
                  ) : paginatedOrders.map(o => (
                    <tr key={o.id}>
                      <td>
                        <a 
                          href="#" 
                          onClick={(e) => { e.preventDefault(); setEditingOrder(o); }}
                          style={{ fontWeight: 700, color: '#4f46e5', textDecoration: 'underline' }}
                          title="Click to open design editor"
                        >
                          {o.id}
                        </a>
                      </td>
                      <td>

                        {renderCustomerDetails(o)}
                        
                        {o.templateSide === 'BLUE' && (
                          o.linkedOrderId ? (() => {
                            const redOrder = orders.find(ro => ro.id === o.linkedOrderId);
                            if (!redOrder) return null;
                            return (
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
                            );
                          })() : (
                            <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px dashed #e5e7eb', color: '#dc2626', fontSize: '0.75rem', fontWeight: 600 }}>
                              <i className="bi bi-hourglass-split" /> Waiting for Second Customer... (Red Side Empty)
                            </div>
                          )
                        )}

                      </td>
                      <td className="text-sm text-muted">{o.phone}</td>
                      <td className="text-sm">{o.product}</td>
                      <td>{dpiStatusBadge(o.dpiStatus, o.dpi)}</td>
                      <td>{workflowStatusBadge(o.workflowStatus, o.uploadStatus)}</td>
                      <td className="text-sm text-muted">
                        {(o.uploadedAt || o.designLockedAt || o.updatedAt || o.createdAt) ? new Date((o.uploadedAt || o.designLockedAt || o.updatedAt || o.createdAt) as string).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : (o.date || '-')}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => setEditingOrder(o)}
                            title="Open design editor for this order"
                          >
                            <i className="bi bi-palette" /> Edit Design
                          </button>
                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => document.getElementById(`admin-upload-input-${o.id}`)?.click()}
                            title="Upload photos directly to this order"
                          >
                            <i className="bi bi-upload" /> Upload
                          </button>
                          <input
                            type="file"
                            id={`admin-upload-input-${o.id}`}
                            style={{ display: 'none' }}
                            multiple
                            accept="image/*"
                            onChange={(e) => handleAdminDirectUpload(e, o.id)}
                          />

                          <button
                            className="btn btn-outline btn-sm"
                            onClick={() => {
                              if (!o.images || o.images.length === 0) {
                                showToast('No customer uploads available to download.', 'info');
                                return;
                              }
                              o.images.forEach((img: any, idx: number) => {
                                let url = img.src || img.url || '';
                                if (url && !url.startsWith('/') && !url.startsWith('http') && !url.startsWith('data:') && !url.startsWith('blob:')) {
                                  url = '/' + url;
                                }
                                const link = document.createElement('a');
                                link.href = url;
                                link.download = img.name || `photo_${idx + 1}.jpg`;
                                link.target = '_blank';
                                link.click();
                              });
                            }}
                            title="Download all customer uploads"
                            style={{ opacity: (!o.images || o.images.length === 0) ? 0.5 : 1 }}
                          >
                            <i className="bi bi-download" /> Download
                          </button>

                          {/* Review button: show when photos uploaded and not yet approved */}
                          {(o.workflowStatus === 'photo_uploaded' || (o.customizationStatus === 'completed' && o.uploadStatus !== 'ready' && !o.workflowStatus)) && (
                            <button
                              className="btn btn-primary btn-sm"
                              style={{ background: 'var(--accent)', borderColor: 'var(--accent)' }}
                              onClick={() => setReviewingOrder(o)}
                            >
                              <i className="bi bi-shield-check" /> Review Photos
                            </button>
                          )}
                          {/* Re-review button for rejected orders */}
                          {(o.workflowStatus === 'rejected' || o.adminApprovalStatus === 'rejected') && (
                            <button
                              className="btn btn-primary btn-sm"
                              style={{ background: '#dc2626', borderColor: '#dc2626' }}
                              onClick={() => setReviewingOrder(o)}
                            >
                              <i className="bi bi-arrow-repeat" /> Re-Review
                            </button>
                          )}
                          {/* Route to printer: show when approved */}
                          {(o.workflowStatus === 'approved' || (o.uploadStatus === 'ready' && !o.workflowStatus)) ? (
                            <button
                              id={`route-${o.id}`}
                              className="btn btn-primary btn-sm"
                              onClick={() => routeToPrinter(o)}
                            >
                              <i className="bi bi-printer" /> Send to Printer
                            </button>
                          ) : (o.workflowStatus === 'sent_to_printer' || o.workflowStatus === 'printer_processing') ? (
                            <span className="badge badge-primary" style={{ fontSize: 11 }}>
                              <i className="bi bi-printer" /> {o.workflowStatus === 'sent_to_printer' ? 'At Printer' : 'Printing...'}
                            </span>
                          ) : o.workflowStatus === 'completed' ? (
                            <span className="badge badge-success" style={{ fontSize: 11 }}>
                              <i className="bi bi-check" /> Completed
                            </span>
                          ) : (
                            <>
                              <button
                                id={`wa-${o.id}`}
                                className="btn btn-outline btn-sm"
                                onClick={() => sendWhatsApp(o.id, typeof o.customer === 'object' ? (o.customer as any)?.name : o.customer)}
                                title="Send WhatsApp reminder"
                              >
                                <i className="bi bi-whatsapp" /> Alert
                              </button>
                              {o.dpiStatus === 'low' && (
                                <button
                                  id={`force-${o.id}`}
                                  className="btn btn-sm"
                                  style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fbbf24' }}
                                  onClick={() => forceApprove(o.id)}
                                >
                                  <i className="bi bi-check2-circle" /> Force Approve
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <span className="text-xs text-muted">
                  Showing {startIndex + 1} to {Math.min(startIndex + itemsPerPage, filteredOrders.length)} of {orderStats.total || filteredOrders.length} entries
                </span>
                <div style={{ display: 'flex', gap: '0.25rem', alignItems: 'center' }}>
                  <button 
                    className="btn btn-outline btn-sm" 
                    onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))} 
                    disabled={currentPage === 1}
                    style={{ opacity: currentPage === 1 ? 0.5 : 1, padding: '6px 12px' }}
                  >
                    <i className="bi bi-chevron-left" /> Previous
                  </button>
                  {[...Array(totalPages)].map((_, i) => {
                    const pageNum = i + 1;
                    if (pageNum === 1 || pageNum === totalPages || Math.abs(pageNum - currentPage) <= 1) {
                      return (
                        <button
                          key={pageNum}
                          className={`btn btn-sm ${currentPage === pageNum ? 'btn-primary' : 'btn-outline'}`}
                          onClick={() => setCurrentPage(pageNum)}
                          style={{ padding: '6px 12px', minWidth: '36px' }}
                        >
                          {pageNum}
                        </button>
                      );
                    }
                    if (pageNum === 2 || pageNum === totalPages - 1) {
                      return <span key={pageNum} className="text-muted" style={{ padding: '0 4px' }}>...</span>;
                    }
                    return null;
                  })}
                  <button 
                    className="btn btn-outline btn-sm" 
                    onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))} 
                    disabled={currentPage === totalPages}
                    style={{ opacity: currentPage === totalPages ? 0.5 : 1, padding: '6px 12px' }}
                  >
                    Next <i className="bi bi-chevron-right" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── UPLOAD MONITOR ── */}
        {section === 'monitor' && (
          <div>
            <div className="section-header">
              <div>
                <h1 className="page-heading">Upload Monitor</h1>
                <p className="text-sm text-muted">Track and manage customer file uploads</p>
              </div>
              {renderNotificationBell()}
            </div>

            {/* Stats row — computed from real live customization tracker */}
            <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
              {[
                { label: 'Total Orders', value: `${orders.length} orders`, icon: 'bi-box-seam', cls: '' },
                { label: 'Ready (Customization Received)', value: `${orders.filter(hasCustomizationBeenReceived).length} orders`, icon: 'bi-check-circle-fill', cls: ' success' },
                { label: 'Pending (Customization Needed)', value: `${orders.filter(o => !hasCustomizationBeenReceived(o)).length} orders`, icon: 'bi-hourglass-split', cls: ' accent' },
              ].map(s => (
                <div key={s.label} className={`metric-card${s.cls}`} style={{ flex: '1 1 160px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div className="text-xs text-muted" style={{ marginBottom: '0.25rem' }}>{s.label}</div>
                      <div style={{ fontWeight: 700, fontSize: '1.25rem', color: 'var(--primary)' }}>{s.value}</div>
                    </div>
                    <i className={`bi ${s.icon}`} style={{ fontSize: '1.5rem', color: 'var(--primary)', opacity: 0.35 }} />
                  </div>
                </div>
              ))}
            </div>

            {/* Filter Tabs: Ready | Pending */}
            <div className="tab-bar mb-4">
              {[
                { key: 'all', label: 'All Orders', count: orders.length },
                { key: 'ready', label: '✅ Ready', count: orders.filter(hasCustomizationBeenReceived).length },
                { key: 'pending', label: '⏳ Pending', count: orders.filter(o => !hasCustomizationBeenReceived(o)).length }
              ].map(t => (
                <button
                  key={t.key}
                  className={`tab-item${monitorTab === t.key ? ' active' : ''}`}
                  onClick={() => setMonitorTab(t.key as any)}
                >
                  {t.label}
                  <span className="tab-count">{t.count}</span>
                </button>
              ))}
            </div>

            {/* Order Upload Cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {(() => {
                const monitorOrders = orders.filter(o => {
                  const isReady = hasCustomizationBeenReceived(o);
                  if (monitorTab === 'ready') return isReady;
                  if (monitorTab === 'pending') return !isReady;
                  return true;
                });

                if (monitorOrders.length === 0) {
                  return (
                    <div className="card p-8 text-center text-muted" style={{ padding: '3rem 2rem', textAlign: 'center', color: '#94a3b8', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                      <i className="bi bi-cloud-arrow-up" style={{ fontSize: '2.5rem', display: 'block', marginBottom: '0.75rem', opacity: 0.4 }} />
                      <div style={{ fontWeight: 600, fontSize: '1.1rem', color: 'var(--primary)', marginBottom: '0.25rem' }}>No Orders in {monitorTab.toUpperCase()} Category</div>
                      <p className="text-sm text-muted" style={{ margin: 0 }}>No orders currently match the selected filter category.</p>
                    </div>
                  );
                }
                return monitorOrders.map(o => (
                  <div key={o.id} className="card p-4" style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
                    <div className="avatar" style={{ width: 44, height: 44, fontSize: '1rem', flexShrink: 0 }}>{(typeof o.customer === 'object' ? (o.customer as any)?.name : o.customer || 'Guest')[0]}</div>
                    <div style={{ flex: 1, minWidth: 160 }}>
                      <div style={{ fontWeight: 600, color: 'var(--primary)', marginBottom: 2 }}>{typeof o.customer === 'object' ? (o.customer as any)?.name : o.customer || 'Guest'}</div>
                      <div className="text-sm text-muted">{o.product}</div>
                      <div className="text-xs text-muted">{o.phone}</div>
                      {o.images && o.images.length > 0 && (
                        <div style={{ marginTop: '0.25rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
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
                                    key={img.id || idx}
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
                                    download={img.name || `photo_${idx + 1}.jpg`}
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
                    <div style={{ minWidth: 100 }}>
                      <span className={`status-chip ${hasCustomizationBeenReceived(o) ? 'print-ready' : 'pending'}`}>
                        {hasCustomizationBeenReceived(o) ? 'Ready' : 'Pending'}
                      </span>
                    </div>
                    <div style={{ minWidth: 80 }}>
                      {dpiStatusBadge(o.dpiStatus, o.dpi)}
                    </div>
                    <div className="text-sm text-muted" style={{ minWidth: 90 }}>
                      {(o.uploadedAt || o.designLockedAt || o.updatedAt || o.createdAt) ? new Date((o.uploadedAt || o.designLockedAt || o.updatedAt || o.createdAt) as string).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : (o.date || '-')}
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      {(o.uploadStatus === 'ready' || (o.images && o.images.length > 0)) && (
                        <button
                          className="btn btn-primary btn-sm"
                          style={{ background: '#171C62', borderColor: '#171C62' }}
                          onClick={() => setEditingOrder(o)}
                        >
                          <i className="bi bi-palette" /> Edit Design
                        </button>
                      )}
                      {o.uploadStatus !== 'ready' && (
                        <button
                          id={`upload-link-${o.id}`}
                          className="btn btn-primary btn-sm"
                          onClick={() => sendWhatsApp(o.id, typeof o.customer === 'object' ? (o.customer as any)?.name : o.customer)}
                        >
                          <i className="bi bi-whatsapp" /> Send Upload Link
                        </button>
                      )}
                      {o.dpiStatus === 'low' && (
                        <button
                          id={`upscale-${o.id}`}
                          className="btn btn-outline btn-sm"
                          onClick={runUpscaler}
                        >
                          <i className="bi bi-stars" /> Upscale
                        </button>
                      )}
                      {o.uploadStatus === 'ready' && (
                        <button
                          id={`print-monitor-${o.id}`}
                          className="btn btn-primary btn-sm"
                          onClick={() => routeToPrinter(o)}
                        >
                          <i className="bi bi-printer" /> Print
                        </button>
                      )}
                    </div>
                  </div>
                ));
              })()}
            </div>
          </div>
        )}

        {/* ── TEMPLATES ── */}
        {section === 'templates' && (
          <div>
            <div className="section-header">
              <div>
                <h1 className="page-heading">Templates</h1>
                <p className="text-sm text-muted">Manage print-ready design templates</p>
              </div>
              <button id="add-template-btn" className="btn btn-primary" onClick={() => {
                setEditingTemplate({
                  name: '',
                  productType: 'mug',
                  category: 'Mugs',
                  thumbnail: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=200',
                  tags: ['new']
                });
                setShowTemplateModal(true);
              }}>
                <i className="bi bi-plus-lg" /> Add New Template
              </button>
            </div>

            {/* Search */}
            <div style={{ marginBottom: '1.5rem', maxWidth: 320 }}>
              <div style={{ position: 'relative' }}>
                <i className="bi bi-search" style={{ position: 'absolute', left: '0.875rem', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                <input
                  id="template-search"
                  className="input"
                  type="search"
                  placeholder="Search templates…"
                  value={templateSearch}
                  onChange={e => setTemplateSearch(e.target.value)}
                  style={{ paddingLeft: '2.5rem' }}
                />
              </div>
            </div>

            <div className="template-grid">
              {(dbTemplates.length > 0 ? dbTemplates : TEMPLATES).filter(t => t.name.toLowerCase().includes(templateSearch.toLowerCase())).map(t => (
                <div
                  key={t.id}
                  className="template-card"
                  onMouseEnter={() => setHoveredTemplate(t.id)}
                  onMouseLeave={() => setHoveredTemplate(null)}
                >
                  <div className="template-card-preview">
                    <img src={t.thumbnail} alt={t.name} />
                    {hoveredTemplate === t.id && (
                      <div style={{
                        position: 'absolute', inset: 0, background: 'rgba(23,28,98,0.7)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem',
                        borderRadius: '12px 12px 0 0', transition: 'all 0.2s'
                      }}>
                            <button
                          id={`edit-tmpl-${t.id}`}
                          className="btn btn-sm"
                          style={{ background: '#fff', color: 'var(--primary)', padding: '0.25rem 0.5rem', fontSize: '11px' }}
                          onClick={() => {
                            setEditingTemplate(t);
                            setShowTemplateModal(true);
                          }}
                        >
                          <i className="bi bi-pencil" /> Edit
                        </button>
                        <button
                          className="btn btn-sm"
                          style={{ background: '#fff', color: 'var(--accent)', border: 'none', padding: '0.25rem 0.5rem', fontSize: '11px' }}
                          onClick={() => duplicateTemplate(t)}
                        >
                          <i className="bi bi-files" /> Duplicate
                        </button>
                        <button
                          className="btn btn-sm"
                          style={{ background: 'var(--error)', color: '#fff', border: 'none', padding: '0.25rem 0.5rem', fontSize: '11px' }}
                          onClick={() => deleteTemplate(t.id)}
                        >
                          <i className="bi bi-trash" /> Delete
                        </button>

                      </div>
                    )}
                    {t.tags && t.tags.length > 0 && (
                      <div style={{ position: 'absolute', top: '0.5rem', left: '0.5rem', display: 'flex', gap: '0.3rem' }}>
                        {t.tags.map(tag => (
                          <span key={tag} style={{
                            background: tag === 'popular' ? 'var(--accent)' : tag === 'new' ? '#10b981' : '#f59e0b',
                            color: '#fff', fontSize: '0.65rem', fontWeight: 700,
                            padding: '0.2rem 0.5rem', borderRadius: '10px', textTransform: 'uppercase'
                          }}>{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="template-card-body">
                    <div className="template-card-name">{t.name}</div>
                    <div className="template-card-meta">
                      <span className="template-card-tag">{t.productType}</span>
                      <span className="text-xs text-muted">{t.usageCount || 0} uses</span>
                    </div>
                    <div className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>Modified {t.lastModified || 'Just now'}</div>
                  </div>
                </div>
              ))}

              {/* Add New Card */}
              <div
                id="add-new-template-card"
                className="add-new-card"
                onClick={() => {
                  setEditingTemplate({
                    name: '',
                    productType: 'mug',
                    category: 'Mugs',
                    thumbnail: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?q=80&w=200',
                    tags: ['new']
                  });
                  setShowTemplateModal(true);
                }}
              >
                <i className="bi bi-plus-circle" style={{ fontSize: '2rem', marginBottom: '0.5rem' }} />
                <span>Add New Template</span>
              </div>
            </div>
          </div>
        )}

        {/* ── SKU MAPPINGS ── */}
        {section === 'sku-mappings' && (
          <AdminSKUManager skuMappings={skuMappings} refreshMappings={fetchSkuMappings} showToast={showToast} />
        )}

        {/* ── PRINT QUEUE ── */}
        {/* 🔥 CUSTOMERS 🔥 */}
        {section === 'customers' && (
          <div>
            <div className="section-header">
              <div>
                <h2>Customers</h2>
                <p>Manage and view all customers synced from Shopify</p>
              </div>
            </div>
            
            <div className="controls-bar">
              <div className="search-wrapper">
                <i className="bi bi-search"></i>
                <input
                  className="input"
                  type="search"
                  placeholder="Search customers by name, email..."
                  value={customerSearch}
                  onChange={e => setCustomerSearch(e.target.value)}
                />
              </div>
            </div>

            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Customer Name</th>
                    <th>Email</th>
                    <th>Phone</th>
                    <th>Orders</th>
                    <th>Total Spent</th>
                    <th>Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {customers
                    .filter(c => 
                      customerSearch.trim() === '' || 
                      (c.firstName + ' ' + c.lastName).toLowerCase().includes(customerSearch.toLowerCase()) || 
                      (c.email || '').toLowerCase().includes(customerSearch.toLowerCase())
                    )
                    .map(c => (
                      <tr key={c.shopifyCustomerId || c._id}>
                        <td>
                          <div className="flex items-center gap-3">
                            <div className="avatar" style={{ width: 44, height: 44, fontSize: '1rem', flexShrink: 0, backgroundColor: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', color: '#64748b' }}>
                              {((c.firstName?.[0] || '') + (c.lastName?.[0] || '')) || 'C'}
                            </div>
                            <div style={{ fontWeight: 600, color: 'var(--primary)' }}>
                              {c.firstName} {c.lastName}
                            </div>
                          </div>
                        </td>
                        <td>{c.email || 'N/A'}</td>
                        <td>{c.phone || 'N/A'}</td>
                        <td>{c.ordersCount || 0}</td>
                        <td>₹{c.totalSpent || '0.00'}</td>
                        <td>{new Date(c.createdAt).toLocaleDateString()}</td>
                      </tr>
                    ))}
                  {customers.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '2rem' }}>No customers found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {section === 'users' && <AdminUserManager />}

        {/* u{2022}u{2022}u{2022} PRINT QUEUE u{2022}u{2022}u{2022} */}
        {section === 'queue' && (
          <div>
            <div className="section-header">
              <div>
                <h1 className="page-heading">Print Queue</h1>
                <p className="text-sm text-muted">Monitor and manage active print jobs</p>
              </div>
              <button className="btn btn-primary btn-sm" onClick={() => { fetchQueue(); showToast('Queue refreshed', 'info'); }}>
                <i className="bi bi-arrow-repeat" /> Refresh
              </button>
            </div>

            {/* Tab bar */}
            <div className="tab-bar mb-4">
              {([
                { key: 'all',          label: 'All Jobs',     count: printQueue.length },
                { key: 'pending',      label: '⏳ Pending',     count: printQueue.filter(q => q.status === 'pending').length },
                { key: 'print-ready',  label: '📋 Print Ready', count: printQueue.filter(q => q.status === 'print-ready' || (q.status as string) === 'ready').length },
                { key: 'printing',     label: '🖨️ Printing',   count: printQueue.filter(q => q.status === 'printing' || (q.status as string) === 'processing').length },
                { key: 'completed',    label: '🎉 Completed',  count: printQueue.filter(q => q.status === 'completed').length },
              ] as const).map(t => (
                <button
                  key={t.key}
                  id={`queue-tab-${t.key}`}
                  className={`tab-item${queueTab === t.key ? ' active' : ''}`}
                  onClick={() => setQueueTab(t.key)}
                >
                  {t.label}
                  <span className="tab-count">{t.count}</span>
                </button>
              ))}
            </div>

            <div className="clean-table-wrapper">
              <table className="clean-table">
                <thead>
                  <tr>
                    <th>Order ID</th>
                    <th>Customer</th>
                    <th>Product</th>
                    <th>Trim Size</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Assigned At</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredQueue.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ textAlign: 'center', padding: '2rem', color: '#9ca3af' }}>
                        No jobs in this category
                      </td>
                    </tr>
                  ) : filteredQueue.map(q => (
                    <tr key={q.id}>
                      <td><span style={{ fontWeight: 700, color: 'var(--primary)' }}>{q.id}</span></td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <div className="avatar" style={{ width: 28, height: 28, fontSize: '0.7rem', flexShrink: 0 }}>{q.customer[0]}</div>
                          {typeof q.customer === 'object' ? (q.customer as any)?.name : q.customer}
                        </div>
                      </td>
                      <td className="text-sm">{q.product}</td>
                      <td className="text-sm text-muted">{q.trimSize}</td>
                      <td><PriorityBadge priority={q.priority} /></td>
                      <td><StatusChip status={q.status} /></td>
                      <td className="text-sm text-muted">{q.assignedAt}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.4rem' }}>
                          <button
                            id={`dl-pdf-${q.id}`}
                            className="btn btn-outline btn-sm"
                            onClick={() => showToast(`Downloading PDF for ${q.id}…`, 'info')}
                          >
                            <i className="bi bi-file-earmark-pdf" /> PDF
                          </button>
                          {q.status === 'print-ready' && (
                            <button
                              id={`complete-${q.id}`}
                              className="btn btn-primary btn-sm"
                              onClick={() => markComplete(q.id)}
                            >
                              <i className="bi bi-check2-all" /> Complete
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── REPORTS ── */}
        {section === 'reports' && (() => {
          const total = orders.length;
          const readyCount   = orders.filter(o => o.uploadStatus === 'ready').length;
          const awaitCount   = orders.filter(o => o.uploadStatus === 'awaiting').length;
          const pendingCount = orders.filter(o => o.uploadStatus === 'pending').length;
          const productCounts: Record<string, number> = {};
          orders.forEach(o => { const t = o.productType || 'other'; productCounts[t] = (productCounts[t] || 0) + 1; });
          const productBars = Object.entries(productCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([label, count], i) => ({
              label: label.charAt(0).toUpperCase() + label.slice(1),
              pct: total > 0 ? Math.round((count / total) * 100) : 0,
              color: ['var(--primary)', '#3b82f6', '#10b981', '#f59e0b', 'var(--accent)'][i % 5],
            }));
          const statusBars = [
            { label: 'Print Ready',     count: readyCount,   color: '#10b981' },
            { label: 'Awaiting Upload', count: awaitCount,   color: '#f59e0b' },
            { label: 'Pending',         count: pendingCount, color: 'var(--accent)' },
          ].map(b => ({ ...b, pct: total > 0 ? Math.round((b.count / total) * 100) : 0 }));
          return (
            <div>
              <div className="section-header">
                <div>
                  <h1 className="page-heading">Reports &amp; Analytics</h1>
                  <p className="text-sm text-muted">
                    As of {new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </p>
                </div>
                <button className="btn btn-outline btn-sm" onClick={exportReport}>
                  <i className="bi bi-download" /> Export CSV
                </button>
              </div>

              {/* Stats row — real data */}
              <div className="kpi-grid mb-6" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                <div className="kpi-card">
                  <div className="kpi-card-icon"><i className="bi bi-cart-check" /></div>
                  <div className="kpi-card-label">Total Orders</div>
                  <div className="kpi-card-value">{total}</div>
                  <div className="kpi-card-sub">From Shopify sync</div>
                </div>
                <div className="kpi-card success">
                  <div className="kpi-card-icon"><i className="bi bi-check-circle" /></div>
                  <div className="kpi-card-label">Print Ready</div>
                  <div className="kpi-card-value">{readyCount}</div>
                  <div className="kpi-card-sub">Approved &amp; ready to print</div>
                </div>
                <div className="kpi-card">
                  <div className="kpi-card-icon"><i className="bi bi-hourglass-split" /></div>
                  <div className="kpi-card-label">Awaiting Upload</div>
                  <div className="kpi-card-value">{awaitCount + pendingCount}</div>
                  <div className="kpi-card-sub">Customers yet to upload</div>
                </div>
              </div>

              {/* Analytics Grid */}
              <div className="analytics-grid mb-6">
                {/* Orders by Product Type */}
                <div className="chart-card">
                  <h3 style={{ fontWeight: 700, color: 'var(--primary)', marginBottom: '1.25rem', fontSize: '0.95rem' }}>
                    Orders by Product Type
                  </h3>
                  {total === 0 ? (
                    <p className="text-sm text-muted" style={{ padding: '1rem 0' }}>No orders yet.</p>
                  ) : productBars.map(b => (
                    <div key={b.label} className="chart-bar-row">
                      <span className="chart-bar-label">{b.label}</span>
                      <div className="chart-bar-track">
                        <div className="chart-bar-fill" style={{ width: `${b.pct}%`, background: b.color }} />
                      </div>
                      <span className="chart-bar-value">{b.pct}%</span>
                    </div>
                  ))}
                </div>

                {/* Upload Status Breakdown */}
                <div className="chart-card">
                  <h3 style={{ fontWeight: 700, color: 'var(--primary)', marginBottom: '1.25rem', fontSize: '0.95rem' }}>
                    Upload Status Breakdown
                  </h3>
                  {total === 0 ? (
                    <p className="text-sm text-muted" style={{ padding: '1rem 0' }}>No orders yet.</p>
                  ) : statusBars.map(b => (
                    <div key={b.label} className="chart-bar-row">
                      <span className="chart-bar-label">{b.label}</span>
                      <div className="chart-bar-track">
                        <div className="chart-bar-fill" style={{ width: `${b.pct}%`, background: b.color }} />
                      </div>
                      <span className="chart-bar-value">{b.pct}%</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Order volume placeholder */}
              <div className="chart-card" style={{ padding: '1.75rem' }}>
                <h3 style={{ fontWeight: 700, color: 'var(--primary)', fontSize: '0.95rem', marginBottom: '0.5rem' }}>Monthly Order Volume</h3>
                <p className="text-sm text-muted" style={{ textAlign: 'center', padding: '2rem 0' }}>
                  {total === 0 ? 'No order data yet. Orders will appear here once synced from Shopify.' : `${total} total orders tracked.`}
                </p>
              </div>
            </div>
          );
        })()}

        {/* ── SETTINGS ── */}
        {section === 'settings' && (
          <div>
            <div className="section-header">
              <div>
                <h1 className="page-heading">Settings</h1>
                <p className="text-sm text-muted">Configure integrations and system preferences</p>
              </div>
            </div>

            {/* Block 1: Shopify Integration */}
            <div className="settings-section mb-6">
              <div className="settings-section-header">
                <i className="bi bi-bag-check" />
                <span>Shopify Integration</span>
              </div>
              <div className="settings-section-body">
                <div className="settings-row">
                  <div className="settings-row-info">
                    <label className="label" htmlFor="shopify-url">Shopify Store URL</label>
                    <p className="text-xs text-muted">Your myshopify.com domain</p>
                  </div>
                  <input
                    id="shopify-url"
                    className="input"
                    style={{ maxWidth: 280 }}
                    value={shopifyStore}
                    onChange={e => setShopifyStore(e.target.value)}
                    placeholder="e.g. prink-in.myshopify.com"
                  />
                </div>
                <div className="settings-row">
                  <div className="settings-row-info">
                    <label className="label" htmlFor="shopify-api">API Access Token</label>
                    <p className="text-xs text-muted">Admin API Access Token (shpat_...)</p>
                  </div>
                  <input
                    id="shopify-api"
                    className="input"
                    type="password"
                    style={{ maxWidth: 280 }}
                    value={shopifyAccessToken}
                    onChange={e => setShopifyAccessToken(e.target.value)}
                    placeholder="shpat_••••••••"
                  />
                </div>
                {connectionStatus && (
                  <div style={{
                    marginBottom: '1rem',
                    padding: '0.75rem',
                    borderRadius: '6px',
                    backgroundColor: connectionStatus.success ? '#ecfdf5' : '#fef2f2',
                    border: `1px solid ${connectionStatus.success ? '#10b981' : '#ef4444'}`,
                    color: connectionStatus.success ? '#065f46' : '#991b1b',
                    fontSize: '0.85rem'
                  }}>
                    <div style={{ fontWeight: '600', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <i className={`bi ${connectionStatus.success ? 'bi-check-circle-fill' : 'bi-x-circle-fill'}`} />
                      {connectionStatus.message}
                    </div>
                    {connectionStatus.success && connectionStatus.scopes && (
                      <div style={{ marginTop: '0.25rem', fontSize: '0.75rem', opacity: 0.9 }}>
                        <strong>Authorized Scopes:</strong> {connectionStatus.scopes.join(', ')}
                      </div>
                    )}
                  </div>
                )}
                <div style={{ paddingTop: '0.5rem', display: 'flex', gap: '0.75rem' }}>
                  <button 
                    id="sync-shopify-btn" 
                    className="btn btn-primary" 
                    onClick={syncShopify}
                    disabled={isSyncingShopify}
                  >
                    <i className={`bi ${isSyncingShopify ? 'bi-arrow-repeat spin' : 'bi-arrow-repeat'}`} /> 
                    {isSyncingShopify ? ' Syncing...' : ' Sync Now'}
                  </button>
                  <button 
                    id="test-shopify-btn" 
                    className="btn btn-secondary" 
                    onClick={testShopifyConnection}
                    disabled={isTestingConnection}
                  >
                    {isTestingConnection ? 'Testing...' : 'Test Connection'}
                  </button>
                </div>
              </div>
            </div>

            {/* Block 2: Notifications */}
            <div className="settings-section mb-6">
              <div className="settings-section-header">
                <i className="bi bi-bell" />
                <span>Notifications</span>
              </div>
              <div className="settings-section-body">
                {([
                  { key: 'whatsapp',     label: 'WhatsApp Upload Reminders', desc: 'Send reminders when customers haven\'t uploaded' },
                  { key: 'email',        label: 'Email Order Confirmations',  desc: 'Send order confirmation emails automatically' },
                  { key: 'lowDpi',       label: 'Low DPI Alerts',            desc: 'Alert when image resolution is below threshold' },
                  { key: 'dailySummary', label: 'Daily Summary Report',      desc: 'Receive daily digest at 8:00 AM' },
                ] as const).map(t => (
                  <div key={t.key} className="settings-row">
                    <div className="settings-row-info">
                      <span className="font-semibold text-sm">{t.label}</span>
                      <p className="text-xs text-muted">{t.desc}</p>
                    </div>
                    <label className="toggle-switch">
                      <input
                        id={`toggle-${t.key}`}
                        type="checkbox"
                        checked={toggles[t.key]}
                        onChange={() => setToggles(p => ({ ...p, [t.key]: !p[t.key] }))}
                      />
                      <span className="toggle-slider" />
                    </label>
                  </div>
                ))}
              </div>
            </div>

            {/* Block 3: System */}
            <div className="settings-section mb-6">
              <div className="settings-section-header">
                <i className="bi bi-gear" />
                <span>System</span>
              </div>
              <div className="settings-section-body">
                <div className="settings-row">
                  <div className="settings-row-info">
                    <label className="label" htmlFor="dpi-threshold">Default DPI Threshold</label>
                    <p className="text-xs text-muted">Minimum acceptable DPI for print quality</p>
                  </div>
                  <input
                    id="dpi-threshold"
                    className="input"
                    type="number"
                    min={72}
                    max={1200}
                    value={dpiThreshold}
                    onChange={e => setDpiThreshold(+e.target.value)}
                    style={{ maxWidth: 120 }}
                  />
                </div>
                <div className="settings-row">
                  <div className="settings-row-info">
                    <label className="label" htmlFor="max-filesize">Max File Size (MB)</label>
                    <p className="text-xs text-muted">Maximum allowed upload size per file</p>
                  </div>
                  <input
                    id="max-filesize"
                    className="input"
                    type="number"
                    min={1}
                    max={200}
                    value={maxFileMB}
                    onChange={e => setMaxFileMB(+e.target.value)}
                    style={{ maxWidth: 120 }}
                  />
                </div>
                <div className="settings-row">
                  <div className="settings-row-info">
                    <span className="font-semibold text-sm">Auto Upscale Low-DPI</span>
                    <p className="text-xs text-muted">Automatically run AI upscaler on low-resolution images</p>
                  </div>
                  <label className="toggle-switch">
                    <input
                      id="toggle-autoUpscale"
                      type="checkbox"
                      checked={toggles.autoUpscale}
                      onChange={() => setToggles(p => ({ ...p, autoUpscale: !p.autoUpscale }))}
                    />
                    <span className="toggle-slider" />
                  </label>
                </div>
                <div style={{ paddingTop: '0.5rem' }}>
                  <button id="save-settings-btn" className="btn btn-primary" onClick={saveSettings}>
                    <i className="bi bi-floppy2" /> Save Settings
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        </>
      )}
      </section>

      {/* =======================================================================
          DESIGN REVIEW MODAL
          ======================================================================= */}
      {reviewingOrder ? (
        <AdminDesignEditor
          order={reviewingOrder}
          linkedOrder={reviewingOrder.linkedOrderId ? orders.find(o => o.id === reviewingOrder.linkedOrderId) : undefined}
          onClose={() => setReviewingOrder(null)}
          onApprove={() => handleReviewDecision('approve')}
          onReject={() => handleReviewDecision('reject')}
          onRequestReupload={() => handleReviewDecision('request_reupload')}
          onCommentsChange={(txt) => setReviewComments(txt)}
          commentsValue={reviewComments}
          onSaveProgress={async (elements) => {
            try {
              const token = localStorage.getItem('admin_token');
              const res = await fetch(`/api/orders/${encodeURIComponent(reviewingOrder.id || reviewingOrder._id || reviewingOrder.orderNumber || "")}/design`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                  designData: JSON.stringify(elements),
                  customizationStatus: reviewingOrder.customizationStatus
                })
              });
              if (res.ok) {
                showToast('Progress saved successfully!', 'success');
                fetchOrders();
              } else {
                showToast('Failed to save progress.', 'error');
              }
            } catch (err) {
              showToast('Network error while saving.', 'error');
            }
          }}
        />
      ) : (
        <>
        {/* =======================================================================
            SKU RULES CONFIGURATION MODAL
            ======================================================================= */}
        {showSkuModal && editingMapping && (
          <div className="modal-overlay" onClick={() => setShowSkuModal(false)}>
            <div className="modal-container" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}>
              <div className="flex align-center justify-between" style={{ marginBottom: '1.25rem' }}>
                <h2 className="font-bold" style={{ color: 'var(--primary)', margin: 0, fontSize: '1.1rem' }}>
                  {editingMapping.id ? 'Edit SKU Rule Mapping' : 'Define New SKU Mapping'}
                </h2>
                <button className="btn btn-outline btn-sm" onClick={() => setShowSkuModal(false)}>
                  <i className="bi bi-x-lg" />
                </button>
              </div>

              <div className="flex flex-col gap-4">
                <div>
                  <label className="label text-xs font-semibold" htmlFor="mapping-sku" style={{ marginBottom: '0.2rem' }}>
                    Shopify SKU Prefix / Match Code:
                  </label>
                  <input
                    id="mapping-sku"
                    className="input text-xs"
                    type="text"
                    placeholder="E.g. PRK-MUG-CLASSIC"
                    value={editingMapping.sku || ''}
                    onChange={e => setEditingMapping({ ...editingMapping, sku: e.target.value })}
                  />
                </div>

                <div>
                  <label className="label text-xs font-semibold" htmlFor="mapping-product" style={{ marginBottom: '0.2rem' }}>
                    Mapped Product Canvas Type:
                  </label>
                  <select
                    id="mapping-product"
                    className="input text-xs"
                    value={editingMapping.productType || 'mug'}
                    onChange={e => setEditingMapping({ ...editingMapping, productType: e.target.value as any })}
                  >
                    <option value="mug">Coffee Mug Wrap</option>
                    <option value="canvas">Stretch Canvas</option>
                    <option value="frame">Photo Frame</option>
                    <option value="calendar">Wall Calendar</option>
                  </select>
                </div>

                <div>
                  <label className="label text-xs font-semibold" htmlFor="mapping-template" style={{ marginBottom: '0.2rem' }}>
                    Associated Canva Design Template:
                  </label>
                  <select
                    id="mapping-template"
                    className="input text-xs"
                    value={editingMapping.templateId || ''}
                    onChange={e => setEditingMapping({ ...editingMapping, templateId: e.target.value })}
                  >
                    <option value="">None (Generic Blank Layout)</option>
                    {(dbTemplates.length > 0 ? dbTemplates : TEMPLATES).map(t => (
                      <option key={t.id} value={t.id}>{t.name} ({t.productType})</option>
                    ))}
                  </select>
                </div>

                <div className="flex gap-2 justify-end" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                  <button className="btn btn-secondary" onClick={() => setShowSkuModal(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={saveSkuMapping}>
                    Save Mapping Rule
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* =======================================================================
            TEMPLATES BUILDER CONFIGURATION MODAL
            ======================================================================= */}
        {showTemplateModal && editingTemplate && (
          <div className="modal-overlay" onClick={() => setShowTemplateModal(false)}>
            <div className="modal-container" onClick={e => e.stopPropagation()} style={{ maxWidth: 460 }}>
              <div className="flex align-center justify-between" style={{ marginBottom: '1.25rem' }}>
                <h2 className="font-bold" style={{ color: 'var(--primary)', margin: 0, fontSize: '1.1rem' }}>
                  {editingTemplate.id ? 'Edit Template Builder' : 'Create Canva Print Template'}
                </h2>
                <button className="btn btn-outline btn-sm" onClick={() => setShowTemplateModal(false)}>
                  <i className="bi bi-x-lg" />
                </button>
              </div>

              <div className="flex flex-col gap-4">
                <div>
                  <label className="label text-xs font-semibold" htmlFor="tmpl-name" style={{ marginBottom: '0.2rem' }}>
                    Template Display Name:
                  </label>
                  <input
                    id="tmpl-name"
                    className="input text-xs"
                    type="text"
                    placeholder="E.g. Father's Day Mug Wrap"
                    value={editingTemplate.name || ''}
                    onChange={e => setEditingTemplate({ ...editingTemplate, name: e.target.value })}
                  />
                </div>

                <div>
                  <label className="label text-xs font-semibold" htmlFor="tmpl-product" style={{ marginBottom: '0.2rem' }}>
                    Target Product Canvas Type:
                  </label>
                  <select
                    id="tmpl-product"
                    className="input text-xs"
                    value={editingTemplate.productType || 'mug'}
                    onChange={e => setEditingTemplate({ ...editingTemplate, productType: e.target.value as any })}
                  >
                    <option value="mug">Coffee Mug Wrap</option>
                    <option value="canvas">Stretch Canvas</option>
                    <option value="frame">Photo Frame</option>
                    <option value="calendar">Wall Calendar</option>
                  </select>
                </div>

                <div>
                  <label className="label text-xs font-semibold" htmlFor="tmpl-category" style={{ marginBottom: '0.2rem' }}>
                    Template Category:
                  </label>
                  <select
                    id="tmpl-category"
                    className="input text-xs"
                    value={editingTemplate.category || 'mug'}
                    onChange={e => setEditingTemplate({ ...editingTemplate, category: e.target.value })}
                  >
                    <option value="mug">Mug</option>
                    <option value="frame">Frame</option>
                    <option value="tshirt">T-shirt</option>
                    <option value="album">Album</option>
                    <option value="case">Mobile case</option>
                    <option value="poster">Poster</option>
                    <option value="gift">Gift products</option>
                  </select>
                </div>

                <div style={{ margin: '0.5rem 0' }}>
                  <label className="text-xs flex align-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!editingTemplate.isDefault}
                      onChange={e => setEditingTemplate({ ...editingTemplate, isDefault: e.target.checked })}
                    />
                    <span>Set as default layout for this product canvas type</span>
                  </label>
                </div>

                <div>
                  <label className="label text-xs font-semibold" htmlFor="tmpl-thumb" style={{ marginBottom: '0.2rem' }}>
                    Thumbnail Image URL:
                  </label>
                  <input
                    id="tmpl-thumb"
                    className="input text-xs"
                    type="text"
                    placeholder="https://images.unsplash.com/..."
                    value={editingTemplate.thumbnail || ''}
                    onChange={e => setEditingTemplate({ ...editingTemplate, thumbnail: e.target.value })}
                  />
                </div>


                <div className="flex gap-2 justify-end" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                  <button className="btn btn-secondary" onClick={() => setShowTemplateModal(false)}>Cancel</button>
                  <button className="btn btn-primary" onClick={saveTemplate}>
                    Save Template
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {/* Customer Uploaded Photos Pop-up Modal */}
        {activePhotosModalOrder && (
          <div className="modal-overlay" onClick={() => setActivePhotosModalOrder(null)}>
            <div className="modal-container" onClick={e => e.stopPropagation()} style={{ maxWidth: 900, width: '90vw' }}>
              <div className="flex align-center justify-between" style={{ marginBottom: '1.25rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
                <div>
                  <h2 className="font-bold" style={{ color: 'var(--primary)', margin: 0, fontSize: '1.25rem' }}>
                    Order Details & Uploads: #{activePhotosModalOrder.id}
                  </h2>
                  <p className="text-xs text-muted" style={{ margin: '0.2rem 0 0 0' }}>
                    Created on {activePhotosModalOrder.date || 'unknown'} · Shopify ID: {activePhotosModalOrder.shopifyId}
                  </p>
                </div>
                <button className="btn btn-outline btn-sm" onClick={() => setActivePhotosModalOrder(null)}>
                  <i className="bi bi-x-lg" />
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', maxHeight: '60vh', overflowY: 'auto', padding: '0.5rem 0' }}>
                {/* Left Side: Metadata info */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  {/* Customer Information */}
                  <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                    <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Customer Info</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.85rem' }}>
                      <div><strong>Name:</strong> {typeof activePhotosModalOrder.customer === 'object' ? activePhotosModalOrder.customer?.name : activePhotosModalOrder.customer}</div>
                      <div><strong>Phone:</strong> {activePhotosModalOrder.phone || 'N/A'}</div>
                      <div><strong>Email:</strong> {activePhotosModalOrder.email || 'N/A'}</div>
                      {activePhotosModalOrder.shippingAddress && (
                        <div style={{ marginTop: '0.25rem' }}>
                          <strong>Shipping Address:</strong><br />
                          {activePhotosModalOrder.shippingAddress.address1}, {activePhotosModalOrder.shippingAddress.city}, {activePhotosModalOrder.shippingAddress.state}, {activePhotosModalOrder.shippingAddress.country} - {activePhotosModalOrder.shippingAddress.postalCode}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Product details */}
                  <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                    <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Product SKU Mapping</h3>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.85rem' }}>
                      <div><strong>Item:</strong> {activePhotosModalOrder.product}</div>
                      <div><strong>SKU:</strong> <span style={{ fontFamily: 'monospace', padding: '2px 6px', background: '#e2e8f0', borderRadius: '4px' }}>{activePhotosModalOrder.sku}</span></div>
                      <div><strong>Quantity:</strong> {activePhotosModalOrder.quantity || 1} units</div>
                      {activePhotosModalOrder.skuDetails && (
                        <div style={{ marginTop: '0.25rem', display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                          <span className="badge badge-primary" style={{ fontSize: '0.7rem' }}>Limit: {activePhotosModalOrder.skuDetails.supportedImageCount} uploads</span>
                          <span className="badge badge-outline" style={{ fontSize: '0.7rem' }}>Formats: {activePhotosModalOrder.skuDetails.supportedFileTypes?.join(', ')}</span>
                          <span className="badge badge-outline" style={{ fontSize: '0.7rem' }}>Max size: {activePhotosModalOrder.skuDetails.maximumFileSize}MB</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Customer Notes */}
                  <div style={{ background: '#fffbeb', padding: '1rem', borderRadius: '12px', border: '1px solid #fef3c7' }}>
                    <h3 style={{ margin: '0 0 0.5rem 0', fontSize: '0.9rem', fontWeight: 700, color: '#b45309', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Special Instructions</h3>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: '#78350f', fontStyle: 'italic', lineHeight: 1.4 }}>
                      {activePhotosModalOrder.customerNotes || "No custom notes submitted with this order."}
                    </p>
                  </div>
                </div>

                {/* Right Side: Photo previews and download */}
                <div>
                  <h3 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Uploaded Assets ({activePhotosModalOrder.images?.length || 0})
                  </h3>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {activePhotosModalOrder.images && activePhotosModalOrder.images.length > 0 ? (
                      activePhotosModalOrder.images.map((img: any, idx: number) => {
                        let url = img.src || img.url || '';
                        if (url && !url.startsWith('/') && !url.startsWith('http') && !url.startsWith('data:') && !url.startsWith('blob:')) {
                          url = '/' + url;
                        }
                        
                        return (
                          <div key={img.id || idx} style={{ border: '1px solid var(--border-color)', borderRadius: '12px', padding: '0.75rem', background: 'white', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                            {/* Comparison: Original vs Edited */}
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                              {/* Original */}
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                                <span style={{ fontSize: '0.6rem', color: '#94a3b8', fontWeight: 'bold' }}>ORIGINAL</span>
                                <div style={{ width: '70px', height: '70px', borderRadius: '6px', overflow: 'hidden', border: '1px solid #e2e8f0' }}>
                                  <img 
                                    src={url} 
                                    alt="Original" 
                                    style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                                  />
                                </div>
                              </div>
                              
                              {/* Edited Preview */}
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                                <span style={{ fontSize: '0.6rem', color: '#4f46e5', fontWeight: 'bold' }}>CUSTOMER EDIT</span>
                                <div style={{ width: '70px', height: '70px', borderRadius: '6px', overflow: 'hidden', border: '1px solid #e2e8f0', background: '#000' }}>
                                  <img 
                                    src={url} 
                                    alt="Edited" 
                                    style={{ 
                                      width: '100%', 
                                      height: '100%', 
                                      objectFit: 'cover',
                                      filter: `brightness(${img.brightness ?? 100}%) contrast(${img.contrast ?? 100}%)`,
                                      transform: `rotate(${img.rotation ?? 0}deg) scale(${img.zoom ?? 1}) translate(${img.position?.x ?? 0}px, ${img.position?.y ?? 0}px)`
                                    }} 
                                  />
                                </div>
                              </div>
                            </div>

                            {/* Details & Actions */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '0.8rem', fontWeight: 600, color: '#334155', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {img.name || `photo_${idx + 1}.jpg`}
                              </div>
                              <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '2px' }}>
                                Adjustments: B:{img.brightness ?? 100}% · C:{img.contrast ?? 100}% · R:{img.rotation ?? 0}°
                              </div>
                              
                              <div style={{ display: 'flex', gap: '6px', marginTop: '6px' }}>
                                <a 
                                  href={url} 
                                  download={img.name || `original_${idx + 1}.jpg`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="btn btn-outline btn-xs"
                                  style={{ fontSize: '0.65rem', padding: '2px 6px' }}
                                >
                                  <i className="bi bi-download" /> Original
                                </a>
                                <button 
                                  onClick={() => {
                                    // Simulated download of edited preview (rendered as dataUrl or direct image download)
                                    // In a real app we can use a canvas to compile, here we open in new tab with instructions or download URL
                                    const link = document.createElement('a');
                                    link.href = url;
                                    link.target = '_blank';
                                    link.download = `edited_${img.name || `photo_${idx + 1}.jpg`}`;
                                    link.click();
                                  }}
                                  className="btn btn-outline btn-xs"
                                  style={{ fontSize: '0.65rem', padding: '2px 6px', color: '#4f46e5', borderColor: '#818cf8' }}
                                >
                                  <i className="bi bi-magic" /> Edited Preview
                                </button>
                                <button 
                                  onClick={() => handleDeletePhoto(activePhotosModalOrder.id, img.id)}
                                  className="btn btn-outline btn-xs"
                                  style={{ fontSize: '0.65rem', padding: '2px 6px', color: '#dc2626', borderColor: '#f87171' }}
                                >
                                  <i className="bi bi-trash" /> Delete
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8', background: '#f8fafc', borderRadius: '12px', border: '1px dashed #cbd5e1' }}>
                        <i className="bi bi-image" style={{ fontSize: '2rem', display: 'block', marginBottom: '0.5rem', color: '#cbd5e1' }} />
                        No photo assets uploaded for this order.
                      </div>
                    )}

                    {activePhotosModalOrder.customerPreview && (
                      <div style={{ marginTop: '1.25rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
                        <h4 style={{ margin: '0 0 0.75rem 0', fontSize: '0.9rem', fontWeight: 700, color: 'var(--primary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          Customer Mockup Preview (As Submitted)
                        </h4>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', background: '#f8fafc', padding: '1rem', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                          <img 
                            src={activePhotosModalOrder.customerPreview} 
                            alt="Customer Submitted Mockup Preview" 
                            style={{ maxWidth: '100%', maxHeight: '220px', objectFit: 'contain', borderRadius: '8px', border: '1px solid #cbd5e1', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} 
                          />
                          <a 
                            href={activePhotosModalOrder.customerPreview} 
                            download={`customer_mockup_preview_${activePhotosModalOrder.id}.jpg`}
                            className="btn btn-outline btn-xs"
                            style={{ marginTop: '0.5rem', display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#4f46e5', borderColor: '#818cf8' }}
                          >
                            <i className="bi bi-download" /> Download Submitted Mockup
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex gap-2 justify-between" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem', marginTop: '1rem' }}>
                {activePhotosModalOrder.images && activePhotosModalOrder.images.length > 0 ? (
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button 
                      className="btn btn-outline btn-sm"
                      onClick={() => {
                        activePhotosModalOrder.images?.forEach((img: any, idx: number) => {
                          let url = img.src || img.url || '';
                          if (url && !url.startsWith('/') && !url.startsWith('http') && !url.startsWith('data:') && !url.startsWith('blob:')) {
                            url = '/' + url;
                          }
                          const link = document.createElement('a');
                          link.href = url;
                          link.download = img.name || `photo_${idx + 1}.jpg`;
                          link.target = '_blank';
                          setTimeout(() => link.click(), idx * 200);
                        });
                      }}
                    >
                      <i className="bi bi-cloud-arrow-down" style={{ marginRight: '0.25rem' }} /> Download All Images
                    </button>
                    <button 
                      className="btn btn-outline btn-sm"
                      onClick={() => handleDeleteAllPhotos(activePhotosModalOrder.id)}
                      style={{ color: '#dc2626', borderColor: '#f87171' }}
                    >
                      <i className="bi bi-trash" style={{ marginRight: '0.25rem' }} /> Delete All Photos
                    </button>
                  </div>
                ) : <div />}
                
                <div className="flex gap-2">
                  <button className="btn btn-secondary" onClick={() => setActivePhotosModalOrder(null)}>Close</button>
                  {activePhotosModalOrder.images && activePhotosModalOrder.images.length > 0 && (
                    <button 
                      className="btn btn-primary" 
                      onClick={() => {
                        setEditingOrder(activePhotosModalOrder);
                        setActivePhotosModalOrder(null);
                      }}
                      style={{ background: '#171C62', borderColor: '#171C62' }}
                    >
                      <i className="bi bi-palette" style={{ marginRight: '0.25rem' }} /> Open Professional Editor
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        </>
      )}
      </div>
    </div>
  );
};
export default AdminPortal;



