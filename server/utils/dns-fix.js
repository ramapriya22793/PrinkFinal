const dns = require('dns');

// Force public DNS servers (Google & Cloudflare) on all platforms.
// On Windows, Node's c-ares resolver can fail to parse the system's DNS registry settings.
// On Vercel/Linux, the default resolver may also fail to resolve MongoDB Atlas SRV records.
// Using public DNS servers fixes querySrv ECONNREFUSED errors on all environments.
if (dns.setServers && !process.env.VERCEL) {
  try {
    dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
  } catch (err) {
    console.warn('[DNS FIX] Warning: Failed to set public DNS servers:', err.message);
  }
}
