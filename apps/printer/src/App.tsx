import React from 'react';
import { ToastProvider } from './context/ToastContext';
import PrinterPortal from './components/PrinterPortal';

function AppContent() {
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#F8F9FC', paddingBottom: '80px' }}>
      <PrinterPortal />
    </div>
  );
}

function App() {
  return (
    <ToastProvider>
      <AppContent />
    </ToastProvider>
  );
}

export default App;
