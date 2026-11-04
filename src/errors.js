// Every error leaves the API in the same shape:
// { "error": { "code": "...", "param": "...", "message": "..." } }
// `extra` adds case-specific fields, such as `max` or `existing_id`.
function sendError(res, status, code, param, message, extra = {}) {
  return res.status(status).json({
    error: { code, param, message, ...extra },
  });
}

module.exports = { sendError };
