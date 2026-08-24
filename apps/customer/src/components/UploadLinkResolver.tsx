import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, AlertTriangle } from 'lucide-react';

export default function UploadLinkResolver() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;

    fetch(`/api/auth/upload-link/${token}`)
      .then(res => res.json())
      .then(data => {
        if (data.success && data.token) {
          localStorage.setItem('customer_token', data.token);
          // Redirect to the customer portal
          navigate('/customer', { replace: true });
        } else {
          setError(data.error || 'Invalid or expired upload link.');
        }
      })
      .catch(err => {
        setError('Network error. Please try again.');
      });
  }, [token, navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8F9FC] p-4">
        <div className="bg-white rounded-3xl shadow-sm border p-8 max-w-md text-center">
          <AlertTriangle className="mx-auto text-amber-500 mb-4" size={40} />
          <h1 className="text-xl font-bold text-gray-900 mb-2">Link Invalid</h1>
          <p className="text-gray-500 text-sm">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#F8F9FC]">
      <Loader2 className="animate-spin text-[#171C62] mb-4" size={40} />
      <p className="text-gray-600 font-medium">Loading your secure ...</p>
    </div>
  );
}
