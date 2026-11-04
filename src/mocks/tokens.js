// Mocked token validation. A real service would verify a signed JWT here.
const TOKENS = {
  'token-viewer': { id: 'user_viewer', role: 'viewer' },
  'token-operator': { id: 'user_operator', role: 'operator' },
  'token-admin': { id: 'user_admin', role: 'admin' },
};

function verifyToken(token) {
  return Object.hasOwn(TOKENS, token) ? TOKENS[token] : null;
}

module.exports = { verifyToken };
