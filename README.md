# Mercado Pago · Checkout de prueba

Aplicación web de un producto con integración a Checkout Pro de Mercado Pago. Frontend en HTML, CSS y JavaScript; backend en Node.js, sin dependencias externas.

## Funcionamiento

- Muestra un cuaderno universitario de $1.000 CLP.
- Crea la preferencia de pago desde el backend y redirige al checkout de prueba.
- Al regresar, consulta la API para verificar el estado, importe, moneda y referencia de la compra.
- Muestra pagos aprobados, pendientes, rechazados y cancelados. Volver sin identificador de pago no confirma una compra.

La integración admite únicamente pagos de prueba de Chile. El Access Token permanece en el backend y el precio se define en el servidor.

## Requisitos

- Node.js 22 o superior.
- Credenciales de prueba de Mercado Pago Checkout Pro.
- Cuentas de prueba de vendedor y comprador de Chile, distintas entre sí.
- Una URL pública HTTPS para el retorno del checkout.

## Configuración y ejecución

```sh
npm ci
```

Copia `.env.example` a `.env` y completa las variables:

```dotenv
MP_ACCESS_TOKEN=ACCESS_TOKEN_DE_PRUEBA
APP_BASE_URL=https://tu-dominio.example
PORT=3000
```

`APP_BASE_URL` debe ser el origen público HTTPS de la aplicación, sin rutas. Para desarrollo local, utiliza un túnel HTTPS al puerto 3000 para recibir el retorno de Mercado Pago.

```sh
npm start
```

Servidor local: `http://localhost:3000`. Para completar el flujo de pago, accede desde la URL pública configurada. Reinicia el servidor después de modificar `.env`.

El producto puede consultarse sin configuración; la compra se habilita cuando están definidas las variables. No publiques `.env` ni las credenciales.

## Uso del entorno de prueba

Utiliza el Access Token del entorno **Prueba**, una cuenta compradora de prueba y las [tarjetas de prueba oficiales](https://www.mercadopago.cl/developers/es/docs/checkout-pro-preferences/integration-test/test-purchases).

Los tokens de vendedores de prueba pueden comenzar con `APP_USR-`: el backend comprueba que pertenezcan a un usuario de prueba antes de crear la preferencia. También admite tokens `TEST-`. Rechaza pagos con `live_mode: true` y no confía en el estado recibido como parámetro de la URL.

La verificación ocurre al regresar del checkout; no utiliza webhooks. Las referencias de compra están firmadas y vencen a las 24 horas.

## Despliegue en Vercel

El repositorio incluye `vercel.json` y el adaptador `api/index.js`.

- Framework: **Other**.
- Output Directory: **public**.
- Build Command: vacío.
- Variables del servidor: `MP_ACCESS_TOKEN` y `APP_BASE_URL`.

Vuelve a desplegar después de cambiar las variables. La URL configurada debe ser accesible desde el navegador al regresar de Mercado Pago.

## Pruebas

```sh
npm run check
npm test
```

Las pruebas verifican el flujo HTTP, la creación de preferencias, los estados de pago, la validación de datos y el manejo de errores. Utilizan respuestas controladas de la API externa; la prueba completa requiere realizar una compra en el checkout de Mercado Pago con credenciales de prueba.

## Estructura

- `public/`: interfaz y comunicación con el backend.
- `backend/payments.js`: producto e integración con Mercado Pago.
- `backend/app.js`: endpoints y validación de solicitudes.
- `server.js`: servidor local.
- `api/index.js`: función para Vercel.
- `test/`: pruebas automatizadas.

Documentación: [Mercado Pago Developers](https://www.mercadopago.cl/developers/es/docs/checkout-pro-preferences/overview).
