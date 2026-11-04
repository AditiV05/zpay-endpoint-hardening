const { sendError } = require('../errors');

const windows = new Map(); // user id -> { count, resetAt }

// Fixed-window limiter, counted per authenticated user.
function rateLimit({ limit, windowSeconds }) {
  return (req, res, next) => {
    const now = Date.now();
    let entry = windows.get(req.user.id);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowSeconds * 1000 };
      windows.set(req.user.id, entry);
    }

    entry.count += 1;

    if (entry.count > limit) {
      // Seconds until this user's quota resets, not the full window length.
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return sendError(
        res,
        429,
        'rate_limit_exceeded',
        null,
        `Limit of ${limit} requests per minute exceeded. Retry after ${retryAfter} seconds.`,
        { limit: `${limit} per minute`, retry_after_seconds: retryAfter }
      );
    }

    next();
  };
}

function resetRateLimits() {
  windows.clear();
}

module.exports = { rateLimit, resetRateLimits };
