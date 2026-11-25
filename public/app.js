const $ = (id) => document.getElementById(id);
const money = (amount) => new Intl.NumberFormat('es-CL', {
  style: 'currency', currency: 'CLP', maximumFractionDigits: 0,
}).format(amount);

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, { ...options, cache: 'no-store', signal: AbortSignal.timeout(45000) });
  } catch {
    throw new Error('No se pudo conectar con el servidor. Revisa tu conexión y vuelve a intentarlo.');
  }
  let data;
  try { data = await response.json(); } catch { throw new Error('El servidor devolvió una respuesta inválida.'); }
  if (!response.ok) throw new Error(data.error?.message || 'No se pudo completar la solicitud.');
  return data;
}

async function loadProduct() {
  $('reload').hidden = true;
  $('buy').disabled = true;
  $('buy-message').textContent = 'Cargando…';
  try {
    const { product, configured } = await api('/api/product');
    $('product-name').textContent = product.name;
    $('product-description').textContent = product.description;
    $('product-price').textContent = `${money(product.price)} CLP · 1 unidad`;
    $('buy').disabled = !configured;
    $('buy-message').textContent = configured ? 'El pago se realizará fuera de esta página, en Mercado Pago.'
      : 'El producto está disponible para la demostración. Falta configurar las credenciales de prueba y la URL pública en el backend para habilitar la compra.';
    $('buy').onclick = async () => {
      $('buy').disabled = true;
      $('buy-message').textContent = 'Creando preferencia de pago de prueba…';
      try {
        const result = await api('/api/preferences', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ productId: product.id }) });
        // Keep a fallback for redirects that omit custom return query parameters.
        try { sessionStorage.setItem('sandbox-order', result.orderToken); } catch { /* The return URL also carries it. */ }
        $('buy-message').textContent = 'Redirigiendo a Mercado Pago…';
        window.location.assign(result.checkoutUrl);
      } catch (error) {
        $('buy-message').textContent = error.message;
        $('buy').disabled = false;
      }
    };
  } catch (error) {
    $('product-name').textContent = 'No se pudo cargar el producto';
    $('buy-message').textContent = error.message;
    $('reload').hidden = false;
  }
}

const messages = {
  approved: ['Pago de prueba aprobado', 'Mercado Pago confirmó la aprobación de la compra simulada.'],
  pending: ['Pago de prueba pendiente', 'El pago todavía está pendiente. Puedes consultar nuevamente.'],
  in_process: ['Pago de prueba en proceso', 'Mercado Pago todavía está procesando el pago.'],
  authorized: ['Pago de prueba autorizado', 'El pago está autorizado, pero todavía no se ha confirmado su captura.'],
  rejected: ['Pago de prueba rechazado', 'Mercado Pago rechazó la operación simulada. Puedes iniciar otra compra.'],
  cancelled: ['Pago de prueba cancelado', 'Mercado Pago confirmó que la operación fue cancelada.'],
  refunded: ['Pago de prueba reembolsado', 'Mercado Pago informa que el pago fue reembolsado.'],
  charged_back: ['Pago de prueba con contracargo', 'Mercado Pago informa un contracargo.'],
  in_mediation: ['Pago de prueba en mediación', 'El pago está en mediación; no se considera una compra aprobada.'],
  unknown: ['Estado no reconocido', 'El proveedor devolvió un estado que esta aplicación todavía no reconoce.'],
  unconfirmed: ['Compra sin confirmar', 'Regresaste sin un identificador de pago. No se ha confirmado ninguna compra.'],
};

function detail(label, value) {
  const term = document.createElement('dt');
  const description = document.createElement('dd');
  term.textContent = label;
  description.textContent = value;
  $('result-details').append(term, description);
}

async function loadResult() {
  $('retry').hidden = true;
  $('result-title').textContent = 'Verificando resultado…';
  $('result-message').textContent = 'Consultando el estado al backend…';
  $('result-details').replaceChildren();
  try {
    const params = new URLSearchParams(window.location.search);
    let order = params.get('order');
    if (!order) { try { order = sessionStorage.getItem('sandbox-order'); } catch { /* Validation is on the server. */ } }
    if (!order) throw new Error('No se encontró una compra para verificar. Vuelve al producto e inicia una compra.');
    const paymentId = params.get('payment_id') || params.get('collection_id');
    const query = new URLSearchParams({ order });
    if (paymentId) query.set('payment_id', paymentId);
    const result = await api(`/api/result?${query}`);
    const [title, message] = messages[result.status] || messages.unknown;
    $('result-title').textContent = title;
    $('result-message').textContent = message;
    detail('Verificación', result.verified ? 'Consultado directamente a Mercado Pago · Modo prueba' : 'Sin confirmación de pago');
    detail('Referencia de compra', result.orderId);
    if (result.paymentId) detail('Identificador de pago', result.paymentId);
    if (result.amount !== undefined) detail('Total', `${money(result.amount)} ${result.currency}`);
    $('retry').hidden = !['pending', 'in_process', 'authorized', 'unknown', 'in_mediation'].includes(result.status);
  } catch (error) {
    $('result-title').textContent = 'No se pudo verificar el pago';
    $('result-message').textContent = error.message;
    $('retry').hidden = false;
  }
}

$('reload').addEventListener('click', loadProduct);
$('retry').addEventListener('click', loadResult);
if (window.location.pathname.replace(/\/$/, '') === '/resultado') {
  $('product-section').hidden = true;
  $('result-section').hidden = false;
  loadResult();
} else {
  loadProduct();
}
