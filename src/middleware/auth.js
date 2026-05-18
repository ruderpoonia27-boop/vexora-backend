import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { isDBConnected } from '../config/database.js';
import { getStore } from '../config/fileStore.js';

export const authenticate = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'default-secret');
    
    if (isDBConnected()) {
      const user = await User.findById(decoded.id);
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }
      if (user.isBlocked && !user.isAdmin) {
        return res.status(403).json({ error: 'Your account is blocked. Please contact support.' });
      }
      req.user = user;
    } else {
      const store = await getStore();
      const user = store.users.find(u => u._id === decoded.id);
      if (!user) {
        return res.status(401).json({ error: 'User not found' });
      }
      if (user.isBlocked && !user.isAdmin) {
        return res.status(403).json({ error: 'Your account is blocked. Please contact support.' });
      }
      req.user = user;
    }
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

export const authorizeAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};
