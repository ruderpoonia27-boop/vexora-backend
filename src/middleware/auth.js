import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { isDBConnected } from '../config/database.js';
import { getStore } from '../config/fileStore.js';

const DEV_SECRET = 'local-dev-secret';
const TOKEN_TTL = '7d';

export const isProduction = () => Boolean(
  process.env.NODE_ENV === 'production' || process.env.VERCEL || process.env.RENDER
);

// Anyone who knows the signing secret can log in as any user, so a deployed server must set its own.
export const getJwtSecret = () => {
  const secret = (process.env.JWT_SECRET || '').trim();
  if (secret) return secret;
  if (isProduction()) {
    throw new Error('JWT_SECRET is not set. Refusing to sign or verify tokens.');
  }
  return DEV_SECRET;
};

export const signToken = (userId) => jwt.sign({ id: String(userId) }, getJwtSecret(), { expiresIn: TOKEN_TTL });

const loadUser = async (token) => {
  const decoded = jwt.verify(token, getJwtSecret());
  if (isDBConnected()) {
    return User.findById(decoded.id);
  }
  const store = await getStore();
  return store.users.find((user) => user._id === decoded.id) || null;
};

const readToken = (req) => {
  const [scheme, token] = String(req.headers.authorization || '').split(' ');
  return scheme === 'Bearer' && token ? token : null;
};

export const authenticate = async (req, res, next) => {
  // Already resolved by optionalAuth on this request.
  if (req.user) return next();

  const token = readToken(req);
  if (!token) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  let user;
  try {
    user = await loadUser(token);
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
  if (!user) {
    return res.status(401).json({ error: 'User not found' });
  }
  if (user.isBlocked && !user.isAdmin) {
    return res.status(403).json({ error: 'Your account is blocked. Please contact support.' });
  }
  req.user = user;
  return next();
};

// For public routes that show more to logged-in users: sets req.user when a valid token is sent.
export const optionalAuth = async (req, res, next) => {
  const token = readToken(req);
  if (token) {
    try {
      const user = await loadUser(token);
      if (user && !(user.isBlocked && !user.isAdmin)) {
        req.user = user;
      }
    } catch {
      // Invalid or expired token: continue as a guest.
    }
  }
  return next();
};

export const authorizeAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  return next();
};

export const requireSelfOrAdmin = (paramName = 'userId') => (req, res, next) => {
  const ownId = String(req.user?._id ?? '');
  if (req.user?.isAdmin || (ownId && ownId === String(req.params[paramName]))) {
    return next();
  }
  return res.status(403).json({ error: 'You can only access your own account' });
};
