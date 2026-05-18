import crypto from 'crypto';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { configureDnsServers } from '../config/dns.js';
import { getStore } from '../config/fileStore.js';
import Announcement from '../models/Announcement.js';
import Deposit from '../models/Deposit.js';
import PaymentSettings from '../models/PaymentSettings.js';
import Refund from '../models/Refund.js';
import Settings from '../models/Settings.js';
import Tournament from '../models/Tournament.js';
import User from '../models/User.js';
import Withdrawal from '../models/Withdrawal.js';

dotenv.config();
configureDnsServers();

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/tournament';

const legacyObjectId = (namespace, value) => {
  const hash = crypto.createHash('md5').update(`${namespace}:${value}`).digest('hex');
  return new mongoose.Types.ObjectId(hash.slice(0, 24));
};

const clone = (value) => JSON.parse(JSON.stringify(value || {}));

const withoutId = (doc) => {
  const copy = { ...doc };
  delete copy._id;
  return copy;
};

const mapId = (id, idMap) => {
  if (!id) return undefined;
  return idMap.get(String(id)) || (mongoose.isValidObjectId(id) ? id : undefined);
};

const migrateUsers = async (users) => {
  const idMap = new Map();

  for (const user of users) {
    const existing = user.email ? await User.findOne({ email: user.email }) : null;
    const mongoId = existing?._id || legacyObjectId('user', user._id || user.email || user.name);
    if (user._id) idMap.set(String(user._id), mongoId);
    if (user.id) idMap.set(String(user.id), mongoId);
  }

  for (const user of users) {
    const doc = clone(user);
    const mongoId = idMap.get(String(user._id || user.id)) || legacyObjectId('user', user.email || user.name);

    doc._id = mongoId;
    doc.referred_by = mapId(doc.referred_by, idMap);

    if (Array.isArray(doc.referral_history)) {
      doc.referral_history = doc.referral_history.map((entry) => ({
        ...entry,
        user: mapId(entry.user, idMap)
      }));
    }

    await User.findOneAndUpdate(
      { _id: mongoId },
      { $set: withoutId(doc) },
      { upsert: true, setDefaultsOnInsert: true, runValidators: true }
    );
  }

  return idMap;
};

const migrateAnnouncements = async (announcements) => {
  for (const announcement of announcements) {
    const doc = clone(announcement);
    doc._id = legacyObjectId('announcement', announcement._id || announcement.title);
    await Announcement.findOneAndUpdate(
      { _id: doc._id },
      { $set: withoutId(doc) },
      { upsert: true, setDefaultsOnInsert: true, runValidators: true }
    );
  }
};

const migrateTournaments = async (tournaments, userIdMap) => {
  const tournamentIdMap = new Map();

  for (const tournament of tournaments) {
    const mongoId = legacyObjectId('tournament', tournament._id || tournament.title || tournament.name);
    if (tournament._id) tournamentIdMap.set(String(tournament._id), mongoId);
    if (tournament.id) tournamentIdMap.set(String(tournament.id), mongoId);
  }

  for (const tournament of tournaments) {
    const doc = clone(tournament);
    doc._id = tournamentIdMap.get(String(tournament._id || tournament.id)) || legacyObjectId('tournament', tournament.title || tournament.name);
    doc.currentPlayers = (doc.currentPlayers || []).map((id) => mapId(id, userIdMap)).filter(Boolean);
    doc.winner = mapId(doc.winner, userIdMap);

    if (Array.isArray(doc.participant_profiles)) {
      doc.participant_profiles = doc.participant_profiles
        .map((profile) => ({ ...profile, user: mapId(profile.user, userIdMap) }))
        .filter((profile) => profile.user);
    }

    if (Array.isArray(doc.squads)) {
      doc.squads = doc.squads
        .map((squad) => ({
          ...squad,
          captain: mapId(squad.captain, userIdMap),
          members: (squad.members || []).map((id) => mapId(id, userIdMap)).filter(Boolean)
        }))
        .filter((squad) => squad.captain);
    }

    await Tournament.findOneAndUpdate(
      { _id: doc._id },
      { $set: withoutId(doc) },
      { upsert: true, setDefaultsOnInsert: true, runValidators: true }
    );
  }

  return tournamentIdMap;
};

const migrateRequests = async ({ deposits, refunds, withdrawals }, userIdMap, tournamentIdMap) => {
  for (const deposit of deposits || []) {
    const doc = clone(deposit);
    doc._id = legacyObjectId('deposit', deposit._id || deposit.transaction_id);
    doc.userId = mapId(doc.userId, userIdMap);
    if (!doc.userId) continue;
    await Deposit.findOneAndUpdate({ _id: doc._id }, { $set: withoutId(doc) }, { upsert: true, runValidators: true });
  }

  for (const withdrawal of withdrawals || []) {
    const doc = clone(withdrawal);
    doc._id = legacyObjectId('withdrawal', withdrawal._id || `${withdrawal.userId}:${withdrawal.createdAt}`);
    doc.userId = mapId(doc.userId, userIdMap);
    if (!doc.userId) continue;
    await Withdrawal.findOneAndUpdate({ _id: doc._id }, { $set: withoutId(doc) }, { upsert: true, runValidators: true });
  }

  for (const refund of refunds || []) {
    const doc = clone(refund);
    doc._id = legacyObjectId('refund', refund._id || `${refund.userId}:${refund.tournamentId}:${refund.createdAt}`);
    doc.userId = mapId(doc.userId, userIdMap);
    doc.tournamentId = mapId(doc.tournamentId, tournamentIdMap);
    if (!doc.userId || !doc.tournamentId) continue;
    await Refund.findOneAndUpdate({ _id: doc._id }, { $set: withoutId(doc) }, { upsert: true, runValidators: true });
  }
};

const migrateSettings = async (store) => {
  if (store.settings) {
    const settings = clone(store.settings);
    delete settings._id;
    await Settings.findOneAndUpdate({}, { $set: settings }, { upsert: true, setDefaultsOnInsert: true });
  }

  if (store.paymentSettings) {
    const paymentSettings = clone(store.paymentSettings);
    delete paymentSettings._id;
    await PaymentSettings.findOneAndUpdate({}, { $set: paymentSettings }, { upsert: true, setDefaultsOnInsert: true });
  }
};

try {
  await mongoose.connect(uri, {
    maxPoolSize: 5,
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
    socketTimeoutMS: 45000
  });

  const store = await getStore();
  const users = store.users || [];
  const tournaments = store.tournaments || [];

  const userIdMap = await migrateUsers(users);
  const tournamentIdMap = await migrateTournaments(tournaments, userIdMap);
  await migrateAnnouncements(store.announcements || []);
  await migrateRequests(store, userIdMap, tournamentIdMap);
  await migrateSettings(store);

  console.log(`Migrated ${users.length} users, ${tournaments.length} tournaments, ${(store.announcements || []).length} announcements.`);
} catch (error) {
  console.error(`Mongo migration failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect().catch(() => {});
}
