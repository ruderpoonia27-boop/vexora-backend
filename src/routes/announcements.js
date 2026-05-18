import express from 'express';
import Announcement from '../models/Announcement.js';
import { getStore, persistStore } from '../config/fileStore.js';
import { isDBConnected } from '../config/database.js';
import { authenticate, authorizeAdmin } from '../middleware/auth.js';

const router = express.Router();
const announcementClients = new Set();

const broadcastAnnouncementUpdate = () => {
  for (const client of announcementClients) {
    client.write('event: announcements:update\n');
    client.write(`data: ${JSON.stringify({ updatedAt: new Date().toISOString() })}\n\n`);
  }
};

const asId = (value) => value?._id?.toString?.() || value?.id || value?._id || value;

const toDateOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const serializeAnnouncement = (source) => ({
  _id: asId(source),
  id: asId(source),
  title: source.title || '',
  message: source.message || '',
  icon: source.icon || '🔥',
  buttonText: source.buttonText || source.button_text || '',
  redirectUrl: source.redirectUrl || source.redirect_url || '',
  isActive: source.isActive !== false && source.is_active !== false,
  order: Number(source.order || 0),
  startTime: source.startTime || source.start_time || null,
  endTime: source.endTime || source.end_time || null,
  showNewBadge: !!(source.showNewBadge || source.show_new_badge),
  showCountdown: !!(source.showCountdown || source.show_countdown),
  isImportant: !!(source.isImportant || source.is_important),
  createdAt: source.createdAt || source.created_at || new Date().toISOString()
});

const isLiveAnnouncement = (announcement, now = new Date()) => {
  const item = serializeAnnouncement(announcement);
  if (!item.isActive) return false;
  const start = toDateOrNull(item.startTime);
  const end = toDateOrNull(item.endTime);
  if (start && start > now) return false;
  if (end && end < now) return false;
  return true;
};

const buildPayload = (body = {}) => {
  const title = String(body.title || '').trim();
  const message = String(body.message || '').trim();

  if (!title) throw new Error('Title is required');
  if (!message) throw new Error('Message is required');

  return {
    title,
    message,
    icon: String(body.icon || '🔥').trim() || '🔥',
    buttonText: String(body.buttonText || body.button_text || '').trim(),
    redirectUrl: String(body.redirectUrl || body.redirect_url || '').trim(),
    isActive: body.isActive ?? body.is_active ?? true,
    order: Number(body.order ?? 0),
    startTime: toDateOrNull(body.startTime || body.start_time),
    endTime: toDateOrNull(body.endTime || body.end_time),
    showNewBadge: !!(body.showNewBadge || body.show_new_badge),
    showCountdown: !!(body.showCountdown || body.show_countdown),
    isImportant: !!(body.isImportant || body.is_important)
  };
};

router.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  });
  res.write('event: announcements:connected\n');
  res.write(`data: ${JSON.stringify({ connectedAt: new Date().toISOString() })}\n\n`);
  announcementClients.add(res);

  req.on('close', () => {
    announcementClients.delete(res);
  });
});

router.get('/admin', authenticate, authorizeAdmin, async (req, res) => {
  try {
    if (isDBConnected()) {
      const items = await Announcement.find().sort({ order: 1, createdAt: -1 });
      return res.json({ items: items.map(serializeAnnouncement), totalItems: items.length });
    }

    const store = await getStore();
    const items = (store.announcements || [])
      .slice()
      .sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
    return res.json({ items: items.map(serializeAnnouncement), totalItems: items.length });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    if (isDBConnected()) {
      const now = new Date();
      const items = await Announcement.find({
        isActive: true,
        $and: [
          { $or: [{ startTime: null }, { startTime: { $lte: now } }] },
          { $or: [{ endTime: null }, { endTime: { $gte: now } }] }
        ]
      }).sort({ order: 1, createdAt: -1 });
      return res.json({ items: items.map(serializeAnnouncement), totalItems: items.length });
    }

    const store = await getStore();
    const items = (store.announcements || [])
      .filter((item) => isLiveAnnouncement(item))
      .sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
    return res.json({ items: items.map(serializeAnnouncement), totalItems: items.length });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/', authenticate, authorizeAdmin, async (req, res) => {
  try {
    const payload = buildPayload(req.body);

    if (isDBConnected()) {
      const created = await Announcement.create(payload);
      broadcastAnnouncementUpdate();
      return res.status(201).json({ message: 'Announcement created', announcement: serializeAnnouncement(created) });
    }

    const store = await getStore();
    const announcement = {
      _id: `announcement_${store.nextIds.announcement++}`,
      ...payload,
      startTime: payload.startTime?.toISOString?.() || null,
      endTime: payload.endTime?.toISOString?.() || null,
      createdAt: new Date().toISOString()
    };
    store.announcements = store.announcements || [];
    store.announcements.push(announcement);
    await persistStore();
    broadcastAnnouncementUpdate();
    return res.status(201).json({ message: 'Announcement created', announcement: serializeAnnouncement(announcement) });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.put('/:id', authenticate, authorizeAdmin, async (req, res) => {
  try {
    const payload = buildPayload(req.body);

    if (isDBConnected()) {
      const updated = await Announcement.findByIdAndUpdate(req.params.id, payload, { new: true });
      if (!updated) return res.status(404).json({ error: 'Announcement not found' });
      broadcastAnnouncementUpdate();
      return res.json({ message: 'Announcement updated', announcement: serializeAnnouncement(updated) });
    }

    const store = await getStore();
    const index = (store.announcements || []).findIndex((item) => item._id === req.params.id || item.id === req.params.id);
    if (index === -1) return res.status(404).json({ error: 'Announcement not found' });
    store.announcements[index] = {
      ...store.announcements[index],
      ...payload,
      startTime: payload.startTime?.toISOString?.() || null,
      endTime: payload.endTime?.toISOString?.() || null
    };
    await persistStore();
    broadcastAnnouncementUpdate();
    return res.json({ message: 'Announcement updated', announcement: serializeAnnouncement(store.announcements[index]) });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.patch('/:id/toggle', authenticate, authorizeAdmin, async (req, res) => {
  try {
    const nextActive = req.body.isActive ?? req.body.is_active;

    if (isDBConnected()) {
      const announcement = await Announcement.findById(req.params.id);
      if (!announcement) return res.status(404).json({ error: 'Announcement not found' });
      announcement.isActive = typeof nextActive === 'boolean' ? nextActive : !announcement.isActive;
      await announcement.save();
      broadcastAnnouncementUpdate();
      return res.json({ message: 'Announcement status updated', announcement: serializeAnnouncement(announcement) });
    }

    const store = await getStore();
    const announcement = (store.announcements || []).find((item) => item._id === req.params.id || item.id === req.params.id);
    if (!announcement) return res.status(404).json({ error: 'Announcement not found' });
    announcement.isActive = typeof nextActive === 'boolean' ? nextActive : announcement.isActive === false;
    await persistStore();
    broadcastAnnouncementUpdate();
    return res.json({ message: 'Announcement status updated', announcement: serializeAnnouncement(announcement) });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.patch('/reorder', authenticate, authorizeAdmin, async (req, res) => {
  try {
    const orderedIds = Array.isArray(req.body.ids) ? req.body.ids : [];
    if (orderedIds.length === 0) return res.status(400).json({ error: 'ids array is required' });

    if (isDBConnected()) {
      await Promise.all(orderedIds.map((id, index) => Announcement.findByIdAndUpdate(id, { order: index + 1 })));
      const items = await Announcement.find().sort({ order: 1, createdAt: -1 });
      broadcastAnnouncementUpdate();
      return res.json({ message: 'Announcements reordered', items: items.map(serializeAnnouncement) });
    }

    const store = await getStore();
    store.announcements = store.announcements || [];
    orderedIds.forEach((id, index) => {
      const item = store.announcements.find((announcement) => announcement._id === id || announcement.id === id);
      if (item) item.order = index + 1;
    });
    await persistStore();
    const items = store.announcements.slice().sort((left, right) => Number(left.order || 0) - Number(right.order || 0));
    broadcastAnnouncementUpdate();
    return res.json({ message: 'Announcements reordered', items: items.map(serializeAnnouncement) });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

router.delete('/:id', authenticate, authorizeAdmin, async (req, res) => {
  try {
    if (isDBConnected()) {
      const deleted = await Announcement.findByIdAndDelete(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Announcement not found' });
      broadcastAnnouncementUpdate();
      return res.json({ message: 'Announcement deleted' });
    }

    const store = await getStore();
    const before = (store.announcements || []).length;
    store.announcements = (store.announcements || []).filter((item) => item._id !== req.params.id && item.id !== req.params.id);
    if (store.announcements.length === before) return res.status(404).json({ error: 'Announcement not found' });
    await persistStore();
    broadcastAnnouncementUpdate();
    return res.json({ message: 'Announcement deleted' });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

export default router;
