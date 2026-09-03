const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'prink-secret-key-change-in-production';

function authMiddleware(roles = []) {
  if (typeof roles === 'string') {
    roles = [roles];
  }

  return (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ success: false, error: 'Access token required' });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;

      if (roles.length > 0 && !roles.includes(decoded.role)) {
        return res.status(403).json({ success: false, error: 'Unauthorized access' });
      }

      next();
    } catch (err) {
      return res.status(403).json({ success: false, error: 'Invalid or expired token' });
    }
  };
}

function adminMiddleware(req, res, next) {
  return authMiddleware(['admin'])(req, res, next);
}

module.exports = {
  authMiddleware,
  adminMiddleware,
  JWT_SECRET
};
