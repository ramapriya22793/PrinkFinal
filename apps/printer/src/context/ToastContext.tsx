import React, { createContext, useCallback, useContext, useState } from 'react';
import type { ToastMessage, ToastType } from '../types';

interface ToastContextType {
  showToast: (message: string, type: ToastType) => void;
}

const ToastContext = createContext<ToastContextType>({ showToast: () => {} });
export const useToast = () => useContext(ToastContext);

const TOAST_META: Record<ToastType, { icon: string; bg: string; color: string; border: string }> = {
  success: { icon: 'bi-check-circle-fill', bg: 'rgba(15,190,136,0.1)',    color: '#0fbe88', border: 'rgba(15,190,136,0.25)' },
  error:   { icon: 'bi-x-circle-fill',     bg: 'rgba(255,48,76,0.10)',    color: '#FF304C', border: 'rgba(255,48,76,0.25)'  },
  info:    { icon: 'bi-info-circle-fill',   bg: 'rgba(23,28,98,0.08)',     color: '#171C62', border: 'rgba(23,28,98,0.20)'   },
  warning: { icon: 'bi-exclamation-circle-fill', bg: 'rgba(245,158,11,0.10)', color: '#f59e0b', border: 'rgba(245,158,11,0.25)' },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const showToast = useCallback((message: string, type: ToastType) => {
    const id = Date.now().toString();
    setToasts(prev => [...prev.slice(-4), { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4500);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div style={{
        position: 'fixed', top: 20, right: 20, zIndex: 9999,
        display: 'flex', flexDirection: 'column', gap: 10,
        pointerEvents: 'none',
      }}>
        {toasts.map(t => {
          const meta = TOAST_META[t.type];
          return (
            <div key={t.id} style={{
              pointerEvents: 'auto',
              minWidth: 300, maxWidth: 380,
              padding: '12px 16px',
              background: 'var(--bg-secondary)',
              border: `1px solid ${meta.border}`,
              borderLeft: `4px solid ${meta.color}`,
              borderRadius: 12,
              boxShadow: '0 8px 30px rgba(23,28,98,0.12)',
              display: 'flex', alignItems: 'flex-start', gap: 10,
              animation: 'toastSlideIn 0.25s cubic-bezier(0.16,1,0.3,1) forwards',
            }}>
              <i className={`bi ${meta.icon}`} style={{ color: meta.color, fontSize: 16, marginTop: 1, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', lineHeight: 1.4 }}>{t.message}</p>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
