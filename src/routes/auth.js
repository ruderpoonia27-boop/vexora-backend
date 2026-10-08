import express from 'express';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import { isDBConnected } from '../config/database.js';
import { getStore, persistStore } from '../config/fileStore.js';
import { authenticate, signToken } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { serializeUser } from '../utils/serializers.js';
import { addReferralSignup, createUniqueReferralCode, ensureReferralState, normalizeReferralCode } from '../utils/referrals.js';

const router = express.Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const normalizeEmail = (value) => String(value || '').trim().toLowerCase();

// Accounts created before emails were normalized may have mixed case; match those too.
const findUserByEmail = async (email) => {
  const exact = await User.findOne({ email });
  if (exact) return exact;
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return User.findOne({ email: { $regex: `^${escaped}$`, $options: 'i' } });
};
const findOfflineUserByEmail = (store, email) => store.users.find((user) => normalizeEmail(user.email) === email);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyFn: (req) => `${req.ip}:${normalizeEmail(req.body?.email)}`,
  message: 'Too many login attempts. Please wait 15 minutes and try again.'
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many sign-ups from this network. Please try again later.'
});

router.post('/register', registerLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const providedName = String(req.body.name || '').trim();
    const name = providedName || `Player${Date.now().toString(36).toUpperCase()}`;
    const avatarId = String(req.body.avatarId || req.body.avatar_id || 'vanguard-01').trim() || 'vanguard-01';
    const referralCode = normalizeReferralCode(req.body.referralCode || req.body.referral_code || '');
    const acceptedPolicies = req.body.acceptedPolicies === true || req.body.accepted_policies === true;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    if (!EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    if (!acceptedPolicies) {
      return res.status(400).json({ error: 'You must accept the Terms & Conditions and Privacy Policy' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    if (isDBConnected()) {
      const existingUser = await findUserByEmail(email);
      if (existingUser) {
        return res.status(400).json({ error: 'Email already exists' });
      }

      let referrer = null;
      if (referralCode) {
        referrer = await User.findOne({ referral_code: referralCode });
        if (!referrer) {
          return res.status(400).json({ error: 'Invalid referral code' });
        }
      }

      const uniqueReferralCode = await createUniqueReferralCode(name, async (candidate) => {
        const existing = await User.exists({ referral_code: candidate });
        return !!existing;
      });
      
      const user = await User.create({
        email,
        password: hashedPassword,
        name,
        avatar_id: avatarId,
        profile_setup_completed: !!providedName,
        isAdmin: false,
        referral_code: uniqueReferralCode,
        referred_by: referrer?._id,
        referred_by_code: referrer?.referral_code || '',
        policy_acceptance: {
          accepted_terms: true,
          accepted_privacy: true,
          accepted_at: new Date()
        }
      });

      if (referrer) {
        ensureReferralState(referrer);
        addReferralSignup(referrer, user);
        await referrer.save();
      }
      const token = signToken(user._id);
      
      return res.json({ 
        token, 
        user: serializeUser(user)
      });
    } else {
      const store = await getStore();
      const existingOffline = findOfflineUserByEmail(store, email);
      if (existingOffline) {
        return res.status(400).json({ error: 'Email already exists' });
      }

      let referrer = null;
      if (referralCode) {
        referrer = store.users.find((item) => normalizeReferralCode(item.referral_code) === referralCode);
        if (!referrer) {
          return res.status(400).json({ error: 'Invalid referral code' });
        }
      }

      const uniqueReferralCode = await createUniqueReferralCode(name, async (candidate) => (
        store.users.some((item) => normalizeReferralCode(item.referral_code) === candidate)
      ));
      
      const user = {
        _id: `offline_${store.nextIds.user++}`,
        email,
        password: hashedPassword,
        name,
        avatar_id: avatarId,
        profile_setup_completed: !!providedName,
        walletBalance: 0,
        isAdmin: false,
        referral_code: uniqueReferralCode,
        referred_by: referrer?._id || '',
        referred_by_code: referrer?.referral_code || '',
        policy_acceptance: {
          accepted_terms: true,
          accepted_privacy: true,
          accepted_at: new Date().toISOString()
        },
        createdAt: new Date().toISOString()
      };
      store.users.push(user);
      if (referrer) {
        ensureReferralState(referrer);
        addReferralSignup(referrer, user);
      }
      await persistStore();
      
      const token = signToken(user._id);
      
      return res.json({ 
        token, 
        user: serializeUser(user)
      });
    }
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: error.message || 'Registration failed' });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    if (isDBConnected()) {
      const user = await findUserByEmail(email);
      if (!user) {
        return res.status(400).json({ error: 'Invalid credentials' });
      }

      if (user.isBlocked) {
        return res.status(403).json({ error: 'Your account is blocked. Please contact support.' });
      }
      
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ error: 'Invalid credentials' });
      }
      
      const token = signToken(user._id);
      
      return res.json({ 
        token, 
        user: serializeUser(user)
      });
    } else {
      const store = await getStore();
      const user = findOfflineUserByEmail(store, email);
      if (!user) {
        return res.status(400).json({ error: 'Invalid credentials' });
      }

      if (user.isBlocked) {
        return res.status(403).json({ error: 'Your account is blocked. Please contact support.' });
      }
      
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ error: 'Invalid credentials' });
      }
      
      const token = signToken(user._id);
      
      return res.json({ 
        token, 
        user: serializeUser(user)
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: error.message || 'Login failed' });
  }
});

router.get('/me', authenticate, async (req, res) => {
  res.json({ user: serializeUser(req.user) });
});

export default router;
