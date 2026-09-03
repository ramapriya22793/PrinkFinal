import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ToastProvider } from './context/ToastContext';
import CustomerPortal from './components/CustomerPortal';
import CustomerAuth from './components/CustomerAuth';
import UploadPortal from './components/UploadPortal';
import UploadLinkResolver from './components/UploadLinkResolver';

function AppContent() {
  const hasToken = !!localStorage.getItem('customer_token');

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <main className="flex-1">
        <Routes>
          {/* Tokenised upload link sent over WhatsApp - deliberately public,
              the token in the path is the only credential required. */}
          <Route path="/upload/:token" element={<UploadPortal />} />
          {/* New Order-level upload link which handles login and redirect to customer portal */}
          <Route path="/o/:token" element={<UploadLinkResolver />} />
          <Route path="/customer/auth" element={<CustomerAuth />} />
          <Route path="/customer/:orderId" element={<CustomerPortal />} />
          <Route path="/customer" element={<CustomerPortal />} />
          <Route path="*" element={<Navigate to={hasToken ? "/customer" : "/customer/auth"} replace />} />
        </Routes>
      </main>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AppContent />
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;
