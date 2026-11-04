const { sendError } = require('../errors');
const { verifyToken } = require('../mocks/tokens');

// 401: we do not know who you are.
function authenticate(req, res, next) {
  const [scheme, token] = (req.get('Authorization') || '').split(' ');
  const user = scheme === 'Bearer' && token ? verifyToken(token) : null;

  if (!user) {
    return sendError(res, 401, 'auth_failed', 'Authorization', 'Auth token is missing or invalid.');
  }

  req.user = user;
  next();
}

// 403: we know who you are, but your role cannot do this.
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!allowedRoles.includes(req.user.role)) {
      return sendError(
        res,
        403,
        'permission_denied',
        'role',
        `Role '${req.user.role}' cannot create payments.`
      );
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
