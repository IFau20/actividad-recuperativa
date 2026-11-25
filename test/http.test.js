import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.js';
import { createApi } from '../backend/app.js';
import { createPaymentService, readConfig } from '../backend/payments.js';

test('HTTP flow: product → preference → provider result; static and API protections', async (t) => {
  let reference;
  const config = readConfig({ MP_ACCESS_TOKEN: 'TEST-http-credential', APP_BASE_URL: 'https://shop.example.com' });
  const fetcher = async (url, options) => {
    if (url.endsWith('/users/me')) return Response.json({ id: 123, site_id: 'MLC', tags: ['test_user'] });
    if (url.endsWith('/checkout/preferences')) {
      reference = JSON.parse(options.body).external_reference;
      return Response.json({ id: 'preference', sandbox_init_point: 'https://sandbox.mercadopago.cl/checkout/test' });
    }
    return Response.json({ id: 456, external_reference: reference, transaction_amount: 1000,
      currency_id: 'CLP', collector_id: 123, live_mode: false, status: 'rejected' });
  };
  const server = createApp({ service: createPaymentService({ config, fetcher }) });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, options) => fetch(`${base}${path}`, options);
  const post = (body, extra = {}) => ({ method: 'POST', headers: { 'Content-Type': 'application/json', ...extra },
    body: typeof body === 'string' ? body : JSON.stringify(body) });

  const product = await (await request('/api/product')).json();
  assert.equal(product.product.name, 'Cuaderno universitario');
  assert.equal(product.product.price, 1000);
  assert.equal(product.configured, true);
  assert.equal(JSON.stringify(product).includes(config.token), false);

  const preferenceResponse = await request('/api/preferences', post({ productId: product.product.id }));
  assert.equal(preferenceResponse.status, 201);
  const preference = await preferenceResponse.json();
  const params = new URLSearchParams({ order: preference.orderToken, payment_id: '456', status: 'approved' });
  const result = await (await request(`/api/result?${params}`)).json();
  assert.equal(result.status, 'rejected'); // Query-string status=approved has no effect.
  assert.equal(result.verified, true);

  for (const body of [{ productId: product.product.id, price: 1 }, {}, [], null, '{invalid']) {
    assert.equal((await request('/api/preferences', post(body))).status, 400);
  }
  assert.equal((await request('/api/preferences', post({ productId: product.product.id }, { Origin: 'https://evil.example' }))).status, 403);
  assert.equal((await request('/api/preferences', { method: 'POST', body: '{}' })).status, 415);
  assert.equal((await request('/api/preferences', post('x'.repeat(2049)))).status, 413);
  assert.equal((await request('/api/preferences')).status, 405);
  assert.equal((await request('/api/product', { method: 'POST' })).status, 405);
  assert.equal((await request('/api/result')).status, 400);
  assert.equal((await request('/api/unknown')).status, 404);
  assert.equal((await request('/.env')).status, 404);
  assert.equal((await request('/backend/payments.js')).status, 404);
  for (const path of ['/', '/resultado', '/app.js', '/style.css']) {
    const response = await request(path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal((await response.text()).includes(config.token), false);
  }
});

test('Vercel pre-parsed bodies work just like native Node request streams', async () => {
  let received;
  const api = createApi({ service: { configured: true, baseUrl: 'https://shop.example.com',
    createPreference: async (id) => { received = id; return { preferenceId: 'test' }; } } });
  const req = { url: '/api/preferences', method: 'POST',
    headers: { 'content-type': 'application/json' }, body: { productId: 'notebook-01' } };
  const res = { writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
  await api(req, res);
  assert.equal(res.status, 201);
  assert.equal(received, 'notebook-01');
});
