import express from 'express';
import Settings from '../models/Settings.js';
import PaymentSettings from '../models/PaymentSettings.js';
import { isDBConnected } from '../config/database.js';
import { getStore, persistStore } from '../config/fileStore.js';
import { cached, invalidate } from '../utils/settingsCache.js';
import { authenticate, authorizeAdmin } from '../middleware/auth.js';

const router = express.Router();
const defaultContactSettings = {
  whatsappEnabled: true,
  whatsappNumber: '',
  telegramEnabled: false,
  telegramLink: ''
};

const normalizeBoolean = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().toLowerCase() !== 'false';
  return Boolean(value);
};

const normalizeContactSettings = (source = {}, current = {}) => {
  const incoming = source.contactSettings || source.contact_settings || source;
  return {
    whatsappEnabled: normalizeBoolean(incoming.whatsappEnabled ?? incoming.whatsapp_enabled, current.whatsappEnabled ?? true),
    whatsappNumber: String(incoming.whatsappNumber ?? incoming.whatsapp_number ?? current.whatsappNumber ?? '').trim(),
    telegramEnabled: normalizeBoolean(incoming.telegramEnabled ?? incoming.telegram_enabled, current.telegramEnabled ?? false),
    telegramLink: String(incoming.telegramLink ?? incoming.telegram_link ?? current.telegramLink ?? '').trim()
  };
};

const ensureOfflineSettings = async () => {
  const store = await getStore();
  store.settings = {
    _id: 'settings_1',
    platform_name: 'Vexora',
    contact_email: 'support@nexusarena.com',
    min_deposit_amount: 10,
    min_withdraw_amount: 50,
    contactSettings: defaultContactSettings,
    ...(store.settings || {})
  };
  store.settings.contactSettings = normalizeContactSettings(store.settings.contactSettings, defaultContactSettings);
  store.paymentSettings = {
    _id: 'payment_settings_1',
    upi_id: 'tournament@upi',
    qr_code: '',
    ...(store.paymentSettings || {})
  };
  return store;
};

const getSettingsRecord = async () => {
  let settings = await Settings.findOne();
  if (!settings) {
    settings = await Settings.create({});
  }
  return settings;
};

export const getCachedSettings = () => cached('settings', async () => (await getSettingsRecord()).toObject());
const getCachedPaymentSettings = () => cached('paymentSettings', async () => (await getPaymentSettingsRecord()).toObject());

const getPaymentSettingsRecord = async () => {
  let settings = await PaymentSettings.findOne();
  if (!settings) {
    settings = await PaymentSettings.create({});
  }
  return settings;
};

router.get('/settings', async (req, res) => {
  try {
    if (isDBConnected()) {
      return res.json([await getCachedSettings()]);
    }

    const store = await ensureOfflineSettings();
    await persistStore();
    return res.json([store.settings]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/settings/:id', authenticate, authorizeAdmin, async (req, res) => {
  try {
    const currentContactSettings = isDBConnected()
      ? normalizeContactSettings((await getSettingsRecord()).contactSettings, defaultContactSettings)
      : normalizeContactSettings((await ensureOfflineSettings()).settings?.contactSettings, defaultContactSettings);
    const payload = {
      platform_name: String(req.body.platform_name ?? req.body.platformName ?? 'Vexora').trim() || 'Vexora',
      contact_email: String(req.body.contact_email ?? req.body.contactEmail ?? 'support@nexusarena.com').trim() || 'support@nexusarena.com',
      min_deposit_amount: Number(req.body.min_deposit_amount),
      min_withdraw_amount: Number(req.body.min_withdraw_amount),
      contactSettings: normalizeContactSettings(req.body, currentContactSettings)
    };

    if (!payload.contact_email.includes('@')) {
      return res.status(400).json({ error: 'Contact email must be valid' });
    }
    if (Number.isNaN(payload.min_deposit_amount) || payload.min_deposit_amount < 1) {
      return res.status(400).json({ error: 'Minimum deposit amount must be >= 1' });
    }
    if (Number.isNaN(payload.min_withdraw_amount) || payload.min_withdraw_amount < 1) {
      return res.status(400).json({ error: 'Minimum withdraw amount must be >= 1' });
    }

    if (isDBConnected()) {
      const settings = await getSettingsRecord();
      Object.assign(settings, payload);
      await settings.save();
      invalidate('settings');
      return res.json(settings);
    }

    const store = await ensureOfflineSettings();
    store.settings = { ...store.settings, ...payload };
    await persistStore();
    return res.json(store.settings);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.get('/payment-settings', async (req, res) => {
  try {
    if (isDBConnected()) {
      res.set('Cache-Control', 'private, max-age=60');
      return res.json([await getCachedPaymentSettings()]);
    }

    const store = await ensureOfflineSettings();
    await persistStore();
    return res.json([store.paymentSettings]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/payment-settings/:id', authenticate, authorizeAdmin, async (req, res) => {
  try {
    const payload = {
      upi_id: req.body.upi_id || '',
      qr_code: req.body.qr_code || ''
    };

    if (isDBConnected()) {
      const settings = await getPaymentSettingsRecord();
      Object.assign(settings, payload);
      await settings.save();
      invalidate('paymentSettings');
      return res.json(settings);
    }

    const store = await ensureOfflineSettings();
    store.settings.contactSettings = normalizeContactSettings(store.settings.contactSettings, defaultContactSettings);
  store.paymentSettings = { ...store.paymentSettings, ...payload };
    await persistStore();
    return res.json(store.paymentSettings);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;



