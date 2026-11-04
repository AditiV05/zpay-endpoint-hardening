const express = require('express');

const { sendError } = require('../errors');
const { authenticate, requireRole } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { normaliseFields } = require('../middleware/normaliseFields');
const db = require('../mocks/db');
const cache = require('../mocks/cache');

const MAX_AMOUNT_INR = 100000;
const IDEMPOTENCY_TTL_SECONDS = 86400;

const router = express.Router();

router.post(
  '/',
  authenticate, // 401
  rateLimit({ limit: 50, windowSeconds: 60 }), // 429
  requireRole('operator', 'admin'), // 403
  express.json(),
  normaliseFields,
  (req, res) => {
    const { amount, transaction_ref: transactionRef } = req.body;
    const idempotencyKey = req.get('Idempotency-Key');
    // Scoped per user, so one user's key can never return another user's payment.
    const cacheKey = idempotencyKey && `idem:${req.user.id}:${idempotencyKey}`;

    // 400: the amount is missing or unusable.
    if (amount === undefined || amount === null) {
      return sendError(res, 400, 'required', 'amount', 'amount is required.');
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return sendError(res, 400, 'invalid_amount', 'amount', 'amount must be a positive number.');
    }

    // The replay check runs before the duplicate check. A retry of a successful
    // payment must get its original 201, not a 409 for its own transaction_ref.
    if (cacheKey) {
      const cached = cache.get(cacheKey);
      if (cached) {
        if (cached.amount !== amount) {
          return sendError(
            res,
            400,
            'idempotency_key_reused',
            'Idempotency-Key',
            'Idempotency-Key sent before with different amount.'
          );
        }
        return res.status(201).json(cached.response);
      }
    }

    // 422: valid input, but a business rule blocks it.
    if (amount > MAX_AMOUNT_INR) {
      return sendError(
        res,
        422,
        'limit_exceeded',
        'amount',
        `amount cannot exceed ${MAX_AMOUNT_INR} INR.`,
        { max: MAX_AMOUNT_INR }
      );
    }

    // No await between the checks above and the cache.set below. Node finishes
    // this block before it starts another request, so concurrent retries cannot
    // both charge. With a real async database or Redis, this needs an atomic
    // lock (SET NX) and a unique index on transaction_ref.
    const payment = db.createPayment({
      userId: req.user.id,
      amount,
      transactionRef,
    });

    // 409: a different request already used this transaction_ref.
    if (!payment) {
      return sendError(
        res,
        409,
        'duplicate',
        'transaction_ref',
        'This transaction_ref has already been processed.',
        { existing_id: db.findPaymentIdByRef(transactionRef) }
      );
    }

    if (cacheKey) {
      cache.set(cacheKey, { amount, response: payment }, IDEMPOTENCY_TTL_SECONDS);
    }

    return res.status(201).json(payment);
  }
);

module.exports = router;
