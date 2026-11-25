import test from 'node:test';
import assert from 'node:assert/strict';
import { PRODUCT, createPaymentService, readConfig } from '../backend/payments.js';

const config = readConfig({ MP_ACCESS_TOKEN: 'TEST-test-credential', APP_BASE_URL: 'https://shop.example.com' });
const seller = { id: 123, site_id: 'MLC', tags: ['test_user'] };
const preference = { id: '123-pref', sandbox_init_point: 'https://sandbox.mercadopago.cl/checkout/v1/redirect?pref_id=123-pref',
  init_point: 'https://www.mercadopago.cl/checkout/v1/redirect?pref_id=123-pref' };
const response = (data, status = 200) => new Response(JSON.stringify(data), { status });

function harness({ useConfig = config, clock = () => 100000, sellerData = seller, preferenceData = preference,
  paymentPatch = {}, paymentStatus = 'approved', override } = {}) {
  const calls = [];
  let orderId;
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (override) { const result = await override(url, options); if (result) return result; }
    if (url.endsWith('/users/me')) return response(sellerData);
    if (url.endsWith('/checkout/preferences')) {
      orderId = JSON.parse(options.body).external_reference;
      return response(preferenceData, 201);
    }
    if (url.includes('/v1/payments/')) return response({ id: 456, external_reference: orderId,
      transaction_amount: 1000, currency_id: 'CLP', collector_id: 123,
      live_mode: false, status: paymentStatus, ...paymentPatch });
    throw new Error('Unexpected URL');
  };
  const service = createPaymentService({ config: useConfig, fetcher, now: clock });
  return { service, calls };
}

test('configuration requires a token and a public HTTPS origin', () => {
  assert.equal(config.configured, true);
  for (const origin of ['', 'http://shop.example.com', 'https://localhost', 'https://127.0.0.1',
    'https://a.localhost', 'https://shop.example.com/path', 'https://user:secret@shop.example.com',
    'https://shop.example.com?x=1', 'https://shop.example.com#x', 'https://shop.example.com:123']) {
    assert.equal(readConfig({ MP_ACCESS_TOKEN: 'TEST-token', APP_BASE_URL: origin }).configured, false, origin);
  }
  assert.equal(readConfig({ APP_BASE_URL: 'https://shop.example.com' }).configured, false);
});

test('creates an API preference using server-owned product, three return URLs and signed order', async () => {
  const { service, calls } = harness();
  const result = await service.createPreference(PRODUCT.id);
  assert.equal(result.mode, 'sandbox');
  assert.match(result.checkoutUrl, /^https:\/\/sandbox\.mercadopago\.cl\//);
  const request = calls.find((call) => call.url.endsWith('/checkout/preferences'));
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers.Authorization, `Bearer ${config.token}`);
  const body = JSON.parse(request.options.body);
  assert.equal(body.items[0].unit_price, 1000);
  assert.equal(body.items[0].quantity, 1);
  assert.equal(body.items[0].currency_id, 'CLP');
  assert.equal(body.auto_return, 'approved');
  for (const value of Object.values(body.back_urls)) {
    const url = new URL(value);
    assert.equal(url.origin, config.baseUrl);
    assert.equal(url.pathname, '/resultado');
    assert.equal(url.searchParams.get('order'), result.orderToken);
  }
  assert.equal(JSON.stringify(result).includes(config.token), false);
});

test('current APP_USR test-seller credentials work, but real sellers are blocked before preference creation', async () => {
  const modernConfig = { ...config, token: 'APP_USR-test-seller' };
  const allowed = harness({ useConfig: modernConfig });
  assert.match((await allowed.service.createPreference(PRODUCT.id)).checkoutUrl, /^https:\/\/www\.mercadopago\.cl\//);
  for (const sellerData of [{ ...seller, tags: [] }, { ...seller, tags: ['normal'] },
    { ...seller, site_id: 'MLA' }, { ...seller, id: null }]) {
    const blocked = harness({ useConfig: modernConfig, sellerData });
    await assert.rejects(blocked.service.createPreference(PRODUCT.id), { code: 'TEST_SELLER_REQUIRED' });
    assert.equal(blocked.calls.length, 1);
  }
});

test('missing credentials and unknown product never call Mercado Pago', async () => {
  const empty = harness({ useConfig: readConfig({}) });
  await assert.rejects(empty.service.createPreference(PRODUCT.id), { code: 'NOT_CONFIGURED' });
  assert.equal(empty.calls.length, 0);
  const known = harness();
  await assert.rejects(known.service.createPreference('fake-product'), { code: 'INVALID_PRODUCT' });
  assert.equal(known.calls.length, 0);
});

test('untrusted checkout URLs and missing checkout URLs fail closed', async () => {
  for (const url of [undefined, 'javascript:alert(1)', 'http://sandbox.mercadopago.cl/x',
    'https://evil.example/x', 'https://sandbox.mercadopago.cl.evil.example/x',
    'https://user:secret@sandbox.mercadopago.cl/x', 'https://sandbox.mercadopago.cl:123/x']) {
    const { service } = harness({ preferenceData: { ...preference, sandbox_init_point: url } });
    await assert.rejects(service.createPreference(PRODUCT.id), { code: 'INVALID_CHECKOUT' });
  }
});

for (const status of ['approved', 'pending', 'in_process', 'authorized', 'rejected', 'cancelled',
  'refunded', 'charged_back', 'in_mediation', 'future_status']) {
  test(`verifies payment against provider data: ${status}`, async () => {
    const { service } = harness({ paymentStatus: status });
    const { orderToken } = await service.createPreference(PRODUCT.id);
    const result = await service.getResult({ orderToken, paymentId: '456', status: 'approved' });
    assert.equal(result.status, status === 'future_status' ? 'unknown' : status);
    assert.equal(result.verified, true);
    assert.equal(result.amount, 1000);
  });
}

for (const patch of [{ live_mode: true }, { live_mode: undefined }, { transaction_amount: 1 },
  { currency_id: 'USD' }, { external_reference: 'another-order' }, { collector_id: 987 }, { id: 999 }]) {
  test(`rejects unrelated/real/mismatched payment: ${JSON.stringify(patch)}`, async () => {
    const { service } = harness({ paymentPatch: patch });
    const { orderToken } = await service.createPreference(PRODUCT.id);
    await assert.rejects(service.getResult({ orderToken, paymentId: '456' }), { code: 'PAYMENT_MISMATCH' });
  });
}

test('return with no payment ID remains unconfirmed, never approved', async () => {
  const { service, calls } = harness();
  const { orderToken } = await service.createPreference(PRODUCT.id);
  for (const paymentId of [null, '', 'null', 'undefined']) {
    const result = await service.getResult({ orderToken, paymentId, status: 'approved' });
    assert.equal(result.status, 'unconfirmed');
    assert.equal(result.verified, false);
  }
  assert.equal(calls.length, 2);
});

test('tampered, future, expired and missing orders fail before payment lookup', async () => {
  let time = 100000;
  const { service, calls } = harness({ clock: () => time });
  const { orderToken } = await service.createPreference(PRODUCT.id);
  for (const value of [null, '', 'a.b', `${orderToken}x`, `${orderToken.split('.')[0]}.invalid`]) {
    await assert.rejects(service.getResult({ orderToken: value, paymentId: '456' }), { code: 'INVALID_ORDER' });
  }
  time = 99999;
  await assert.rejects(service.getResult({ orderToken, paymentId: '456' }), { code: 'INVALID_ORDER' });
  time = 100000 + 86400001;
  await assert.rejects(service.getResult({ orderToken, paymentId: '456' }), { code: 'INVALID_ORDER' });
  assert.equal(calls.length, 2);
});

test('invalid payment IDs cannot escape the fixed provider endpoint', async () => {
  const { service } = harness();
  const { orderToken } = await service.createPreference(PRODUCT.id);
  for (const paymentId of ['../users/me', 'https://evil.example', '-1', '123abc']) {
    await assert.rejects(service.getResult({ orderToken, paymentId }), { code: 'INVALID_PAYMENT_ID' });
  }
});

test('provider errors, invalid JSON and timeouts produce safe errors', async () => {
  for (const [status, code] of [[401, 'PROVIDER_AUTH'], [403, 'PROVIDER_AUTH'], [404, 'PAYMENT_NOT_FOUND'],
    [429, 'PROVIDER_ERROR'], [500, 'PROVIDER_ERROR']]) {
    const { service } = harness({ override: () => response({ secret: config.token }, status) });
    await assert.rejects(service.createPreference(PRODUCT.id), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.message.includes(config.token), false);
      return true;
    });
  }
  const malformed = harness({ override: () => new Response('not JSON') });
  await assert.rejects(malformed.service.createPreference(PRODUCT.id), { code: 'INVALID_PROVIDER_RESPONSE' });
  const timeout = harness({ override: () => { throw new DOMException('timeout', 'TimeoutError'); } });
  await assert.rejects(timeout.service.createPreference(PRODUCT.id), { code: 'PROVIDER_UNAVAILABLE' });
});

test('signed orders survive separate server instances without in-memory persistence', async () => {
  const first = harness();
  const { orderToken } = await first.service.createPreference(PRODUCT.id);
  const order = JSON.parse(Buffer.from(orderToken.split('.')[0], 'base64url'));
  const second = harness({ paymentPatch: { external_reference: order.id } });
  assert.equal((await second.service.getResult({ orderToken, paymentId: '456' })).status, 'approved');
});
