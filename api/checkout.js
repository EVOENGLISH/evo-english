/* ==========================================================================
   EVO ENGLISH — /api/checkout (Vercel Serverless Function)
   Crea una sesión de Stripe Checkout para la suscripción mensual de $59 MXN
   y devuelve la URL de la página de pago de Stripe. El alumno pone ahí los
   datos de su tarjeta (nunca pasan por nuestra app) y Stripe cobra cada mes
   de forma automática hasta que el alumno cancele.

   La llave secreta vive SOLO en Vercel (Settings → Environment Variables →
   STRIPE_SECRET_KEY). No se escribe en el código ni se envía al navegador.
   Se llama a la API de Stripe con fetch, sin instalar dependencias.
   ========================================================================== */
"use strict";

var PRECIO_CENTAVOS = 5900;          // $59.00 MXN al mes (Stripe usa centavos)
var NOMBRE_PLAN = "EVO ENGLISH — Plan mensual";

module.exports = async function handler(req, res) {
 if (req.method !== "POST") {
  res.status(405).json({ error: "Método no permitido" });
  return;
 }
 var llave = process.env.STRIPE_SECRET_KEY;
 if (!llave) {
  res.status(500).json({ error: "El servidor no tiene configurada STRIPE_SECRET_KEY." });
  return;
 }

 /* Dominio desde el que se llamó, para regresar al alumno al mismo sitio
    después de pagar o de cancelar. */
 var host = req.headers["x-forwarded-host"] || req.headers.host;
 var origen = "https://" + host;

 var datos = new URLSearchParams();
 datos.append("mode", "subscription");
 datos.append("locale", "es");
 datos.append("line_items[0][quantity]", "1");
 datos.append("line_items[0][price_data][currency]", "mxn");
 datos.append("line_items[0][price_data][unit_amount]", String(PRECIO_CENTAVOS));
 datos.append("line_items[0][price_data][recurring][interval]", "month");
 datos.append("line_items[0][price_data][product_data][name]", NOMBRE_PLAN);
 datos.append("success_url", origen + "/landing.html?pago=ok#precio");
 datos.append("cancel_url", origen + "/landing.html?pago=cancelado#precio");

 try {
  var r = await fetch("https://api.stripe.com/v1/checkout/sessions", {
   method: "POST",
   headers: {
    "Authorization": "Bearer " + llave,
    "Content-Type": "application/x-www-form-urlencoded"
   },
   body: datos.toString()
  });
  var json = await r.json();
  if (!r.ok || !json.url) {
   var msg = (json && json.error && json.error.message) ? json.error.message : "Stripe no devolvió la página de pago.";
   res.status(502).json({ error: msg });
   return;
  }
  res.status(200).json({ url: json.url });
 } catch (err) {
  res.status(502).json({ error: "No se pudo contactar a Stripe: " + (err && err.message ? err.message : String(err)) });
 }
};
