import React from 'react';
import { ToastProvider } from './context/ToastContext';
import AdminPortal from './components/AdminPortal';

function AppContent() {
  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 h-screen overflow-hidden">
        <AdminPortal onRouteToPrinter={() => {}} />
      </main>
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
