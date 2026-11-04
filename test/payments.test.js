const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const app = require('../src/app');
const db = require('../src/mocks/db');
const cache = require('../src/mocks/cache');
const { resetRateLimits } = require('../src/middleware/rateLimit');

let server;
let url;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  url = `http://127.0.0.1:${server.address().port}/v1/payments`;
});

after(() => server.close());

beforeEach(() => {
  db.reset();
  cache.reset();
  resetRateLimits();
});

async function pay(body, { token = 'token-operator', key } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (key) headers['Idempotency-Key'] = key;
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
  return { status: res.status, headers: res.headers, body: await res.json() };
}

function assertError(result, status, code, param) {
  assert.equal(result.status, status);
  assert.equal(result.body.error.code, code);
  assert.equal(result.body.error.param, param);
  assert.equal(typeof result.body.error.message, 'string');
}

test('201 for a valid payment', async () => {
  const res = await pay({ amount: 500, transaction_ref: 'txn_1' });
  assert.equal(res.status, 201);
  assert.equal(res.body.amount, 500);
  assert.equal(db.chargeCount(), 1);
});

test('400 when amount is missing', async () => {
  assertError(await pay({ transaction_ref: 'txn_1' }), 400, 'required', 'amount');
  assert.equal(db.chargeCount(), 0);
});

test('400 when amount is not a positive number', async () => {
  for (const amount of ['500', 0, -5]) {
    assertError(await pay({ amount }), 400, 'invalid_amount', 'amount');
  }
  assert.equal(db.chargeCount(), 0);
});

test('400 in the same shape for malformed JSON', async () => {
  assertError(await pay('{not json'), 400, 'invalid_json', 'body');
});

test('401 when the token is missing or invalid', async () => {
  assertError(await pay({ amount: 500 }, { token: null }), 401, 'auth_failed', 'Authorization');
  assertError(await pay({ amount: 500 }, { token: 'nope' }), 401, 'auth_failed', 'Authorization');
  assertError(await pay({ amount: 500 }, { token: 'constructor' }), 401, 'auth_failed', 'Authorization');
});

test('403 for a viewer, while operator and admin can write', async () => {
  assertError(await pay({ amount: 500 }, { token: 'token-viewer' }), 403, 'permission_denied', 'role');
  assert.equal(db.chargeCount(), 0);
  assert.equal((await pay({ amount: 500 }, { token: 'token-operator' })).status, 201);
  assert.equal((await pay({ amount: 500 }, { token: 'token-admin' })).status, 201);
});

test('422 above the limit, and exactly 100000 is allowed', async () => {
  const over = await pay({ amount: 100001 });
  assertError(over, 422, 'limit_exceeded', 'amount');
  assert.equal(over.body.error.max, 100000);
  assert.equal(db.chargeCount(), 0);
  assert.equal((await pay({ amount: 100000 })).status, 201);
});

test('409 for a repeated transaction_ref, with the existing id', async () => {
  const first = await pay({ amount: 500, transaction_ref: 'txn_1' });
  const second = await pay({ amount: 500, transaction_ref: 'txn_1' });
  assertError(second, 409, 'duplicate', 'transaction_ref');
  assert.equal(second.body.error.existing_id, first.body.id);
  assert.equal(db.chargeCount(), 1);
});

test('same key and same amount replays the original 201 with no second charge', async () => {
  const body = { amount: 500, transaction_ref: 'txn_1' };
  const first = await pay(body, { key: 'key-1' });
  const retry = await pay(body, { key: 'key-1' });
  assert.equal(retry.status, 201);
  assert.deepEqual(retry.body, first.body);
  assert.equal(db.chargeCount(), 1);
});

test('same key and a different amount returns 400 with no second charge', async () => {
  await pay({ amount: 500 }, { key: 'key-1' });
  const retry = await pay({ amount: 900 }, { key: 'key-1' });
  assertError(retry, 400, 'idempotency_key_reused', 'Idempotency-Key');
  assert.equal(retry.body.error.message, 'Idempotency-Key sent before with different amount.');
  assert.equal(db.chargeCount(), 1);
});

test('concurrent retries with one key charge once', async () => {
  const results = await Promise.all(
    Array.from({ length: 10 }, () => pay({ amount: 500 }, { key: 'key-1' }))
  );
  assert.ok(results.every((r) => r.status === 201));
  assert.equal(new Set(results.map((r) => r.body.id)).size, 1);
  assert.equal(db.chargeCount(), 1);
});

test('idempotency keys are scoped per user', async () => {
  const first = await pay({ amount: 500 }, { key: 'shared', token: 'token-operator' });
  const other = await pay({ amount: 500 }, { key: 'shared', token: 'token-admin' });
  assert.notEqual(first.body.id, other.body.id);
  assert.equal(db.chargeCount(), 2);
});

test('a rejected request does not use up the idempotency key', async () => {
  assert.equal((await pay({ amount: 100001 }, { key: 'key-1' })).status, 422);
  assert.equal((await pay({ amount: 500 }, { key: 'key-1' })).status, 201);
});

test('429 with Retry-After on request 51, per user', async () => {
  for (let i = 0; i < 50; i += 1) {
    assert.equal((await pay({ amount: 1 })).status, 201);
  }
  const blocked = await pay({ amount: 1 });
  assertError(blocked, 429, 'rate_limit_exceeded', null);
  const retryAfter = Number(blocked.headers.get('retry-after'));
  assert.ok(retryAfter >= 1 && retryAfter <= 60);
  assert.equal(blocked.body.error.retry_after_seconds, retryAfter);
  assert.equal(db.chargeCount(), 50);

  // A different user still has their own quota.
  assert.equal((await pay({ amount: 1 }, { token: 'token-admin' })).status, 201);
});

test('amount_inr is used when amount is absent', async () => {
  const res = await pay({ amount_inr: 750 });
  assert.equal(res.status, 201);
  assert.equal(res.body.amount, 750);
});

test('amount wins when both fields are sent', async () => {
  const res = await pay({ amount: 500, amount_inr: 750 });
  assert.equal(res.status, 201);
  assert.equal(res.body.amount, 500);
});

test('the limit also applies to amount_inr', async () => {
  assertError(await pay({ amount_inr: 100001 }), 422, 'limit_exceeded', 'amount');
});
