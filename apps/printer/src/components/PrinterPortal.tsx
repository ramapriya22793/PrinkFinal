import React, { useEffect, useState, useRef, useCallback } from 'react';
import type { PrinterQueueItem, PrintStatus } from '../types';
import { customerName } from '../types';
import { useToast } from '../context/ToastContext';
import mainLogo from '../assets/logos/main-logo.png';
import websiteLogo from '../assets/logos/website-logo.png';

interface PrinterPortalProps {
  extraItems?: PrinterQueueItem[];
}

type StatusFilter = 'all' | PrintStatus;

const STATUS_META: Record<PrintStatus, { label: string; icon: string }> = {
  'pending':     { label: 'Pending',     icon: 'bi-clock' },
  'processing':  { label: 'Printing',    icon: 'bi-printer' },
  'print-ready': { label: 'Print Ready', icon: 'bi-check-circle' },
  'completed':   { label: 'Completed',   icon: 'bi-bag-check' },
};

const PRIORITY_ORDER: Record<string, number> = { high: 0, normal: 1, low: 2 };

export default function PrinterPortal({ extraItems = [] }: PrinterPortalProps) {
  const { showToast } = useToast();

  // Auth State
  const [screen, setScreen] = useState<'login' | 'dashboard'>(() => {
    return localStorage.getItem('printer_token') ? 'dashboard' : 'login';
  });
  const [email, setEmail]         = useState('');
  const [password, setPassword]   = useState('');
  const [loginErr, setLoginErr]   = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [isRegister, setIsRegister] = useState(false);
  const [regName, setRegName] = useState('');
  const [regPhone, setRegPhone] = useState('');

  // Queue State
  const [queue, setQueue] = useState<PrinterQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedOrder, setExpandedOrder] = useState<any | null>(null);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [batchDownloading, setBatchDownloading] = useState(false);

  const emailRef = useRef<HTMLInputElement>(null);
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Focus email on login screen active
  useEffect(() => {
    if (screen === 'login') emailRef.current?.focus();
  }, [screen]);

  const isFetchingQueue = useRef(false);

  // Load printer queue from backend
  const fetchQueue = async () => {
    const token = localStorage.getItem('printer_token');
    if (!token) {
      setScreen('login');
      setLoading(false);
      return;
    }
    if (isFetchingQueue.current) return;
    isFetchingQueue.current = true;
    try {
      const res = await fetch('/api/printer/queue', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        // Handle both direct array and object formats ({ success: true, queue: [...] })
        const list = Array.isArray(data) ? data : (data.queue || []);
        setQueue(list);
      } else if (res.status === 401 || res.status === 403) {
        localStorage.removeItem('printer_token');
        setScreen('login');
        showToast('Session expired. Please log in again.', 'error');
      }
    } catch (err) {
      console.error('Failed to fetch printer queue:', err);
    } finally {
      isFetchingQueue.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    if (screen === 'dashboard') {
      fetchQueue();
      // Set up a 10-second polling interval for real-time tracking updates
      const interval = setInterval(fetchQueue, 10000);
      return () => clearInterval(interval);
    }
  }, [screen]);

  // Sync incoming admin routed items to queue database (simulate server side addition)
  useEffect(() => {
    if (screen !== 'dashboard' || extraItems.length === 0) return;
    setQueue(prev => {
      const ids = new Set(prev.map(i => i.id));
      const toAdd = extraItems.filter(i => !ids.has(i.id));
      return toAdd.length ? [...prev, ...toAdd] : prev;
    });
  }, [extraItems, screen]);
  const toggleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedOrder(null);
      return;
    }
    setExpandedId(id);
    setExpandedOrder(null); // Clear previous
    try {
      const res = await fetch(`/api/printer/queue/${id}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('printer_token')}` }
      });
      if (res.ok) {
        const data = await res.json();
        setExpandedOrder(data.order);
      } else {
        showToast('Failed to fetch order details.', 'error');
      }
    } catch (err) {
      showToast('Network error fetching order details.', 'error');
    }
  };

  // Authenticate Printer
  const handleRegister = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!regName.trim() || !email.trim() || !password.trim()) { setLoginErr('Please enter name, email and password.'); return; }
    setLoginErr('');
    setLoggingIn(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: regName, email, phone: regPhone, password, role: 'printer' }),
      });
      const data = await res.json();
      setLoggingIn(false);
      if (res.ok && data.success) {
        localStorage.setItem('printer_token', data.token);
        setScreen('dashboard');
        showToast('Account created! Welcome, Printer!', 'success');
      } else {
        setLoginErr(data.error || 'Registration failed.');
      }
    } catch (err) {
      setLoggingIn(false);
      setLoginErr('Unable to reach server. Please try again.');
    }
  };

  const handleLogin = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!email.trim() || !password.trim()) { setLoginErr('Please enter email and password.'); return; }
    setLoginErr('');
    setLoggingIn(true);
    try {
      const res = await fetch('/api/auth/printer-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      setLoggingIn(false);
      if (res.ok && data.success) {
        localStorage.setItem('printer_token', data.token);
        setScreen('dashboard');
        showToast('Press terminal activated!', 'success');
      } else {
        setLoginErr(data.error || 'Invalid credentials.');
      }
    } catch (err) {
      setLoggingIn(false);
      setLoginErr('Unable to connect to server.');
    }
  };

  // Sign out Printer
  const handleLogout = () => {
    localStorage.removeItem('printer_token');
    setScreen('login');
    setEmail('');
    setPassword('');
    showToast('Terminal session closed.', 'info');
  };

  const filteredQueue = queue
    .filter(item => filter === 'all' || item.status === filter)
    .filter(item => {
      const q = searchQuery.toLowerCase().trim();
      if (!q) return true;
      return (
        item.id.toLowerCase().includes(q) ||
        customerName(item.customer).toLowerCase().includes(q) ||
        (item.product && item.product.toLowerCase().includes(q)) ||
        ((item as any).sku && (item as any).sku.toLowerCase().includes(q)) ||
        (item.status && item.status.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);

  const countByStatus = (s: PrintStatus) => queue.filter(i => i.status === s).length;

  const toggleSelectOrder = (id: string) => {
    setSelectedOrderIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  const toggleSelectAll = () => {
    if (selectedOrderIds.length === filteredQueue.length && filteredQueue.length > 0) {
      setSelectedOrderIds([]);
    } else {
      setSelectedOrderIds(filteredQueue.map(item => item.id));
    }
  };

  const handleBatchDownload = async () => {
    if (selectedOrderIds.length === 0) {
      showToast('Please select at least one order to batch download.', 'error');
      return;
    }
    setBatchDownloading(true);
    showToast(`Compiling ZIP archive for ${selectedOrderIds.length} orders...`, 'info');
    try {
      const res = await fetch('/api/printer/batch-download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('printer_token') || localStorage.getItem('admin_token')}`
        },
        body: JSON.stringify({ orderIds: selectedOrderIds })
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({ error: 'Batch download failed' }));
        throw new Error(errJson.error || 'Batch download failed');
      }

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Batch_Print_Orders_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);

      showToast(`Successfully downloaded ZIP archive for ${selectedOrderIds.length} orders!`, 'success');
      setSelectedOrderIds([]);
      fetchQueue();
    } catch (err: any) {
      showToast(err.message || 'Failed to download batch ZIP.', 'error');
    } finally {
      setBatchDownloading(false);
    }
  };

  const downloadPDF = async (id: string, customer: string) => {
    showToast(`Compiling print-ready PDF for ${id}…`, 'info');
    // Open tab immediately to bypass popup blocker
    const newTab = window.open('about:blank', '_blank');
    if (!newTab) {
      showToast('Popup blocked! Please allow popups for this site.', 'error');
      return;
    }
    newTab.document.write('Loading PDF...');
    try {
      const res = await fetch(`/api/printer/download/${encodeURIComponent(id)}`, {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('printer_token')}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        newTab.location.href = data.url;
        showToast(`Downloaded: ${data.filename}`, 'success');
        // Downloading the file means printing has started, not that the
        // job is finished. Marking it complete here would both misreport
        // progress and be rejected as a stage skip by the backend.
        updateJobStatus(id, 'processing');
      } else {
        newTab.close();
        const errData = await res.json().catch(() => ({}));
        showToast(errData.error || `Compiling failed (Status: ${res.status}).`, 'error');
      }
    } catch (e: any) {
      newTab.close();
      showToast(`Network error: ${e.message}`, 'error');
    }
  };


  const updateJobStatus = async (id: string, newStatus: PrintStatus) => {
    // Map 'completed' to the new 'done' keyword so the backend sets workflowStatus=completed
    const backendStatus = newStatus === 'completed' ? 'done' : newStatus;
    try {
      const res = await fetch(`/api/printer/queue/${encodeURIComponent(id)}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('printer_token')}`
        },
        body: JSON.stringify({ status: backendStatus })
      });
      if (res.ok) {
        setQueue(prev => prev.map(i => i.id === id ? { ...i, status: newStatus } : i));
        showToast(`Order ${id} status updated to ${newStatus}.`, 'success');
      } else {
        showToast('Failed to update status.', 'error');
      }
    } catch (err) {
      showToast('Error syncing status update.', 'error');
    }
  };

  const batchDownload = () => {
    const ready = queue.filter(i => i.status === 'print-ready');
    if (!ready.length) { showToast('No print-ready jobs in queue.', 'warning'); return; }
    showToast(`Assembling ${ready.length} PDF files into ZIP…`, 'info');
    setTimeout(() => showToast(`Batch of ${ready.length} vector files ready for download.`, 'success'), 1500);
  };

  const tabs: { id: StatusFilter; label: string; count?: number }[] = [
    { id: 'all',         label: 'All Jobs',        count: queue.length            },
    { id: 'pending',     label: 'Pending',         count: countByStatus('pending')     },
    { id: 'print-ready', label: 'Print Ready',     count: countByStatus('print-ready') },
    { id: 'processing',  label: 'Printing',        count: countByStatus('processing')  },
    { id: 'completed',   label: 'Completed',       count: countByStatus('completed')   },
  ];

  // ── RENDER LOGIN VIEW ──
  if (screen === 'login') {
    return (
      <div className="admin-split-layout">
        {/* Left – Credentials Form */}
        <div className="admin-split-left">
          <div className="admin-login-form-wrap">
            <div className="admin-login-logo" style={{ marginBottom: '20px' }}>
              <img src={mainLogo} alt="the Prink Logo" style={{ height: '48px', width: 'auto', display: 'block' }} />
            </div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--primary)', marginBottom: '0.25rem' }}>
              Printer Terminal
            </h2>
            <p style={{ color: '#6b7280', marginBottom: '2rem', fontSize: '0.875rem' }}>
              Access local queue &amp; download vector files
            </p>
            <form onSubmit={isRegister ? handleRegister : handleLogin} autoComplete="off">
                {isRegister && (
                  <>
                    <div className="input-group" style={{ marginBottom: '1rem' }}>
                      <label className="label" htmlFor="printer-name">Operator Name</label>
                      <input
                        id="printer-name"
                        className="input"
                        type="text"
                        placeholder="Operator Name"
                        value={regName}
                        onChange={e => setRegName(e.target.value)}
                      />
                    </div>
                    <div className="input-group" style={{ marginBottom: '1rem' }}>
                      <label className="label" htmlFor="printer-phone">Phone Number</label>
                      <input
                        id="printer-phone"
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
                <label className="label" htmlFor="printer-email">Operator Email</label>
                <input
                  id="printer-email"
                  ref={emailRef}
                  className="input"
                  type="email"
                  placeholder="printer@theprink.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLogin()}
                  autoComplete="new-password"
                />
              </div>
              <div className="input-group" style={{ marginBottom: '1.5rem' }}>
                <label className="label" htmlFor="printer-password">Terminal Password</label>
                <input
                  id="printer-password"
                  className="input"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleLogin()}
                  autoComplete="new-password"
                />
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
                type="submit"
                  className="btn btn-primary"
                  style={{ width: '100%', justifyContent: 'center', padding: '0.75rem 1rem' }}
                  onClick={isRegister ? handleRegister : handleLogin}
                  disabled={loggingIn}
                >
                  {loggingIn ? <span className="spinner" style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 1s linear infinite' }} /> : <><i className="bi bi-printer" /> {isRegister ? 'Register' : 'Activate Terminal'}</>}
                </button>
              </form>
              {/* Printer accounts are provisioned by an administrator - there
                  is deliberately no self-signup, since anyone able to create
                  their own printer account could read every approved design. */}
              <div style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.875rem' }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  Need access? Ask a THE PRINK administrator to create your operator account.
                </span>
              </div>
            {/* Demo credentials text removed */}
            <div style={{ textAlign: 'center', opacity: 0.5 }}>
              <img src={websiteLogo} alt="the Prink Website Logo" style={{ height: '22px', width: 'auto', display: 'inline-block' }} />
            </div>
          </div>
        </div>

        {/* Right Panel */}
        <div className="admin-split-right" style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)' }}>
          <div className="admin-split-right-content">
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.5rem',
              background: 'rgba(255,255,255,0.1)', borderRadius: '20px',
              padding: '0.375rem 0.875rem', marginBottom: '2rem'
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#38bdf8', display: 'inline-block' }} />
              <span style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.9)', fontWeight: 600 }}>Print Station Active</span>
            </div>
            <h2 style={{ fontSize: '2rem', fontWeight: 800, color: '#fff', lineHeight: 1.2, marginBottom: '0.75rem' }}>
              Press Operations Terminal
            </h2>
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.95rem', marginBottom: '2.5rem', lineHeight: 1.6 }}>
              Direct access to print queue jobs, alignment sheets, registration references, and instant print-file downloads.
            </p>
            <ul style={{ listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {[
                { icon: 'bi-file-earmark-pdf',     text: 'Download vector print PDF/X-1a formats' },
                { icon: 'bi-sliders',              text: 'Press registration & alignment checks'   },
                { icon: 'bi-arrow-left-right',     text: 'Trim mark & bleed verification overlay' },
                { icon: 'bi-check2-all',           text: 'Real-time status updates sync'          },
              ].map(f => (
                <li key={f.icon} style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                  <span style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: 'rgba(255,255,255,0.1)',
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

  // ── RENDER TERMINAL VIEW ──
  return (
    <div style={{ 
      minHeight: '100vh', 
      background: '#F4F7FE', 
      padding: isMobile ? '16px 12px' : '40px 28px',
      fontFamily: "'Inter', sans-serif" 
    }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        {/* ── Page Header ── */}
        <div className="glass-header flex justify-between align-center section-header mb-8" style={{ flexWrap: 'wrap', gap: 12, alignItems: isMobile ? 'stretch' : 'center', padding: isMobile ? '16px' : '24px 32px', borderRadius: isMobile ? '16px' : '24px', background: '#FFFFFF', boxShadow: '0 4px 12px rgba(0,0,0,0.03)', flexDirection: isMobile ? 'column' : 'row', marginBottom: isMobile ? 16 : 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <img src={mainLogo} alt="the Prink" style={{ height: isMobile ? 34 : 42, width: 'auto', display: 'block' }} />
            <div style={{ borderLeft: '2px solid #E2E8F0', paddingLeft: isMobile ? 14 : 20, minHeight: 40, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <h2 className="page-heading" style={{ fontSize: isMobile ? 17 : 24, fontWeight: 800, color: '#171C62', margin: 0, paddingLeft: 0, borderLeft: 'none', letterSpacing: '0.02em' }}>
                Printer Operator Terminal
              </h2>
              {!isMobile && (
                <p className="text-sm text-muted" style={{ marginTop: 4, marginBottom: 0, color: '#64748b' }}>
                  Manage and download compiled print-ready vector layouts.
                </p>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: isMobile ? 'stretch' : 'flex-end' }}>
            <button className="btn btn-outline btn-sm" style={{ borderColor: '#E2E8F0', color: '#475569', flex: isMobile ? 1 : 'none' }} onClick={fetchQueue}>
              <i className="bi bi-arrow-repeat" /> Refresh
            </button>
            <button className="btn btn-primary btn-sm" style={{ background: '#FF304C', border: 'none', boxShadow: '0 4px 12px rgba(255,48,76,0.2)', flex: isMobile ? 1 : 'none' }} onClick={batchDownload}>
              <i className="bi bi-download" /> Batch Download
            </button>
            <button className="btn btn-outline btn-sm" style={{ padding: '6px 12px', borderColor: '#E2E8F0', color: '#475569', flex: isMobile ? 1 : 'none' }} onClick={handleLogout}>
              <i className="bi bi-box-arrow-right" /> Log Out
            </button>
          </div>
        </div>

        {/* ── KPI Row ── */}
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: isMobile ? 10 : 24, marginBottom: isMobile ? 16 : 32 }}>
          {[
            { label: 'Pending',        value: countByStatus('pending'),            icon: 'bi-clock',          variant: ' accent' },
            { label: 'Print Ready',    value: countByStatus('print-ready'),        icon: 'bi-check-circle',   variant: ' success' },
            { label: 'Printing',       value: countByStatus('processing'),         icon: 'bi-printer',        variant: ' primary' },
            { label: 'Completed',      value: countByStatus('completed'),          icon: 'bi-bag-check',      variant: '' },
          ].map((m, i) => (
            <div key={i} className={`glass-panel metric-card${m.variant}`} style={{ borderRadius: isMobile ? 16 : 24, padding: isMobile ? '16px 14px' : '24px', background: '#FFFFFF', borderColor: '#F1F5F9', color: '#1E293B', boxShadow: '0 4px 12px rgba(0,0,0,0.02)' }}>
              <div className="flex justify-between align-center mb-4">
                <p style={{ fontSize: isMobile ? 9 : 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94A3B8' }}>{m.label}</p>
                <span style={{ width: isMobile ? 28 : 36, height: isMobile ? 28 : 36, background: m.variant.includes('accent') ? '#FFF1F2' : m.variant.includes('success') ? '#ECFDF5' : m.variant.includes('primary') ? '#EFF6FF' : '#F8FAFC', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <i className={`bi ${m.icon}`} style={{ fontSize: isMobile ? 13 : 16, color: m.variant.includes('accent') ? '#FF304C' : m.variant.includes('success') ? '#10b981' : m.variant.includes('primary') ? '#2563eb' : '#64748b' }} />
                </span>
              </div>
              <h3 style={{ fontSize: isMobile ? 28 : 36, fontWeight: 800, color: m.variant.includes('accent') ? '#FF304C' : m.variant.includes('success') ? '#10b981' : m.variant.includes('primary') ? '#2563eb' : '#1E293B', lineHeight: 1, margin: '0' }}>{m.value}</h3>
            </div>
          ))}
        </div>

        {/* ── Print Queue Card ── */}
        <div className="glass-panel card p-8 mb-8" style={{ borderRadius: isMobile ? 20 : 32, background: '#FFFFFF', border: 'none', boxShadow: '0 12px 36px rgba(0,0,0,0.04)', padding: isMobile ? '16px' : '32px', marginBottom: isMobile ? 16 : 32 }}>
        {/* Tab Bar */}
        <div className="tab-bar" style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch', flexWrap: 'nowrap' }}>
          {tabs.map(t => (
            <button key={t.id}
              className={`tab-item${filter === t.id ? ' active' : ''}`}
              onClick={() => setFilter(t.id)}
              style={{ whiteSpace: 'nowrap' }}
            >
              {t.label}
              {t.count !== undefined && (
                <span className="tab-count">{t.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Search Bar & Batch Download Bar */}
        <div style={{ marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <input 
                type="text"
                placeholder="Search by Order ID, Customer, SKU..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input"
                style={{
                  width: '100%',
                  padding: '0.625rem 1rem 0.625rem 2.5rem',
                  fontSize: '0.875rem',
                  borderRadius: '8px',
                  border: '1px solid var(--border-color)',
                  backgroundColor: '#f9fafb'
                }}
              />
              <i className="bi bi-search" style={{ position: 'absolute', left: '1rem', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: '0.9rem' }} />
              {searchQuery && (
                <button 
                  onClick={() => setSearchQuery('')}
                  style={{ position: 'absolute', right: '1rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af' }}
                >
                  <i className="bi bi-x-circle-fill" />
                </button>
              )}
            </div>

            {selectedOrderIds.length > 0 && (
              <button
                onClick={handleBatchDownload}
                disabled={batchDownloading}
                className="btn btn-primary"
                style={{
                  whiteSpace: 'nowrap',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  padding: '0.625rem 1.25rem',
                  borderRadius: '8px',
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  backgroundColor: '#2563eb',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                <i className="bi bi-file-earmark-zip-fill" style={{ fontSize: '1rem' }} />
                {batchDownloading ? 'Compiling ZIP...' : `Batch Download (${selectedOrderIds.length})`}
              </button>
            )}
          </div>

          {filteredQueue.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#f8fafc', padding: '8px 12px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <input
                  type="checkbox"
                  id="select-all-queue"
                  checked={selectedOrderIds.length === filteredQueue.length && filteredQueue.length > 0}
                  onChange={toggleSelectAll}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                <label htmlFor="select-all-queue" style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#334155', cursor: 'pointer', margin: 0 }}>
                  Select All Orders ({selectedOrderIds.length} of {filteredQueue.length} selected)
                </label>
              </div>
              {selectedOrderIds.length > 0 && (
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  Files will be packaged into ZIP format: <code style={{ background: '#e2e8f0', padding: '2px 6px', borderRadius: '4px' }}>OrderNumber_SKU_PhotoNumber.jpg</code>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Queue — Table (desktop) / Cards (mobile) */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '40px 16px', color: '#94a3b8' }}>
            <i className="bi bi-arrow-clockwise animate-spin" style={{ display: 'inline-block', marginRight: '6px', fontSize: 28 }} />
            <span style={{ display: 'block', marginTop: 8 }}>Loading jobs...</span>
          </div>
        ) : filteredQueue.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 16px', color: '#94a3b8' }}>
            <i className="bi bi-inbox" style={{ fontSize: 36, display: 'block', marginBottom: 10, opacity: 0.4 }} />
            No jobs matching this filter.
          </div>
        ) : isMobile ? (
          /* ── MOBILE JOB CARDS ── */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {filteredQueue.map(item => (
              <div key={item.id} style={{ background: '#f8fafc', border: selectedOrderIds.includes(item.id) ? '2px solid #3b82f6' : '1px solid #e2e8f0', borderRadius: 16, overflow: 'hidden' }}>
                {/* Card Header */}
                <div
                  style={{ padding: '14px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}
                  onClick={() => toggleExpand(item.id)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={selectedOrderIds.includes(item.id)}
                      onChange={() => toggleSelectOrder(item.id)}
                      style={{ width: 18, height: 18, cursor: 'pointer' }}
                    />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <span style={{ fontWeight: 700, color: '#3b82f6', fontSize: 13 }}>{item.id}</span>
                      <span className={`status-chip ${item.status}`} style={{ fontSize: 10, padding: '2px 8px' }}>
                        {STATUS_META[item.status]?.label ?? item.status}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: '#475569', fontWeight: 600, marginBottom: 2 }}>{customerName(item.customer)}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.product}</div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                    <span className={`priority-badge ${item.priority}`} style={{ fontSize: 10 }}>{item.priority}</span>
                    <i className={`bi bi-chevron-${expandedId === item.id ? 'up' : 'down'}`} style={{ fontSize: 12, color: '#94a3b8' }} />
                  </div>
                </div>
                {/* Card Actions */}
                <div style={{ padding: '0 16px 14px', display: 'flex', gap: 8, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
                  {item.status !== 'completed' && (
                    <button className="btn btn-primary btn-sm" style={{ flex: 1 }}
                      onClick={() => downloadPDF(item.id, customerName(item.customer))}>
                      <i className="bi bi-printer" /> Print
                    </button>
                  )}
                  {item.status === 'processing' && (
                    <button className="btn btn-secondary btn-sm" style={{ flex: 1 }}
                      onClick={() => updateJobStatus(item.id, 'completed')}>
                      <i className="bi bi-check2-all" /> Done
                    </button>
                  )}
                  {item.status === 'completed' && (
                    <span className="badge badge-success" style={{ fontSize: 11, flex: 1, justifyContent: 'center', display: 'flex', alignItems: 'center' }}>
                      <i className="bi bi-check" /> Completed
                    </span>
                  )}
                </div>
                {/* Expanded Details */}
                {expandedId === item.id && (
                  <div style={{ padding: '14px 16px 16px', borderTop: '1px solid #e2e8f0', background: '#fff' }}>
                    <div style={{ fontSize: 12, display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                      {expandedOrder ? (
                        <>
                          <div><span style={{ color: '#94a3b8', fontWeight: 600 }}>Customer: </span>{customerName(expandedOrder.customer)}</div>
                          <div><span style={{ color: '#94a3b8', fontWeight: 600 }}>Email: </span>{expandedOrder.customer?.email || 'N/A'}</div>
                          <div><span style={{ color: '#94a3b8', fontWeight: 600 }}>Phone: </span>{expandedOrder.customer?.phone || 'N/A'}</div>
                          <div><span style={{ color: '#94a3b8', fontWeight: 600 }}>SKU: </span>{expandedOrder.sku || 'N/A'}</div>
                          <div><span style={{ color: '#94a3b8', fontWeight: 600 }}>Qty: </span>{expandedOrder.quantity}</div>
                          <div><span style={{ color: '#94a3b8', fontWeight: 600 }}>Trim: </span>{item.trimSize} +0.125" bleed</div>
                        </>
                      ) : (
                        <div style={{ color: '#94a3b8' }}>Loading details...</div>
                      )}
                    </div>
                    {item.printFiles && item.printFiles.length > 0 && (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {item.printFiles.map((file, idx) => (
                          <a key={idx} href={file.url} target="_blank" rel="noopener noreferrer"
                            className="btn btn-outline btn-sm" style={{ flex: 1, justifyContent: 'center', gap: 4 }}>
                            <i className="bi bi-printer" style={{ color: '#e11d48' }} />
                            Sheet {idx + 1}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          /* ── DESKTOP TABLE ── */
          <div className="clean-table-wrapper">
            <table className="clean-table" id="printer-queue-tbody">
              <thead>
                <tr>
                  <th style={{ width: 40, textAlign: 'center' }}>
                    <input
                      type="checkbox"
                      checked={selectedOrderIds.length === filteredQueue.length && filteredQueue.length > 0}
                      onChange={toggleSelectAll}
                      style={{ width: 16, height: 16, cursor: 'pointer' }}
                    />
                  </th>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>Product Specs</th>
                  <th>Trim Size</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Assigned</th>
                  <th style={{ textAlign: 'right', paddingRight: '24px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredQueue.map(item => (
                  <React.Fragment key={item.id}>
                    <tr id={`printer-row-${item.id}`} style={{ cursor: 'pointer', backgroundColor: selectedOrderIds.includes(item.id) ? '#f0f9ff' : 'transparent', transition: 'background-color 0.2s' }} onClick={() => toggleExpand(item.id)}>
                      <td style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedOrderIds.includes(item.id)}
                          onChange={() => toggleSelectOrder(item.id)}
                          style={{ width: 16, height: 16, cursor: 'pointer' }}
                        />
                      </td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <i className={`bi bi-chevron-${expandedId === item.id ? 'up' : 'down'}`} style={{ fontSize: '12px', color: '#3b82f6' }} />
                          <span 
                            style={{ fontWeight: 700, color: '#3b82f6', fontSize: 13, textDecoration: 'underline', cursor: 'pointer' }}
                            title="Click to view full order details and download HD sheets"
                          >
                            {item.id}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div style={{ fontWeight: 500, fontSize: 13 }}>
                          {customerName(item.customer)}
                        </div>
                      </td>

                      <td><span className="text-sm text-muted">{item.product}</span></td>
                      <td>
                        <span style={{ fontWeight: 600, fontSize: 12 }}>{item.trimSize}</span>
                        <br />
                        <span className="text-xs text-muted">+0.125" bleed</span>
                      </td>
                      <td>
                        <span className={`priority-badge ${item.priority}`}>
                          {item.priority === 'high' && <i className="bi bi-arrow-up" />}
                          {item.priority}
                        </span>
                      </td>
                      <td>
                        <span className={`status-chip ${item.status}`}>
                          {STATUS_META[item.status]?.label ?? item.status}
                        </span>
                      </td>
                      <td><span className="text-xs text-muted">{item.assignedAt}</span></td>
                      <td style={{ textAlign: 'right', paddingRight: '24px', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'nowrap', alignItems: 'center' }}>
                          {item.status !== 'completed' && (
                            <button className="btn btn-primary btn-sm"
                              onClick={() => downloadPDF(item.id, customerName(item.customer))}>
                              <i className="bi bi-printer" /> Print
                            </button>
                          )}
                          {item.status === 'processing' && (
                            <button className="btn btn-secondary btn-sm"
                              onClick={() => updateJobStatus(item.id, 'completed')}>
                              <i className="bi bi-check2-all" /> Done
                            </button>
                          )}
                          {item.status === 'pending' && (
                            <span style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic' }}>Expand to start processing...</span>
                          )}
                          {item.status === 'completed' && (
                            <span className="badge badge-success" style={{ fontSize: 11 }}>
                              <i className="bi bi-check" /> Completed
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                    {expandedId === item.id && (
                      <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                        <td colSpan={8} style={{ padding: '24px' }}>
                          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
                            <div style={{ flex: '1 1 300px' }}>
                              <h5 style={{ fontWeight: 600, marginBottom: '12px', fontSize: '14px', color: 'var(--primary)' }}>Order & Customer Details</h5>
                              {expandedOrder ? (
                                <div style={{ fontSize: '13px', lineHeight: '1.6' }}>
                                  <p><strong>Customer:</strong> {customerName(expandedOrder.customer)}</p>
                                  <p><strong>Email:</strong> {expandedOrder.customer?.email || 'N/A'}</p>
                                  <p><strong>Phone:</strong> {expandedOrder.customer?.phone || 'N/A'}</p>
                                  <p><strong>Shipping Address:</strong> {expandedOrder.shippingAddress ? `${expandedOrder.shippingAddress.addressLine1}, ${expandedOrder.shippingAddress.city}` : 'N/A'}</p>
                                  <p><strong>Product:</strong> {expandedOrder.product} (SKU: {expandedOrder.sku})</p>
                                  <p><strong>Quantity:</strong> {expandedOrder.quantity}</p>
                                  <p><strong>Date Added:</strong> {new Date(expandedOrder.createdAt).toLocaleString()}</p>
                                </div>
                              ) : (
                                <div className="text-muted" style={{ fontSize: '13px' }}>Loading order details...</div>
                              )}
                            </div>
                            <div style={{ flex: '2 1 400px' }}>
                              <h5 style={{ fontWeight: 600, marginBottom: '12px', fontSize: '14px', color: 'var(--primary)' }}>Print Files</h5>
                              {item.printFiles && item.printFiles.length > 0 ? (
                                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                                  {item.printFiles.map((file, idx) => (
                                    <a 
                                      key={idx} 
                                      href={file.url} 
                                      target="_blank" 
                                      rel="noopener noreferrer" 
                                      className="btn btn-outline btn-sm"
                                      style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 16px', height: 'auto', gap: '4px' }}
                                    >
                                      <i className="bi bi-printer" style={{ fontSize: '24px', color: '#e11d48' }} />
                                      <span>Print Sheet {idx + 1}</span>
                                      <span style={{ fontSize: '10px', color: '#64748b' }}>{file.widthMm}x{file.heightMm}mm</span>
                                    </a>
                                  ))}
                                </div>
                              ) : (
                                <div className="text-muted" style={{ fontSize: '13px' }}>No print files available.</div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
        </div>

        {/* ── Registration calibration preview ── */}
        {!isMobile && (
        <div className="card p-6">
          <div className="flex justify-between align-center mb-4">
            <div>
              <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Registration Mark Preview
              </h4>
              <p className="text-xs text-muted" style={{ marginTop: 2 }}>Alignment reference for press operators</p>
            </div>
            <span className="badge badge-primary"><i className="bi bi-printer" /> Print Calibration</span>
          </div>

          <div style={{
            height: 240,
            background: 'var(--bg-tertiary)',
            borderRadius: 'var(--radius-lg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            border: '1px solid var(--border-color)',
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ position: 'absolute', inset: 0, background: 'var(--gradient-subtle)' }} />
            {/* Print Sheet Mockup */}
            <div style={{ background: 'white', width: 380, height: 175, border: '1px solid #d1d5db', boxShadow: 'var(--shadow-lg)', position: 'relative', borderRadius: 2 }}>
              {/* Bleed border */}
              <div style={{ position: 'absolute', top: -5, left: -5, right: -5, bottom: -5, border: '1.5px dashed var(--accent)', borderRadius: 2, opacity: 0.6 }} />
              {/* Crosshairs */}
              {([[-18,-18], [-18,'calc(100% + 6px)'], ['calc(100% + 6px)',-18], ['calc(100% + 6px)','calc(100% + 6px)']] as [number|string, number|string][]).map((pos, i) => (
                <span key={i} style={{ position: 'absolute', top: pos[0], left: pos[1], fontSize: 13, fontWeight: 900, color: 'var(--primary)', lineHeight: 1 }}>⊕</span>
              ))}
              {/* Calibration + brand colour bars */}
              <div style={{ position: 'absolute', top: 7, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 3 }}>
                {['#00b4d8','#e040fb','#ffd60a','#1a1a1a','#171C62','#FF304C','#0fbe88'].map((c, i) => (
                  <div key={i} style={{ width: 14, height: 14, background: c, borderRadius: 2, boxShadow: '0 1px 3px rgba(0,0,0,0.2)' }} />
                ))}
              </div>
              {/* Job metadata */}
              <span style={{ position: 'absolute', bottom: 5, left: 8, fontFamily: 'monospace', fontSize: 8, color: '#64748b', letterSpacing: '0.04em' }}>
                JOB: {queue[0]?.id ?? '#----'} · the PRINK PRINT ENGINE · v2.1 · RGB/300DPI
              </span>
              {/* Image fill */}
              <div style={{ width: '100%', height: '100%', background: '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 1, borderRadius: 1, overflow: 'hidden' }}>
                {queue[0]?.printFiles?.[0]?.url ? (
                  <iframe 
                    src={`${queue[0].printFiles[0].url}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`}
                    style={{ width: '100%', height: '100%', border: 'none' }} 
                    title="PDF Preview"
                  />
                ) : (
                  <i className="bi bi-card-image" style={{ fontSize: '40px', color: '#94a3b8' }} />
                )}
              </div>
            </div>
          </div>

          {/* Spec Cards */}
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            {[
              { label: 'Color Profile', value: 'sRGB (RGB out)' },
              { label: 'Resolution',    value: '300 DPI min'    },
              { label: 'Bleed',         value: '0.125" all sides'},
              { label: 'Safe Zone',     value: '0.25" from edge' },
              { label: 'File Format',   value: 'PDF/X-1a'       },
              { label: 'Colour Mode',   value: 'ISO Coated v2'  },
            ].map(spec => (
              <div key={spec.label} style={{ flex: '1 1 120px', padding: '10px 12px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                <p className="text-xs text-muted">{spec.label}</p>
                <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--primary)', marginTop: 2 }}>{spec.value}</p>
              </div>
            ))}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}






