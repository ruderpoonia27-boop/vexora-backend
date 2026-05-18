import app, { ensureStartup } from '../src/index.js';

export default async function handler(req, res) {
  await ensureStartup();
  return app(req, res);
}
