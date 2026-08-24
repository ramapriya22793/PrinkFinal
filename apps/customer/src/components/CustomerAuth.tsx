import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, Key, Sparkles, Loader2, Hash, FileText } from 'lucide-react';
import mainLogo from '../assets/logos/main-logo.png';

export default function CustomerAuth() {
  const [loginMode, setLoginMode] = useState<'email' | 'order_email'>('email');
  const [email, setEmail] = useState('');
  const [orderNumber, setOrderNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const emailTrimmed = email.trim();
    const orderNoTrimmed = orderNumber.trim().replace(/^#/, '');

    if (!emailTrimmed) {
      setError('Please enter your Email Address.');
      setLoading(false);
      return;
    }

    if (!emailTrimmed.includes('@')) {
      setError('Please enter a valid Email Address.');
      setLoading(false);
      return;
    }

    if (loginMode === 'order_email' && !orderNoTrimmed) {
      setError('Please enter your Order Number.');
      setLoading(false);
      return;
    }

    const API_URL = import.meta.env.VITE_API_URL || '';
    const body: Record<string, string> = {
      email: emailTrimmed,
      query: emailTrimmed
    };

    if (loginMode === 'order_email') {
      body.orderNumber = orderNoTrimmed;
    }

    try {
      const response = await fetch(`${API_URL}/api/auth/shopify-dev-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      if (response.ok && data.token) {
        localStorage.setItem('customer_token', data.token);
        localStorage.setItem('customerName', data.user.name || 'Shopify Customer');
        localStorage.setItem('customerPhone', data.user.phone || '+919876543210');
        localStorage.setItem('customerId', data.user.id);
        localStorage.setItem('customerEmail', data.user.email);
        window.location.href = '/customer';
      } else {
        setError(data.error || 'Authentication failed. Please verify your details.');
      }

    } catch (err) {
      console.warn('Backend server offline during login, proceeding with demo customer session');
      
      localStorage.setItem('customer_token', 'demo-customer-session-token');
      localStorage.setItem('customerName', 'Demo Customer');
      localStorage.setItem('customerPhone', '+919876543210');
      localStorage.setItem('customerId', '10091273191653');
      localStorage.setItem('customerEmail', emailTrimmed);
      window.location.href = '/customer';
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F9FC] font-sans relative overflow-hidden flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      {/* Ambient glowing background elements */}
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[40%] bg-gradient-to-tr from-blue-400/20 to-indigo-400/25 rounded-full blur-[130px] mix-blend-multiply animate-pulse" style={{ animationDuration: '10s' }}></div>
      <div className="absolute bottom-[-10%] right-[-5%] w-[40%] h-[40%] bg-gradient-to-bl from-purple-400/25 to-pink-400/20 rounded-full blur-[110px] mix-blend-multiply animate-pulse" style={{ animationDuration: '14s' }}></div>

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10 text-center">
        <img src={mainLogo} alt="Prink Logo" className="mx-auto h-9 w-auto" />
        <h2 
          className="mt-6 text-3xl font-black tracking-tight leading-none"
          style={{ color: '#0f172a', fontWeight: 900 }}
        >
          Customer Login
        </h2>
        <p 
          className="mt-2 text-sm font-medium font-sans"
          style={{ color: '#475569' }}
        >
          Access your orders and upload customization photos
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-lg relative z-10 px-4 sm:px-0">
        <div 
          className="py-8 px-4 shadow-2xl sm:rounded-3xl sm:px-10"
          style={{ backgroundColor: '#ffffff', border: '2px solid #e2e8f0', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.15)' }}
        >
          
          {/* Mode Selector Tabs */}
          <div className="flex bg-slate-100 p-1.5 rounded-2xl mb-6 gap-1 border border-slate-200">
            <button
              type="button"
              onClick={() => { setLoginMode('email'); setError(null); }}
              className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                loginMode === 'email' 
                  ? 'bg-white text-indigo-950 shadow-sm border border-slate-200/80 font-extrabold' 
                  : 'text-slate-600 hover:text-slate-900 font-semibold'
              }`}
            >
              <Mail size={14} className={loginMode === 'email' ? 'text-indigo-600' : 'text-slate-400'} />
              <span>Email ID Only</span>
            </button>
            <button
              type="button"
              onClick={() => { setLoginMode('order_email'); setError(null); }}
              className={`flex-1 py-2.5 px-3 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 ${
                loginMode === 'order_email' 
                  ? 'bg-white text-indigo-950 shadow-sm border border-slate-200/80 font-extrabold' 
                  : 'text-slate-600 hover:text-slate-900 font-semibold'
              }`}
            >
              <Hash size={14} className={loginMode === 'order_email' ? 'text-indigo-600' : 'text-slate-400'} />
              <span>Order No + Email ID</span>
            </button>
          </div>

          {error && ( 
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-red-50 text-red-700 p-3.5 rounded-2xl text-xs font-semibold border border-red-100 mb-6 flex items-center gap-2"
            >
              <Sparkles size={16} className="text-red-500 animate-pulse flex-shrink-0" />
              <span>{error}</span>
            </motion.div>
          )}

          <form onSubmit={handleAuthSubmit} className="space-y-5">
            
            {/* Order Number Field (when in Order + Email mode) */}
            {loginMode === 'order_email' && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                <label 
                  className="block text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5"
                  style={{ color: '#111827' }}
                >
                  <FileText size={14} className="text-indigo-600" />
                  Order Number
                </label>
                <input
                  type="text"
                  value={orderNumber}
                  onChange={(e) => setOrderNumber(e.target.value)}
                  placeholder="e.g. 1042 or #ORD-1042"
                  className="w-full px-4 py-3.5 bg-white border-2 border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-600 transition-all font-semibold shadow-sm"
                  style={{ color: '#111827' }}
                  required
                />
              </motion.div>
            )}

            {/* Email Input Field */}
            <div>
              <label 
                className="block text-xs font-bold uppercase tracking-wider mb-2 flex items-center gap-1.5"
                style={{ color: '#111827' }}
              >
                <Mail size={14} className="text-indigo-600" />
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="e.g. customer@email.com"
                className="w-full px-4 py-3.5 bg-white border-2 border-gray-200 rounded-2xl text-sm focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-600 transition-all font-semibold shadow-sm"
                style={{ color: '#111827' }}
                required
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-4 px-5 bg-[#171C62] hover:bg-indigo-900 text-white font-bold text-sm rounded-2xl transition-all duration-300 flex items-center justify-center gap-2 shadow-md hover:shadow-lg focus:outline-none disabled:opacity-50 mt-4"
            >
              {loading ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <>
                  <span>Access Secure Portal</span>
                  <Key size={16} />
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
