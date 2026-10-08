// Settings change rarely but are read on almost every wallet request; keep them in memory briefly.
const TTL_MS = 60 * 1000;
const entries = new Map();

export const cached = async (key, load) => {
  const hit = entries.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return hit.value;
  }
  const value = await load();
  entries.set(key, { value, at: Date.now() });
  return value;
};

export const invalidate = (key) => {
  entries.delete(key);
};
