const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'sayunk-dev-secret-change-me';
const TOKEN_TTL = '12h';

function signToken(admin) {
  return jwt.sign(
    { id: admin.id, username: admin.username, role: admin.role },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

function getTokenFromReq(req) {
  const header = req.headers.authorization || '';
  if (header.startsWith('Bearer ')) return header.slice(7);
  return null;
}

// Middleware: wajib login (admin mana pun)
function requireAuth(req, res, next) {
  const token = getTokenFromReq(req);
  if (!token) return res.status(401).json({ status: 'error', message: 'Belum login' });
  try {
    req.admin = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ status: 'error', message: 'Sesi berakhir, silakan login ulang' });
  }
}

// Middleware: wajib SUPERADMIN
function requireSuperAdmin(req, res, next) {
  requireAuth(req, res, () => {
    if (req.admin.role !== 'SUPERADMIN') {
      return res.status(403).json({ status: 'error', message: 'Khusus Super Admin' });
    }
    next();
  });
}

module.exports = { signToken, requireAuth, requireSuperAdmin, JWT_SECRET };
