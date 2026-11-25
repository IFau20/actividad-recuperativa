# Actividad recuperativa: Mercado Pago

Aplicación de un producto con Checkout Pro, exclusivamente para **compras simuladas**. Interfaz sencilla en HTML/CSS/JavaScript y backend Node.js 22 o superior, sin dependencias externas. Se usa la API REST oficial; no se necesita un framework ni una Public Key porque el checkout se abre por redirección.

## Qué implementa

1. Muestra un cuaderno universitario de **$1.000 CLP**, una unidad.
2. El botón envía `POST /api/preferences` con el identificador del producto.
3. El backend valida al vendedor de prueba y crea la preferencia en `POST https://api.mercadopago.com/checkout/preferences`. El nombre, precio, moneda y cantidad se fijan en el servidor.
4. El navegador abre la dirección de Checkout Pro devuelta por Mercado Pago, usando una cuenta vendedora de prueba.
5. Las tres URLs de retorno llevan a `/resultado`. El frontend pide al backend verificar el pago en `GET /v1/payments/{id}` y muestra aprobado, pendiente, rechazado, cancelado u otro estado real devuelto por la API.

**No se confía en `status=approved` de la URL.** Se comprueban la referencia de compra firmada, el importe, la moneda, el vendedor y `live_mode === false`. Volver sin un ID de pago se muestra como compra sin confirmar.

## Configuración de prueba

### 1. Preparar Mercado Pago

1. Ingresa a [Mercado Pago Developers](https://www.mercadopago.cl/developers/panel/app).
2. Crea una aplicación para pagos online con **Checkout Pro**.
3. Selecciona el entorno **Prueba** en el panel y copia el **Access Token de prueba**, nunca una credencial de una cuenta real en entorno Producción.
4. En **Cuentas de prueba**, ubica o crea un vendedor y un comprador de **Chile**. Deben ser cuentas distintas. Para el checkout usa el comprador, nunca el vendedor.
5. Conserva el usuario, contraseña y código de verificación de seis dígitos del comprador para el checkout. No los agregues al código ni al repositorio.

El Access Token de pruebas de Checkout Pro puede comenzar con `APP_USR-` en la integración actual. El prefijo no distingue por sí solo el entorno: el backend consulta `/users/me` y exige la etiqueta `test_user` para estos tokens. Bloquea vendedores reales y cuentas de otro país. Las claves antiguas `TEST-` también están contempladas.

Con `TEST-` se abre `sandbox_init_point`. Con un `APP_USR-` de vendedor **verificado como usuario de prueba** se abre `init_point`, conforme al flujo de cuentas de prueba. Esto no autoriza pagos reales: no hay modo de producción en esta aplicación y los resultados con `live_mode: true` se rechazan.

### 2. Ejecutar localmente

Instala Node.js **22 o superior**. Desde la carpeta del repositorio:

```powershell
npm ci
Copy-Item .env.example .env
notepad .env
npm start
```

En `.env`, configura:

```dotenv
MP_ACCESS_TOKEN=TU_ACCESS_TOKEN_DE_PRUEBA
APP_BASE_URL=https://TU-DOMINIO-PUBLICO
PORT=3000
```

Abre `http://localhost:3000`. El producto se puede ver sin credenciales; el pago permanece deshabilitado si falta configuración. Reinicia `npm start` al modificar `.env`.

**Para regresar del checkout se necesita una URL pública HTTPS**: Mercado Pago desaconseja `localhost` y `127.0.0.1` en `back_urls`. Publica la aplicación o utiliza un túnel HTTPS a tu puerto 3000. `APP_BASE_URL` debe ser exactamente ese origen, sin rutas. Para la demostración, abre y compra desde la URL pública para que el retorno ocurra en la misma aplicación.

### 3. Publicar en Vercel

El repositorio ya incluye la función Node y las rutas para Vercel:

1. Importa este repositorio como un proyecto en Vercel. Framework: **Other**. Output Directory: **public**. Sin Build Command.
2. En **Settings → Environment Variables**, agrega `MP_ACCESS_TOKEN` con la credencial de **prueba**. Debe existir solo como variable del servidor, sin prefijos `VITE_`, `NEXT_PUBLIC_` u otros que la expongan al navegador.
3. Agrega `APP_BASE_URL` con la URL pública HTTPS del proyecto, por ejemplo `https://tu-proyecto.vercel.app`.
4. Despliega o vuelve a desplegar para aplicar las variables.
5. Si el acceso está protegido por la autenticación de Vercel, desactiva esa protección en el despliegue de la actividad para permitir el retorno desde Mercado Pago y la revisión del profesor.
6. Abre la URL pública. Confirma producto/precio, compra, checkout y retorno. No basta con que la página inicial cargue.

Nunca subas `.env`, el token ni contraseñas al repositorio. No hace falta Supabase: la referencia de compra está firmada con HMAC y puede validarse en otra instancia del backend sin depender de memoria temporal. La firma no cifra la información: contiene solo ID, producto, importe, moneda y fecha, sin datos personales. Las referencias vencen a las 24 horas.

## Hacer la compra simulada

1. Abre la aplicación pública en una ventana de incógnito. Inicia la compra.
2. En Mercado Pago, inicia sesión con el **comprador de prueba** de Chile.
3. Usa una [tarjeta de prueba oficial](https://www.mercadopago.cl/developers/es/docs/checkout-pro-preferences/integration-test/test-purchases), nunca datos bancarios personales. Consulta la tabla vigente de tu país en esa documentación.
4. Para un resultado aprobado, utiliza `APRO` como titular; para rechazo, `OTHE`; para pendiente, `CONT`, según las instrucciones oficiales. Completa el documento de prueba solicitado por el checkout.
5. Finaliza el pago y presiona **Volver al sitio** si no regresa automáticamente. La redirección automática de los aprobados puede demorar hasta 40 segundos.
6. La aplicación consulta la API y muestra el resultado verificado y el ID. Si está pendiente, el botón **Consultar nuevamente** actualiza el estado sin crear otro pago.

Si cierras el checkout sin volver al sitio, no hay una confirmación automática en la aplicación. Esta actividad comprueba el pago al regresar; no implementa webhooks, inventario ni entrega de productos. No es una tienda de producción.

## Pruebas y estado de validación

```sh
npm run check
npm test
```

Las pruebas cubren creación de preferencias, retorno aprobado/pendiente/rechazado y otros estados, manipulación de precios y referencias, pagos ajenos o reales, credenciales faltantes, vendedores reales bloqueados, errores de red/proveedor, URLs inseguras, expiración y API HTTP. Incluyen el cuerpo JSON preprocesado de Vercel y referencias entre instancias distintas.

**Las pruebas automatizadas sustituyen la API externa con respuestas controladas. No constituyen una compra ejecutada en el Sandbox de Mercado Pago.** Para validar la integración completa y grabar el video hay que configurar credenciales de prueba y completar una compra en el checkout externo.

## Explicación del código

| Archivo | Responsabilidad |
| --- | --- |
| `public/index.html` | Producto, botón y pantalla del resultado. |
| `public/app.js` | Carga el producto, crea la preferencia mediante `fetch`, redirige y solicita la verificación del pago. Usa `textContent` para mostrar datos. |
| `public/style.css` | Estilos básicos y adaptación a móvil. |
| `backend/payments.js` | Producto, configuración, verificación del vendedor de prueba, cliente de la API, referencias firmadas y validación del pago. Es el único módulo que usa el Access Token. |
| `backend/app.js` | Endpoints HTTP, validación de solicitudes y errores sin exponer secretos. |
| `server.js` | Servidor local y archivos públicos permitidos. |
| `api/index.js` | Adaptador del mismo backend para Vercel. |
| `test/` | Pruebas con la API externa controlada. |

El flujo es **navegador → backend → Mercado Pago → backend → navegador**. La tarjeta se ingresa en el sitio de Mercado Pago; la aplicación no recibe ni almacena datos de tarjeta. No se utiliza el SDK porque la API REST satisface el enunciado y permite mostrar directamente las solicitudes.

## Video de entrega: máximo 2 minutos

- **0:00–0:15:** mostrar producto, precio y aviso de prueba.
- **0:15–0:35:** iniciar la compra y mostrar la redirección al checkout.
- **0:35–1:15:** completar con comprador y tarjeta de prueba; mostrar el resultado en Mercado Pago.
- **1:15–1:40:** volver a la aplicación y mostrar resultado verificado e identificador.
- **1:40–2:00:** explicar: «El frontend envía el ID al backend. El backend crea la preferencia usando su credencial privada. Mercado Pago procesa la simulación y al regresar consultamos su API para verificar el pago».

Preparar las cuentas antes de grabar. No mostrar credenciales en pantalla. Entregar enlace al video y a este repositorio antes del **domingo 29 de noviembre de 2026 a las 23:59, hora de Chile**. El video es una entrega externa: este código no lo genera ni lo sustituye.

## Documentación oficial utilizada

- [Crear preferencia](https://www.mercadopago.cl/developers/es/reference/online-payments/checkout-pro-preferences/create-preference/post)
- [URLs de retorno](https://www.mercadopago.cl/developers/es/docs/checkout-pro-preferences/configure-back-urls)
- [Cuentas de prueba y credenciales actuales](https://www.mercadopago.cl/developers/es/docs/checkout-pro-preferences/test-accounts)
- [Compras y tarjetas de prueba](https://www.mercadopago.cl/developers/es/docs/checkout-pro-preferences/integration-test/test-purchases)
- [Consultar un pago](https://www.mercadopago.cl/developers/es/reference/online-payments/checkout-api-payments/get-payment/get)

Implementación asistida por IA (OpenAI Codex). El estudiante debe revisar el código, configurar su cuenta y comprender el flujo para la explicación individual.
