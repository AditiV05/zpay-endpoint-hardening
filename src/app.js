const express = require('express');

const { sendError } = require('./errors');
const paymentsRouter = require('./routes/payments');

const app = express();

app.use('/v1/payments', paymentsRouter);

app.use((req, res) => {
  sendError(res, 404, 'not_found', null, `No route for ${req.method} ${req.path}.`);
});

// Keeps parser errors and unexpected failures in the same error shape.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return sendError(res, 400, 'invalid_json', 'body', 'Request body is not valid JSON.');
  }
  if (err.status >= 400 && err.status < 500) {
    return sendError(res, err.status, 'bad_request', 'body', err.message);
  }
  console.error(err);
  return sendError(res, 500, 'internal_error', null, 'Something went wrong. Safe to retry.');
});

module.exports = app;
