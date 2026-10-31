"use strict";

var PRECIO_CENTAVOS = 5900;
var NOMBRE_PLAN = "EVO ENGLISH — Plan mensual";

module.exports = async function handler(req, res) {
  var llave = process.env.STRIPE_SECRET_KEY;

  // DIAGNOSTICO TEMPORAL: abrir /api/checkout?diag=1 en el navegador.
  // No muestra la clave, solo datos para saber si esta bien puesta.
  if (req.method === "GET" && req.query && req.query.diag) {
    var info = {
      hay_llave: !!llave,
      largo: llave ? llave.length : 0,
      empieza_con_sk_test: llave ? llave.indexOf("sk_test_") === 0 : false,
      termina_en_3Ff5: llave ? llave.slice(-4) === "3Ff5" : false,
      tiene_espacios_o_saltos: llave ? /\s/.test(llave) : false,
      tiene_comillas: llave ? /["']/.test(llave) : false,
      tiene_puntos_suspensivos: llave ? /[…]|\.\.\./.test(llave) : false
    };
    if (llave) {
      try {
        var r0 = await fetch("https://api.stripe.com/v1/balance", {
          headers: { "Authorization": "Bearer " + llave.trim() }
        });
        var j0 = await r0.json();
        info.stripe_status = r0.status;
        info.stripe_error = j0 && j0.error ? j0.error.message : null;
      } catch (e) {
        info.stripe_status = "fallo_de_red";
        info.stripe_error = String(e && e.message ? e.message : e);
      }
    }
    res.status(200).json(info);
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }
  if (!llave) {
    res.status(500).json({ error: "El servidor no tiene configurada STRIPE_SECRET_KEY." });
    return;
  }

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
        "Authorization": "Bearer " + llave.trim(),
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: datos.toString()
    });
    var json = await r.json();
    if (!r.ok || !json.url) {
      console.error("Stripe error:", JSON.stringify(json && json.error ? json.error : json));
      res.status(502).json({ error: (json && json.error && json.error.message) || "Stripe no devolvió la página de pago." });
      return;
    }
    res.status(200).json({ url: json.url });
  } catch (err) {
    console.error("Fallo al contactar Stripe:", err);
    res.status(502).json({ error: "No se pudo contactar a Stripe: " + (err && err.message ? err.message : String(err)) });
  }
};
