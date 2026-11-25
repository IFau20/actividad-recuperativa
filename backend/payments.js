import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

// The browser never decides what is purchased or how much it costs.
export const PRODUCT = Object.freeze({
  id: 'notebook-01', name: 'Cuaderno universitario',
  description: 'Cuaderno de 100 hojas. Producto de demostración para una compra de prueba.',
  price: 1000, currency: 'CLP', quantity: 1,
});

export class AppError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function readConfig(env = process.env) {
  const token = (env.MP_ACCESS_TOKEN || '').trim();
  let baseUrl;
  try {
    const url = new URL(env.APP_BASE_URL || '');
    if (url.protocol === 'https:' && !url.username && !url.password &&
        !url.port && url.pathname === '/' && !url.search && !url.hash &&
        !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) &&
        !url.hostname.endsWith('.localhost') && url.hostname.includes('.')) {
      baseUrl = url.origin;
    }
  } catch { /* Missing/invalid configuration is reported without exposing secrets. */ }
  const configured = /^(TEST-|APP_USR-)[A-Za-z0-9-]+$/.test(token) && Boolean(baseUrl);
  return { token, baseUrl, configured };
}

export function createPaymentService({ config = readConfig(), fetcher = fetch, now = Date.now } = {}) {
  let sellerCache;
  let sellerPending;
  const requireConfig = () => {
    if (!config.configured) throw new AppError(503, 'NOT_CONFIGURED',
      'Falta configurar el Access Token de prueba y la URL pública HTTPS en el backend.');
  };

  async function request(path, { method = 'GET', body } = {}) {
    requireConfig();
    let response;
    try {
      response = await fetcher(`https://api.mercadopago.com${path}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(12000),
        headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      throw new AppError(502, 'PROVIDER_UNAVAILABLE',
        'Mercado Pago no respondió. Espera unos segundos y vuelve a intentarlo.');
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new AppError(502, 'PROVIDER_AUTH',
          'Mercado Pago rechazó las credenciales. Revisa el Access Token de prueba del vendedor.');
      }
      if (response.status === 404) throw new AppError(404, 'PAYMENT_NOT_FOUND',
        'El pago todavía no está disponible. Puedes volver a consultar.');
      throw new AppError(502, 'PROVIDER_ERROR',
        'Mercado Pago rechazó la solicitud. Revisa la configuración del entorno de prueba.');
    }
    try {
      const result = await response.json();
      if (!result || typeof result !== 'object') throw new Error();
      return result;
    } catch {
      throw new AppError(502, 'INVALID_PROVIDER_RESPONSE', 'Mercado Pago devolvió una respuesta inválida.');
    }
  }

  async function testSeller() {
    requireConfig();
    if (sellerCache && now() < sellerCache.expiresAt) return sellerCache.id;
    if (sellerPending) return sellerPending;
    sellerPending = (async () => {
      const seller = await request('/users/me');
      // APP_USR is also used for modern TEST accounts: the prefix alone proves nothing.
      const isTest = config.token.startsWith('TEST-') || seller.tags?.includes('test_user');
      if (!isTest || !Number.isSafeInteger(seller.id) || seller.id <= 0 || seller.site_id !== 'MLC') {
        throw new AppError(503, 'TEST_SELLER_REQUIRED',
          'Se requiere un vendedor de prueba de Chile. Las cuentas reales están bloqueadas.');
      }
      sellerCache = { id: seller.id, expiresAt: now() + 5 * 60 * 1000 };
      return seller.id;
    })().finally(() => { sellerPending = undefined; });
    return sellerPending;
  }

  function signature(payload) {
    return createHmac('sha256', config.token).update(`academic-sandbox-order:${payload}`).digest('base64url');
  }

  function createOrder() {
    const order = { id: randomUUID(), productId: PRODUCT.id, amount: PRODUCT.price,
      currency: PRODUCT.currency, createdAt: now() };
    const payload = Buffer.from(JSON.stringify(order)).toString('base64url');
    return { order, orderToken: `${payload}.${signature(payload)}` };
  }

  function verifyOrder(value) {
    requireConfig();
    try {
      if (typeof value !== 'string' || value.length > 1200 || !/^[\w-]+\.[\w-]+$/.test(value)) throw new Error();
      const [payload, signed] = value.split('.');
      const expected = Buffer.from(signature(payload));
      const supplied = Buffer.from(signed);
      if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error();
      const order = JSON.parse(Buffer.from(payload, 'base64url').toString());
      const age = now() - order.createdAt;
      if (!/^[a-f0-9-]{36}$/.test(order.id) || order.productId !== PRODUCT.id ||
          order.amount !== PRODUCT.price || order.currency !== PRODUCT.currency ||
          !Number.isSafeInteger(order.createdAt) || age < 0 || age > 24 * 60 * 60 * 1000) throw new Error();
      return order;
    } catch {
      throw new AppError(400, 'INVALID_ORDER', 'La compra no es válida o venció. Inicia una nueva compra.');
    }
  }

  async function createPreference(productId) {
    if (productId !== PRODUCT.id) throw new AppError(400, 'INVALID_PRODUCT', 'El producto no es válido.');
    await testSeller(); // Never create a preference with a real-seller credential.
    const { order, orderToken } = createOrder();
    const returnUrl = `${config.baseUrl}/resultado?order=${encodeURIComponent(orderToken)}`;
    const preference = await request('/checkout/preferences', {
      method: 'POST', body: {
        items: [{ id: PRODUCT.id, title: PRODUCT.name, description: PRODUCT.description,
          quantity: PRODUCT.quantity, unit_price: PRODUCT.price, currency_id: PRODUCT.currency }],
        external_reference: order.id,
        back_urls: { success: returnUrl, failure: returnUrl, pending: returnUrl },
        auto_return: 'approved',
      },
    });
    // Legacy TEST keys use sandbox_init_point; current test-user APP_USR keys use init_point.
    // The latter is accepted ONLY after verifying the seller's test_user tag above.
    const checkout = config.token.startsWith('TEST-') ? preference.sandbox_init_point : preference.init_point;
    let target;
    try { target = new URL(checkout); } catch { /* Fail closed below. */ }
    const expectedHosts = config.token.startsWith('TEST-')
      ? ['sandbox.mercadopago.cl', 'sandbox.mercadopago.com']
      : ['www.mercadopago.cl', 'www.mercadopago.com', 'mercadopago.cl', 'mercadopago.com'];
    if (!preference.id || !target || target.protocol !== 'https:' || target.username || target.password ||
        target.port || !expectedHosts.includes(target.hostname)) {
      throw new AppError(502, 'INVALID_CHECKOUT', 'Mercado Pago no entregó una dirección de pago de prueba válida.');
    }
    return { preferenceId: String(preference.id), checkoutUrl: target.href, orderToken, mode: 'sandbox' };
  }

  async function getResult({ orderToken, paymentId }) {
    const order = verifyOrder(orderToken);
    // Return query-string status values are never treated as evidence of payment.
    if (!paymentId || paymentId === 'null' || paymentId === 'undefined') {
      return { verified: false, status: 'unconfirmed', orderId: order.id,
        message: 'Regresaste sin un identificador de pago. No se ha confirmado ninguna compra.' };
    }
    if (!/^\d{1,25}$/.test(paymentId)) throw new AppError(400, 'INVALID_PAYMENT_ID', 'El identificador de pago no es válido.');
    const sellerId = await testSeller();
    const payment = await request(`/v1/payments/${paymentId}`);
    if (payment.live_mode !== false || String(payment.id) !== paymentId ||
        payment.external_reference !== order.id || payment.transaction_amount !== order.amount ||
        payment.currency_id !== order.currency || payment.collector_id !== sellerId) {
      throw new AppError(409, 'PAYMENT_MISMATCH',
        'No se pudo asociar este pago de prueba con la compra. No se confirmará como aprobado.');
    }
    const knownStatuses = ['approved', 'pending', 'in_process', 'authorized', 'rejected',
      'cancelled', 'refunded', 'charged_back', 'in_mediation'];
    const status = knownStatuses.includes(payment.status) ? payment.status : 'unknown';
    return { verified: true, status, paymentId: String(payment.id), orderId: order.id,
      amount: payment.transaction_amount, currency: payment.currency_id, mode: 'sandbox' };
  }

  return { createPreference, getResult, configured: config.configured, baseUrl: config.baseUrl };
}
