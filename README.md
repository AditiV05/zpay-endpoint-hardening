# ZPay: Hardened POST /v1/payments

A payment endpoint built around four reliability decisions: error semantics, idempotency, rate limiting, and versioning. Storage, cache, and token validation are mocked in memory.

## Local setup

Needs Node 18 or newer.

```bash
npm install
npm start      # runs on http://localhost:3000
npm test       # runs the automated checks
```

Mock tokens:

| Token | Role | Can create payments |
|---|---|---|
| `token-viewer` | viewer | No |
| `token-operator` | operator | Yes |
| `token-admin` | admin | Yes |

## Request order

Each check runs only if the one before it passed:

1. Auth (401)
2. Rate limit (429)
3. Role (403)
4. Field normalisation (`amount_inr` to `amount`)
5. Amount validation (400)
6. Idempotency lookup (replay, or 400 if the amount differs)
7. Business limit (422)
8. Duplicate `transaction_ref` (409), otherwise charge (201)

## Error format

Every error uses this shape. Some cases add extra fields.

```json
{
  "error": {
    "code": "error_code_slug",
    "param": "field_name",
    "message": "human readable message"
  }
}
```

| Status | Code | Param | When |
|---|---|---|---|
| 400 | `required` | `amount` | `amount` and `amount_inr` are both missing |
| 400 | `invalid_amount` | `amount` | Amount is not a positive number |
| 400 | `invalid_json` | `body` | Body is not valid JSON |
| 400 | `idempotency_key_reused` | `Idempotency-Key` | Same key with a different amount |
| 401 | `auth_failed` | `Authorization` | Token is missing or invalid |
| 403 | `permission_denied` | `role` | Viewer calls this write endpoint |
| 409 | `duplicate` | `transaction_ref` | Ref already processed, adds `existing_id` |
| 422 | `limit_exceeded` | `amount` | Amount above 100000, adds `max` |
| 429 | `rate_limit_exceeded` | `null` | Over 50 requests a minute, adds `limit` and `retry_after_seconds` |

## curl examples

Start the server first with `npm start`.

**201: successful payment**

```bash
curl -i -X POST http://localhost:3000/v1/payments \
  -H "Authorization: Bearer token-operator" \
  -H "Content-Type: application/json" \
  -d '{"amount": 500, "transaction_ref": "txn_1"}'
```

**400: missing amount**

```bash
curl -i -X POST http://localhost:3000/v1/payments \
  -H "Authorization: Bearer token-operator" \
  -H "Content-Type: application/json" \
  -d '{"transaction_ref": "txn_2"}'
```

**401: missing token**

```bash
curl -i -X POST http://localhost:3000/v1/payments \
  -H "Content-Type: application/json" \
  -d '{"amount": 500}'
```

**403: viewer role**

```bash
curl -i -X POST http://localhost:3000/v1/payments \
  -H "Authorization: Bearer token-viewer" \
  -H "Content-Type: application/json" \
  -d '{"amount": 500}'
```

**422: amount over the limit**

```bash
curl -i -X POST http://localhost:3000/v1/payments \
  -H "Authorization: Bearer token-operator" \
  -H "Content-Type: application/json" \
  -d '{"amount": 100001}'
```

**409: duplicate transaction_ref** (run after the first example)

```bash
curl -i -X POST http://localhost:3000/v1/payments \
  -H "Authorization: Bearer token-operator" \
  -H "Content-Type: application/json" \
  -d '{"amount": 500, "transaction_ref": "txn_1"}'
```

**Idempotency: run this twice, and both calls return the same payment**

```bash
curl -i -X POST http://localhost:3000/v1/payments \
  -H "Authorization: Bearer token-operator" \
  -H "Idempotency-Key: key-1" \
  -H "Content-Type: application/json" \
  -d '{"amount": 500}'
```

**400: same key, different amount**

```bash
curl -i -X POST http://localhost:3000/v1/payments \
  -H "Authorization: Bearer token-operator" \
  -H "Idempotency-Key: key-1" \
  -H "Content-Type: application/json" \
  -d '{"amount": 900}'
```

**429: over the rate limit** (restart the server first, and request 51 shows 429)

```bash
for i in $(seq 1 51); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:3000/v1/payments \
    -H "Authorization: Bearer token-admin" \
    -H "Content-Type: application/json" \
    -d '{"amount": 1}'
done
```

**Versioning: only amount_inr is sent, and it is used as amount**

```bash
curl -i -X POST http://localhost:3000/v1/payments \
  -H "Authorization: Bearer token-operator" \
  -H "Content-Type: application/json" \
  -d '{"amount_inr": 750}'
```

## Assumptions

- Amounts are whole or decimal rupees sent as JSON numbers. Strings such as `"500"` are refused with 400.
- An amount of exactly 100000 is allowed. Only amounts above it get 422.
- `transaction_ref` is optional. The duplicate check runs only when it is sent.
- Only `operator` and `admin` can create payments.
- Rate limiting runs before the role check, so denied requests also count towards the quota. Requests without a valid token are refused at auth and are not counted, because the limit is per authenticated user.
- The rate limit uses a fixed one-minute window that starts on a user's first request. `Retry-After` is the number of seconds until that window resets.
- Idempotency keys are scoped per user and kept for 24 hours.
- Only successful payments are stored against a key. A key used on a refused request (such as 422) can be used again.
- A replay is checked before the duplicate check. A retry with the same key gets its original 201, not a 409 for its own `transaction_ref`.
- `param` is `null` on 429 because no single field caused the error.

## Limits of the mocks

- All state is in memory, so it resets on restart and works for one server process only.
- Check and charge are safe here because they run in one synchronous step. With a real database and Redis, this needs an atomic lock on the idempotency key (`SET NX`) and a unique index on `transaction_ref`.
