const jwt = require('jsonwebtoken');

const DEFAULT_ROLE = 'user';

function createEnsureAuth({ jwtSecret }) {
  if (!jwtSecret) {
    throw new Error('JWT secret is required for authentication middleware');
  }

  return (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
      const payload = jwt.verify(token, jwtSecret);
      const role = payload.role || DEFAULT_ROLE;
      const rawUserId = payload.sub || payload.userId || payload.id || null;
      const normalizedUserId =
        role === 'admin' || rawUserId === null || rawUserId === undefined
          ? null
          : rawUserId;

      if (role !== 'admin' && (normalizedUserId === null || normalizedUserId === undefined)) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      req.auth = payload;
      req.role = role;
      req.userId = role === 'admin' ? null : normalizedUserId;

      next();
    } catch (error) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  };
}

module.exports = createEnsureAuth;
