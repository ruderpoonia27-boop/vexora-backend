import mongoose from 'mongoose';
import { configureDnsServers } from './dns.js';

const RETRY_DELAY_MS = 10000;

const useOfflineStore = () => {
  const value = (process.env.USE_OFFLINE_STORE || '').trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes';
};

let isConnected = false;
let retryTimer = null;
const connectedListeners = new Set();

// Track the live connection state so requests never run against a dropped connection.
mongoose.connection.on('connected', () => { isConnected = true; });
mongoose.connection.on('reconnected', () => { isConnected = true; });
mongoose.connection.on('disconnected', () => { isConnected = false; });

const attemptConnection = async () => {
  retryTimer = null;
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/tournament';
  try {
    configureDnsServers();
    const conn = await mongoose.connect(uri, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 20000,
      connectTimeoutMS: 20000,
      socketTimeoutMS: 45000,
      // Some networks (e.g. mobile ISPs) have unreliable IPv6 routes to Atlas; IPv4 connects consistently.
      family: 4
    });
    isConnected = true;
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    for (const listener of connectedListeners) {
      Promise.resolve()
        .then(listener)
        .catch((error) => console.error('Post-connect task failed:', error.message));
    }
    return true;
  } catch (error) {
    isConnected = false;
    await mongoose.disconnect().catch(() => {});
    // Serverless instances are short-lived; a long-running server keeps retrying in the background.
    if (!process.env.VERCEL) {
      console.error(`MongoDB connection failed: ${error.message}. Retrying in ${RETRY_DELAY_MS / 1000}s...`);
      retryTimer = setTimeout(attemptConnection, RETRY_DELAY_MS);
    } else {
      console.error('MongoDB connection failed:', error.message);
    }
    return false;
  }
};

const connectDB = async () => {
  if (useOfflineStore()) {
    isConnected = false;
    await mongoose.disconnect().catch(() => {});
    console.log('Offline store mode enabled. Using backend/src/data/store.json only.');
    return;
  }
  if (isConnected || retryTimer) return;
  await attemptConnection();
};

export const isDBConnected = () => isConnected;
export const isOfflineMode = useOfflineStore;

// Runs `listener` every time a MongoDB connection is (re-)established by connectDB.
export const onDBConnected = (listener) => {
  connectedListeners.add(listener);
};

export default connectDB;
