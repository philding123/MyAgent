// fixture-app.js — token bucket rate limiter (analysis target)
class TokenBucket {
  constructor(capacity, refillPerSec) {
    this.capacity = capacity;
    this.tokens = capacity;
    this.refillPerSec = refillPerSec;
    this.last = Date.now();
  }
  refill() {
    const now = Date.now();
    const elapsed = (now - this.last) / 1000;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSec);
    this.last = now;
  }
  tryTake(n = 1) {
    this.refill();
    if (this.tokens >= n) { this.tokens -= n; return true; }
    return false;
  }
}
function createLimiter(capacity, refillPerSec) {
  const bucket = new TokenBucket(capacity, refillPerSec);
  return (req, res, next) => {
    if (bucket.tryTake(1)) { next(); return; }
    res.statusCode = 429;
    res.end('rate limited');
  };
}
module.exports = { TokenBucket, createLimiter };
