// shared/rate-limit.js
export class RateLimiter {
  #buckets = new Map();

  /** @returns {boolean} true — пропускаем, false — лимит исчерпан */
  check(key, { max, windowMs }) {
    const now = Date.now();
    let bucket = this.#buckets.get(key);
    if (!bucket || now - bucket.start >= windowMs) {
      bucket = { start: now, count: 0 };
      this.#buckets.set(key, bucket);
    }
    bucket.count++;
    return bucket.count <= max;
  }

  reset(key) { this.#buckets.delete(key); }

  prune(maxAgeMs = 10 * 60 * 1000) {
    const now = Date.now();
    for (const [key, bucket] of this.#buckets) {
      if (now - bucket.start > maxAgeMs) this.#buckets.delete(key);
    }
  }
}

export const RATE_LIMITS = {
  CREATE_ROOM: { max: 3, windowMs: 60_000 },
  JOIN:        { max: 5, windowMs: 60_000 },
  CHAT:        { max: 5, windowMs: 1_000 },
  ACTION:      { max: 60, windowMs: 1_000 },
  KICK:        { max: 20, windowMs: 60_000 },
};