import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { pathToFileURL } from 'url';
import connectDB from './config/database.js';
import User from './models/User.js';
import Tournament from './models/Tournament.js';
import Announcement from './models/Announcement.js';
import authRoutes from './routes/auth.js';
import tournamentRoutes from './routes/tournaments.js';
import userRoutes from './routes/users.js';
import withdrawalRoutes from './routes/withdrawals.js';
import adminRoutes from './routes/admin.js';
import settingsRoutes from './routes/settings.js';
import referralRoutes from './routes/referrals.js';
import announcementRoutes from './routes/announcements.js';
import { isDBConnected } from './config/database.js';
import { getStore, persistStore } from './config/fileStore.js';
import { authenticate } from './middleware/auth.js';
import { ensureUniqueReferralCodesForUsers } from './utils/referrals.js';

dotenv.config();

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Unhandled rejection:', error);
});

const app = express();
const PORT = process.env.PORT || 34567;
let startupPromise = null;

export const ensureStartup = () => {
  if (!startupPromise) {
    startupPromise = (async () => {
      await connectDB();
      if (process.env.VERCEL && !isDBConnected()) {
        throw new Error('MongoDB connection is required on Vercel. Set MONGODB_URI and allow Vercel IP access in MongoDB Atlas.');
      }
      await seedAdmin();
      await normalizeReferralCodes();
      await seedAnnouncements();
    })().catch((error) => {
      startupPromise = null;
      throw error;
    });
  }

  return startupPromise;
};

app.use(cors({ 
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true 
}));
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '8mb' }));

if (process.env.VERCEL) {
  app.use(async (req, res, next) => {
    try {
      await ensureStartup();
      next();
    } catch (error) {
      next(error);
    }
  });
}

app.use('/api/auth', authRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/withdrawals', withdrawalRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/announcements', announcementRoutes);
app.use('/api', settingsRoutes);

app.get('/', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Vexora backend is running',
    database: isDBConnected() ? 'mongodb' : 'offline-store'
  });
});

const serializeNotification = (notification, fallbackId, userId) => ({
  _id: notification?._id?.toString?.() || fallbackId || `${userId}_${notification?.createdAt || Date.now()}`,
  id: notification?._id?.toString?.() || fallbackId || `${userId}_${notification?.createdAt || Date.now()}`,
  message: notification?.message || '',
  read: !!notification?.read,
  type: notification?.type || 'info',
  link: notification?.link || '',
  tournamentId: notification?.tournamentId || '',
  created: notification?.createdAt || notification?.created || new Date().toISOString(),
  createdAt: notification?.createdAt || notification?.created || new Date().toISOString()
});

app.get('/api/notifications', authenticate, async (req, res) => {
  try {
    if (isDBConnected()) {
      const user = await User.findById(req.user._id).select('notifications');
      const items = (user?.notifications || [])
        .slice()
        .reverse()
        .map((notification) => serializeNotification(notification, notification?._id?.toString?.(), user._id.toString()));
      return res.json({ items, totalItems: items.length, page: 1, perPage: items.length || 50, totalPages: 1 });
    }

    const store = await getStore();
    const user = store.users.find((item) => item._id === req.user._id || item.id === req.user.id);
    const items = (user?.notifications || [])
      .slice()
      .reverse()
      .map((notification, index) => serializeNotification(notification, notification._id || `${user._id}_${notification.createdAt || index}`, user._id));
    return res.json({ items, totalItems: items.length, page: 1, perPage: items.length || 50, totalPages: 1 });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.put('/api/notifications/:id', authenticate, async (req, res) => {
  try {
    if (isDBConnected()) {
      const user = await User.findById(req.user._id);
      if (!user) return res.status(404).json({ error: 'User not found' });
      const notification = user.notifications.id(req.params.id) || user.notifications.find((item) => item._id?.toString() === req.params.id);
      if (!notification) return res.status(404).json({ error: 'Notification not found' });
      notification.read = req.body.read !== false;
      await user.save();
      return res.json({ message: 'Notification updated', notification: serializeNotification(notification, notification._id?.toString?.(), user._id.toString()) });
    }

    const store = await getStore();
    const user = store.users.find((item) => item._id === req.user._id || item.id === req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    user.notifications = user.notifications || [];
    const index = user.notifications.findIndex((notification, position) => {
      const notificationId = notification._id || `${user._id}_${notification.createdAt || position}`;
      return notificationId === req.params.id;
    });
    if (index === -1) return res.status(404).json({ error: 'Notification not found' });
    user.notifications[index].read = req.body.read !== false;
    await persistStore();
    return res.json({
      message: 'Notification updated',
      notification: serializeNotification(
        user.notifications[index],
        user.notifications[index]._id || `${user._id}_${user.notifications[index].createdAt || index}`,
        user._id
      )
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/api/joins', async (req, res) => {
  if (!isDBConnected()) {
    const store = await getStore();
    const items = store.tournaments.flatMap(tournament =>
      (tournament.currentPlayers || []).map(userId => ({
        tournamentId: tournament._id,
        userId
      }))
    );
    return res.json({ items, totalItems: items.length, page: 1, perPage: items.length, totalPages: 1 });
  }

  const tournaments = await Tournament.find().select('currentPlayers');
  const items = tournaments.flatMap(tournament =>
    (tournament.currentPlayers || []).map(userId => ({
      tournamentId: tournament._id.toString(),
      userId: userId.toString()
    }))
  );
  return res.json({ items, totalItems: items.length, page: 1, perPage: items.length, totalPages: 1 });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    message: 'Server is running',
    database: isDBConnected() ? 'mongodb' : 'offline-store'
  });
});

const seedAdmin = async () => {
  const email = process.env.DEFAULT_ADMIN_EMAIL || 'ruderjaat01@gmail.com';
  const password = process.env.DEFAULT_ADMIN_PASSWORD || 'admin123';

  if (isDBConnected()) {
    const existing = await User.findOne({ email });
    if (existing) {
      if (!existing.isAdmin) {
        existing.isAdmin = true;
        await existing.save();
        console.log(`Admin privileges enabled for ${email}`);
      }
      return;
    }

    const hashed = await bcrypt.hash(password, 10);
    await User.create({
      email,
      password: hashed,
      name: 'Admin',
      walletBalance: 0,
      isAdmin: true
    });
    console.log(`Default Mongo admin created: ${email} / ${password}`);
    return;
  }

  const store = await getStore();
  const existing = store.users.find(user => user.email === email);
  if (existing) {
    existing.isAdmin = true;
    await persistStore();
    return;
  }

  const hashed = await bcrypt.hash(password, 10);
  store.users.push({
    _id: `offline_${store.nextIds.user++}`,
    email,
    password: hashed,
    name: 'Admin',
    walletBalance: 0,
    isAdmin: true
  });
  await persistStore();
  console.log(`Default offline admin created: ${email} / ${password}`);
};

const normalizeReferralCodes = async () => {
  if (isDBConnected()) {
    const users = await User.find().sort({ createdAt: 1 });
    await ensureUniqueReferralCodesForUsers(users, async (user) => {
      await user.save();
    });
    return;
  }

  const store = await getStore();
  const changedCount = await ensureUniqueReferralCodesForUsers(store.users || []);
  if (changedCount > 0) {
    await persistStore();
  }
};

const defaultAnnouncements = [
  {
    title: 'BGMI Squad Tournament',
    message: 'Starts tonight at 8 PM',
    icon: '🔥',
    buttonText: 'Browse',
    redirectUrl: '/tournaments',
    isActive: true,
    order: 1,
    showNewBadge: true,
    showCountdown: false,
    isImportant: true
  },
  {
    title: 'Rs.5,000 Prize Pool',
    message: 'Live now for top arena players',
    icon: '💰',
    buttonText: 'Join Now',
    redirectUrl: '/tournaments',
    isActive: true,
    order: 2,
    showNewBadge: false,
    showCountdown: false,
    isImportant: false
  },
  {
    title: 'Referral Reward',
    message: 'Invite 3 friends and get a free entry',
    icon: '🎁',
    buttonText: 'Invite',
    redirectUrl: '/referral',
    isActive: true,
    order: 3,
    showNewBadge: true,
    showCountdown: false,
    isImportant: false
  }
];

const seedAnnouncements = async () => {
  if (isDBConnected()) {
    const count = await Announcement.countDocuments();
    if (count === 0) {
      await Announcement.insertMany(defaultAnnouncements);
    }
    return;
  }

  const store = await getStore();
  store.announcements = store.announcements || [];
  if (store.announcements.length === 0) {
    store.announcements = defaultAnnouncements.map((announcement, index) => ({
      _id: `announcement_${store.nextIds.announcement++}`,
      ...announcement,
      startTime: null,
      endTime: null,
      createdAt: new Date(Date.now() + index).toISOString()
    }));
    await persistStore();
  }
};

const startServer = () => {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });

  ensureStartup().catch((error) => {
    console.error('Startup initialization failed:', error.message);
  });
};

if (!process.env.VERCEL && import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  startServer();
}

export default app;
