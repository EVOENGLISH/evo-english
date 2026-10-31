/* ==========================================================================
   EVO ENGLISH — /api/stripe-webhook (Vercel Serverless Function)
   Stripe avisa aquí cuando pasa algo con una suscripción:
     - checkout.session.completed      -> crea el alumno (usuario + contraseña)
     - customer.subscription.updated   -> activa o bloquea según el estado
     - customer.subscription.deleted   -> bloquea (canceló)
   Variables de entorno necesarias en Vercel:
     STRIPE_WEBHOOK_SECRET        (whsec_..., la da Stripe al crear el webhook)
     SUPABASE_SERVICE_ROLE_KEY    (llave secreta de Supabase)
   ========================================================================== */
"use strict";

var crypto = require("crypto");

var SUPABASE_URL = "https://djldztsatvzgemashunk.supabase.co";

function leerCuerpoCrudo(req) {
  return new Promise(function (ok, fallo) {
    var partes = [];
    req.on("data", function (d) { partes.push(d); });
    req.on("end", function () { ok(Buffer.concat(partes)); });
    req.on("error", fallo);
  });
}

// Comprueba que el aviso de verdad viene de Stripe (firma HMAC-SHA256)
function firmaValida(crudo, encabezado, secreto) {
  if (!encabezado || !secreto) return false;
  var t = null;
  var firmas = [];
  encabezado.split(",").forEach(function (p) {
    var kv = p.split("=");
    if (kv[0] === "t") t = kv[1];
    if (kv[0] === "v1") firmas.push(kv[1]);
  });
  if (!t || !firmas.length) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  var esperado = crypto
    .createHmac("sha256", secreto)
    .update(Buffer.concat([Buffer.from(t + "."), crudo]))
    .digest("hex");
  var b = Buffer.from(esperado);
  return firmas.some(function (f) {
    var a = Buffer.from(f);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

async function rpc(nombre, params) {
  var llave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!llave) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en Vercel.");
  var cabeceras = { "apikey": llave, "Content-Type": "application/json" };
  if (llave.indexOf("eyJ") === 0) cabeceras["Authorization"] = "Bearer " + llave;
  var r = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + nombre, {
    method: "POST",
    headers: cabeceras,
    body: JSON.stringify(params)
  });
  var texto = await r.text();
  if (!r.ok) throw new Error("Supabase " + r.status + ": " + texto);
  try { return JSON.parse(texto); } catch (e) { return texto; }
}

async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }
  var secreto = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secreto) {
    res.status(500).json({ error: "Falta STRIPE_WEBHOOK_SECRET en Vercel." });
    return;
  }

  var crudo = await leerCuerpoCrudo(req);
  if (!firmaValida(crudo, req.headers["stripe-signature"], secreto)) {
    res.status(400).json({ error: "Firma inválida" });
    return;
  }

  var evento;
  try { evento = JSON.parse(crudo.toString("utf8")); }
  catch (e) { res.status(400).json({ error: "JSON inválido" }); return; }

  try {
    var obj = evento.data && evento.data.object ? evento.data.object : {};

    if (evento.type === "checkout.session.completed") {
      if (obj.mode === "subscription" && obj.subscription) {
        var cliente = obj.customer_details || {};
        var r = await rpc("sistema_crear_alumno_pago", {
          p_session_id: obj.id,
          p_customer: obj.customer || null,
          p_subscription: obj.subscription,
          p_email: cliente.email || obj.customer_email || null,
          p_telefono: cliente.phone || null,
          p_nombre: cliente.name || null
        });
        console.log("Alumno por pago:", JSON.stringify(r));
      }
    } else if (evento.type === "customer.subscription.updated") {
      await rpc("sistema_cambiar_estado_pago", { p_subscription: obj.id, p_estado: obj.status });
    } else if (evento.type === "customer.subscription.deleted") {
      await rpc("sistema_cambiar_estado_pago", { p_subscription: obj.id, p_estado: "canceled" });
    }

    res.status(200).json({ recibido: true });
  } catch (err) {
    console.error("Error procesando", evento.type, err && err.message ? err.message : err);
    // 500 -> Stripe reintenta el aviso automáticamente
    res.status(500).json({ error: "No se pudo procesar el aviso." });
  }
}

module.exports = handler;
module.exports.config = { api: { bodyParser: false } };
