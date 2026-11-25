import { AppError, PRODUCT, createPaymentService } from './payments.js';

export function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  if (req.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new AppError(415, 'JSON_REQUIRED', 'Envía la solicitud en formato JSON.');
  }
  // Vercel pre-parses JSON into req.body; native Node exposes a readable stream.
  let body = '';
  if (req.body !== undefined) {
    body = typeof req.body === 'string' ? req.body : Buffer.isBuffer(req.body)
      ? req.body.toString('utf8') : JSON.stringify(req.body);
  } else {
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 2048) throw new AppError(413, 'BODY_TOO_LARGE', 'La solicitud es demasiado grande.');
    }
  }
  if (Buffer.byteLength(body) > 2048) throw new AppError(413, 'BODY_TOO_LARGE', 'La solicitud es demasiado grande.');
  try { return JSON.parse(body); } catch {
    throw new AppError(400, 'INVALID_JSON', 'La solicitud contiene JSON inválido.');
  }
}

export function createApi({ service = createPaymentService() } = {}) {
  return async function api(req, res) {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/api/product' && req.method === 'GET') {
        return json(res, 200, { product: PRODUCT, configured: service.configured, mode: 'sandbox' });
      }
      if (url.pathname === '/api/preferences' && req.method === 'POST') {
        // Same-origin POST only. No permissive CORS and no browser-supplied price.
        const origin = req.headers.origin;
        const localOrigin = `http://${req.headers.host}`;
        if (origin && origin !== service.baseUrl && origin !== localOrigin) {
          throw new AppError(403, 'INVALID_ORIGIN', 'La solicitud debe originarse en esta aplicación.');
        }
        const body = await readJson(req);
        if (!body || typeof body !== 'object' || Array.isArray(body) ||
            Object.keys(body).length !== 1 || typeof body.productId !== 'string') {
          throw new AppError(400, 'INVALID_REQUEST', 'Envía únicamente el identificador del producto.');
        }
        return json(res, 201, await service.createPreference(body.productId));
      }
      if (url.pathname === '/api/result' && req.method === 'GET') {
        return json(res, 200, await service.getResult({
          orderToken: url.searchParams.get('order'), paymentId: url.searchParams.get('payment_id'),
        }));
      }
      const known = ['/api/product', '/api/preferences', '/api/result'].includes(url.pathname);
      if (known) res.setHeader('Allow', url.pathname === '/api/preferences' ? 'POST' : 'GET');
      return json(res, known ? 405 : 404, { error: { code: known ? 'METHOD_NOT_ALLOWED' : 'NOT_FOUND',
        message: known ? 'Método no permitido.' : 'La ruta no existe.' } });
    } catch (error) {
      // Do not echo provider bodies, request URLs, credentials or personal data.
      const expected = error instanceof AppError;
      if (!expected) console.error('Unexpected API error:', error?.name || 'Error');
      return json(res, expected ? error.status : 500, { error: {
        code: expected ? error.code : 'INTERNAL_ERROR',
        message: expected ? error.message : 'Ocurrió un error interno. Vuelve a intentarlo.',
      } });
    }
  };
}
