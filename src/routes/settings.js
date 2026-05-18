import express from 'express';
import Settings from '../models/Settings.js';
import PaymentSettings from '../models/PaymentSettings.js';
import { isDBConnected } from '../config/database.js';
import { getStore, persistStore } from '../config/fileStore.js';

const router = express.Router();

const ensureOfflineSettings = async () => {
  const store = await getStore();
  store.settings = {
    _id: 'settings_1',
    platform_name: 'Nexus Arena',
    contact_email: 'support@nexusarena.com',
    min_deposit_amount: 10,
    min_withdraw_amount: 50,
    ...(store.settings || {})
  };
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
      const settings = await getSettingsRecord();
      return res.json([settings]);
    }

    const store = await ensureOfflineSettings();
    await persistStore();
    return res.json([store.settings]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/settings/:id', async (req, res) => {
  try {
    const payload = {
      platform_name: String(req.body.platform_name ?? req.body.platformName ?? 'Nexus Arena').trim() || 'Nexus Arena',
      contact_email: String(req.body.contact_email ?? req.body.contactEmail ?? 'support@nexusarena.com').trim() || 'support@nexusarena.com',
      min_deposit_amount: Number(req.body.min_deposit_amount),
      min_withdraw_amount: Number(req.body.min_withdraw_amount)
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
      const settings = await getPaymentSettingsRecord();
      return res.json([settings]);
    }

    const store = await ensureOfflineSettings();
    await persistStore();
    return res.json([store.paymentSettings]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/payment-settings/:id', async (req, res) => {
  try {
    const payload = {
      upi_id: req.body.upi_id || '',
      qr_code: req.body.qr_code || ''
    };

    if (isDBConnected()) {
      const settings = await getPaymentSettingsRecord();
      Object.assign(settings, payload);
      await settings.save();
      return res.json(settings);
    }

    const store = await ensureOfflineSettings();
    store.paymentSettings = { ...store.paymentSettings, ...payload };
    await persistStore();
    return res.json(store.paymentSettings);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

export default router;
