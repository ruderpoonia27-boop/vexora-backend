// Small in-memory rate limiter. Per server instance, which is enough to stop password guessing
// from a single client without adding infrastructure.
export const rateLimit = ({ windowMs, max, keyFn = (req) => req.ip, message = 'Too many attempts. Please try again later.' }) => {
  const hits = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }, windowMs);
  sweep.unref?.();

  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    return next();
  };
};
