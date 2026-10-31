/* ==========================================================================
   EVO ENGLISH — /api/credenciales (Vercel Serverless Function)
   La página de "gracias" (landing.html?pago=ok&session_id=...) llama aquí
   para mostrar el usuario y la contraseña recién creados. Disponible 24 h.
   Variable necesaria en Vercel: SUPABASE_SERVICE_ROLE_KEY
   ========================================================================== */
"use strict";

var SUPABASE_URL = "https://djldztsatvzgemashunk.supabase.co";

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }
  var sid = req.query && req.query.session_id ? String(req.query.session_id) : "";
  if (!/^cs_(test|live)_[A-Za-z0-9]{10,200}$/.test(sid)) {
    res.status(400).json({ error: "Sesión inválida" });
    return;
  }
  var llave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!llave) {
    res.status(500).json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY en Vercel." });
    return;
  }
  var cabeceras = { "apikey": llave, "Content-Type": "application/json" };
  if (llave.indexOf("eyJ") === 0) cabeceras["Authorization"] = "Bearer " + llave;
  try {
    var r = await fetch(SUPABASE_URL + "/rest/v1/rpc/sistema_entregar_credenciales", {
      method: "POST",
      headers: cabeceras,
      body: JSON.stringify({ p_session_id: sid })
    });
    var texto = await r.text();
    if (!r.ok) {
      console.error("credenciales: Supabase", r.status, texto);
      res.status(502).json({ error: "No se pudo consultar tus datos." });
      return;
    }
    res.status(200).json(JSON.parse(texto));
  } catch (err) {
    console.error("credenciales:", err && err.message ? err.message : err);
    res.status(502).json({ error: "No se pudo consultar tus datos." });
  }
};
