import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { isDBConnected } from '../config/database.js';
import { getStore, persistStore } from '../config/fileStore.js';
import { authenticate } from '../middleware/auth.js';
import { serializeUser } from '../utils/serializers.js';
import { addReferralSignup, createUniqueReferralCode, ensureReferralState, normalizeReferralCode } from '../utils/referrals.js';

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    const avatarId = String(req.body.avatarId || req.body.avatar_id || 'vanguard-01').trim() || 'vanguard-01';
    const referralCode = normalizeReferralCode(req.body.referralCode || req.body.referral_code || '');
    const acceptedPolicies = req.body.acceptedPolicies === true || req.body.accepted_policies === true;
    
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name are required' });
    }
    if (!acceptedPolicies) {
      return res.status(400).json({ error: 'You must accept the Terms & Conditions and Privacy Policy' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    if (isDBConnected()) {
      const existingUser = await User.findOne({ email });
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
        isAdmin: email === process.env.DEFAULT_ADMIN_EMAIL,
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
      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'default-secret', { expiresIn: '7d' });
      
      return res.json({ 
        token, 
        user: serializeUser(user)
      });
    } else {
      const store = await getStore();
      const existingOffline = store.users.find(u => u.email === email);
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
        walletBalance: 0,
        isAdmin: email === process.env.DEFAULT_ADMIN_EMAIL,
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
      
      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'default-secret', { expiresIn: '7d' });
      
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

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    if (isDBConnected()) {
      const user = await User.findOne({ email });
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
      
      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'default-secret', { expiresIn: '7d' });
      
      return res.json({ 
        token, 
        user: serializeUser(user)
      });
    } else {
      const store = await getStore();
      const user = store.users.find(u => u.email === email);
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
      
      const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'default-secret', { expiresIn: '7d' });
      
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
