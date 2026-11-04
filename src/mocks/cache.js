// Mocked cache layer, a Map with expiry. It stands in for Redis.
const store = new Map();

const cache = {
  get(key) {
    const entry = store.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      store.delete(key);
      return undefined;
    }
    return entry.value;
  },

  set(key, value, ttlSeconds) {
    store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  },

  reset() {
    store.clear();
  },
};

module.exports = cache;
