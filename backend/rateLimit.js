function createRateLimiter({ windowMs, maxRequests, message }) {
  const attempts = new Map();
  let requestsSinceCleanup = 0;

  // Keep this process-local map bounded; multi-worker deployments need a shared rate-limit store.
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of attempts) {
      if (entry.resetAt <= now) attempts.delete(key);
    }
  }, Math.min(windowMs, 60_000));
  cleanupTimer.unref();

  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || req.socket.remoteAddress || 'unknown';
    let entry = attempts.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      attempts.set(key, entry);
    }

    entry.count += 1;
    requestsSinceCleanup += 1;
    if (requestsSinceCleanup >= maxRequests * 10) {
      requestsSinceCleanup = 0;
      for (const [attemptKey, attempt] of attempts) {
        if (attempt.resetAt <= now) attempts.delete(attemptKey);
      }
    }

    if (entry.count > maxRequests) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))));
      return res.status(429).json({ error: message });
    }
    return next();
  };
}

module.exports = { createRateLimiter };