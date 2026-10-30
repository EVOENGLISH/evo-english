/* ==========================================================================
   EVO ENGLISH — /api/chat (Vercel Serverless Function)
   Proxy seguro entre el chat de LEVO AI (frontend) y la API de Gemini.
   La API key de Google vive únicamente aquí, en el servidor: nunca se
   envía al navegador, así que ningún alumno puede verla en el código
   fuente ni en las herramientas de desarrollador. Al ser una ruta del
   mismo dominio (/api/chat), el navegador nunca hace la petición directa
   a googleapis.com, así que tampoco hay bloqueo de CORS.

   El frontend (index.html, función geminiChat) ya arma el body exacto
   que pide la API de Gemini (systemInstruction + contents). Esta función
   es un proxy delgado: recibe ese mismo body, le agrega la key, reenvía
   la petición a Gemini, y devuelve la respuesta tal cual (mismo código
   HTTP y mismo JSON) para que el frontend siga mostrando el diagnóstico
   exacto ("Error HTTP 403: API key not valid...", etc.) sin duplicar
   esa lógica aquí.
   ========================================================================== */
"use strict";

/* Clave de Google AI Studio / Gemini API. NUNCA se escribe en el código:
   vive solo en Vercel (Project Settings → Environment Variables →
   GEMINI_API_KEY). Así GitHub y los alumnos no pueden verla. */
var GEMINI_API_KEY = process.env.GEMINI_API_KEY;
var GEMINI_MODEL = "gemini-2.5-flash";
var GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + ":generateContent";

module.exports = async function handler(req, res) {
 if (req.method !== "POST") {
  res.status(405).json({ error: { message: "Method not allowed" } });
  return;
 }
 if (!GEMINI_API_KEY) {
  res.status(500).json({ error: { message: "El servidor no tiene configurada GEMINI_API_KEY." } });
  return;
 }

 try {
  var body = req.body;
  /* Vercel normalmente ya parsea req.body como objeto cuando el
     Content-Type es application/json; por si acaso llega como string
     (algunos runtimes lo dejan crudo), se intenta parsear aquí. */
  if (typeof body === "string") {
   try { body = JSON.parse(body); } catch (_) { body = {}; }
  }

  var upstream = await fetch(GEMINI_URL + "?key=" + encodeURIComponent(GEMINI_API_KEY), {
   method: "POST",
   headers: { "Content-Type": "application/json" },
   body: JSON.stringify(body || {})
  });

  var data = await upstream.json().catch(function () { return {}; });
  /* Se reenvía el mismo código HTTP que dio Gemini (200, 400, 403, 429, etc.)
     para que el frontend pueda mostrar el error exacto tal como lo pide
     el diagnóstico ya implementado en geminiChat(). */
  res.status(upstream.status).json(data);
 } catch (err) {
  res.status(502).json({ error: { message: "No se pudo contactar a Gemini desde el servidor: " + (err && err.message ? err.message : String(err)) } });
 }
};
