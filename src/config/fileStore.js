import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, '../data/store.json');

const defaultStore = {
  users: [],
  tournaments: [],
  announcements: [],
  deposits: [],
  refunds: [],
  withdrawals: [],
  walletTransactions: [],
  settings: {
    _id: 'settings_1',
    min_deposit_amount: 10,
    min_withdraw_amount: 50
  },
  paymentSettings: {
    _id: 'payment_settings_1',
    upi_id: 'tournament@upi',
    qr_code: ''
  },
  nextIds: { user: 1, tournament: 1, announcement: 1, deposit: 1, refund: 1, withdrawal: 1, walletTransaction: 1 }
};

let store = null;

export const getStore = async () => {
  if (store) return store;
  try {
    await fs.access(DATA_FILE);
    const content = await fs.readFile(DATA_FILE, 'utf-8');
    store = JSON.parse(content);
  } catch {
    store = { ...defaultStore };
  }
  store.refunds = store.refunds || [];
  store.announcements = store.announcements || [];
  store.walletTransactions = store.walletTransactions || [];
  store.nextIds = {
    ...defaultStore.nextIds,
    ...(store.nextIds || {})
  };
  return store;
};

export const persistStore = async () => {
  if (!store) return;
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2));
};
