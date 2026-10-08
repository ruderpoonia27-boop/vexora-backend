import crypto from 'crypto';

// Cashfree Payment Gateway (PG) REST API.
// Docs: https://www.cashfree.com/docs/api-reference/payments/latest/orders/create
const API_VERSION = '2023-08-01';

const getConfig = () => {
  const mode = (process.env.CASHFREE_ENV || 'sandbox').trim().toLowerCase() === 'production' ? 'production' : 'sandbox';
  return {
    appId: (process.env.CASHFREE_APP_ID || '').trim(),
    secretKey: (process.env.CASHFREE_SECRET_KEY || '').trim(),
    mode,
    baseUrl: (process.env.CASHFREE_API_BASE || '').trim()
      || (mode === 'production' ? 'https://api.cashfree.com/pg' : 'https://sandbox.cashfree.com/pg')
  };
};

export const isCashfreeEnabled = () => {
  const { appId, secretKey } = getConfig();
  return Boolean(appId && secretKey);
};

export const getCashfreeMode = () => getConfig().mode;

const request = async (method, path, body) => {
  const { appId, secretKey, baseUrl } = getConfig();
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-api-version': API_VERSION,
      'x-client-id': appId,
      'x-client-secret': secretKey
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || `Cashfree request failed (${response.status})`);
    error.status = response.status;
    error.code = data.code;
    throw error;
  }
  return data;
};

export const createCashfreeOrder = ({ orderId, amount, customer, returnUrl, notifyUrl }) => request('POST', '/orders', {
  order_id: orderId,
  order_amount: amount,
  order_currency: 'INR',
  customer_details: {
    customer_id: customer.id,
    customer_name: customer.name || undefined,
    customer_email: customer.email || undefined,
    customer_phone: customer.phone
  },
  order_meta: {
    return_url: returnUrl,
    ...(notifyUrl ? { notify_url: notifyUrl } : {})
  },
  order_note: 'Vexora wallet deposit'
});

export const getCashfreeOrder = (orderId) => request('GET', `/orders/${encodeURIComponent(orderId)}`);

export const getCashfreeOrderPayments = (orderId) => request('GET', `/orders/${encodeURIComponent(orderId)}/payments`);

// Webhook signature = Base64(HMAC-SHA256(timestamp + rawBody, secretKey)).
export const verifyCashfreeWebhook = (rawBody, timestamp, signature) => {
  const { secretKey } = getConfig();
  if (!secretKey || !rawBody || !timestamp || !signature) return false;
  const expected = crypto.createHmac('sha256', secretKey).update(`${timestamp}${rawBody}`).digest('base64');
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(String(signature));
  return expectedBuffer.length === signatureBuffer.length && crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
};
