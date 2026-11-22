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
var moderacion = require("./_moderacion");

/* Clave de Google AI Studio / Gemini API. NUNCA se escribe en el código:
   vive solo en Vercel (Project Settings → Environment Variables →
   GEMINI_API_KEY). Así GitHub y los alumnos no pueden verla. */
var GEMINI_API_KEY = process.env.GEMINI_API_KEY;
/* Modelo: se puede cambiar sin tocar código con la variable GEMINI_MODEL en Vercel. */
var GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
/* Modelos de respaldo: si el principal está saturado (503) se prueba el siguiente. */
var MODELOS = [process.env.GEMINI_MODEL, "gemini-3.5-flash-lite", "gemini-3.8-flash", "gemini-3.1-flash-lite", "gemini-3.6-flash"].filter(function (m, i, a) { return m && a.indexOf(m) === i; });
function urlModelo(m) { return "https://generativelanguage.googleapis.com/v1beta/models/" + m + ":generateContent"; }
/* ---- Claude (Anthropic): proveedor principal si existe ANTHROPIC_API_KEY ---- */
var ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
var CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-haiku-5-5";

/* Convierte el formato Gemini (contents/systemInstruction) al de Claude y la respuesta de vuelta. */
async function llamarClaude(body, signal) {
 var msgs = [];
 body.contents.forEach(function (c) {
  var rol = c.role === "model" ? "assistant" : "user";
  var txt = c.parts[0].text;
  if (msgs.length && msgs[msgs.length - 1].role === rol) msgs[msgs.length - 1].content += "\n" + txt;
  else msgs.push({ role: rol, content: txt });
 });
 while (msgs.length && msgs[0].role !== "user") msgs.shift();
 if (!msgs.length) return { status: 400, data: {} };
 var payload = { model: CLAUDE_MODEL, max_tokens: 700, temperature: 0.7, messages: msgs };
 if (body.systemInstruction) payload.system = body.systemInstruction.parts[0].text;
 var r = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
  body: JSON.stringify(payload),
  signal: signal
 });
 var d = await r.json().catch(function () { return {}; });
 if (r.ok && d && Array.isArray(d.content)) {
  var t = d.content.map(function (b) { return b.text || ""; }).join("").trim();
  return { status: 200, data: { candidates: [{ content: { parts: [{ text: t }] } }] } };
 }
 return { status: r.status, data: d };
}
/* ---- Groq (gratis, sin tarjeta): formato compatible con OpenAI ---- */
var GROQ_API_KEY = process.env.GROQ_API_KEY;
var GROQ_MODELOS = [process.env.GROQ_MODEL, "llama-3.3-70b-versatile", "llama-3.1-8b-instant"].filter(function (m, i, a) { return m && a.indexOf(m) === i; });

async function llamarGroq(body, modelo, signal) {
 var msgs = [];
 if (body.systemInstruction) msgs.push({ role: "system", content: body.systemInstruction.parts[0].text });
 body.contents.forEach(function (c) {
  msgs.push({ role: c.role === "model" ? "assistant" : "user", content: c.parts[0].text });
 });
 var r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + GROQ_API_KEY },
  body: JSON.stringify({ model: modelo, messages: msgs, max_tokens: 700, temperature: 0.7 }),
  signal: signal
 });
 var d = await r.json().catch(function () { return {}; });
 var t = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
 if (r.ok && t) return { status: 200, data: { candidates: [{ content: { parts: [{ text: String(t).trim() }] } }] } };
 return { status: r.ok ? 502 : r.status, data: d };
}
/* ---- OpenRouter (gratis con modelos ":free"): respaldo extra, formato OpenAI ---- */
var OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
var OPENROUTER_MODELO = process.env.OPENROUTER_MODEL || "openrouter/free";

async function llamarOpenRouter(body, signal) {
 var msgs = [];
 if (body.systemInstruction) msgs.push({ role: "system", content: body.systemInstruction.parts[0].text });
 body.contents.forEach(function (c) {
  msgs.push({ role: c.role === "model" ? "assistant" : "user", content: c.parts[0].text });
 });
 var r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json", "Authorization": "Bearer " + OPENROUTER_API_KEY, "X-Title": "EVO ENGLISH" },
  body: JSON.stringify({ model: OPENROUTER_MODELO, messages: msgs, max_tokens: 700, temperature: 0.7 }),
  signal: signal
 });
 var d = await r.json().catch(function () { return {}; });
 var t = d && d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content;
 if (r.ok && t) return { status: 200, data: { candidates: [{ content: { parts: [{ text: String(t).trim() }] } }] } };
 return { status: r.ok ? 502 : r.status, data: d };
}
function esperar(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }


/* Solo estos campos pasan a Gemini; todo lo demás se descarta. */
function limpiarCuerpo(b) {
 if (!b || typeof b !== "object" || !Array.isArray(b.contents)) return null;
 var contents = b.contents.slice(-12).map(function (c) {
  var role = c && c.role === "model" ? "model" : "user";
  var txt = c && c.parts && c.parts[0] && typeof c.parts[0].text === "string" ? c.parts[0].text.slice(0, 600) : "";
  return { role: role, parts: [{ text: txt }] };
 }).filter(function (c) { return c.parts[0].text; });
 if (!contents.length) return null;
 var out = { contents: contents, generationConfig: { maxOutputTokens: 800, temperature: 0.7 } };
 var si = b.systemInstruction && b.systemInstruction.parts && b.systemInstruction.parts[0] && b.systemInstruction.parts[0].text;
 if (typeof si === "string" && si) out.systemInstruction = { parts: [{ text: si.slice(0, 2500) }] };
 return out;
}

/* Límite simple por IP: 20 mensajes por minuto (se reinicia si el servidor se reinicia). */
var _visitas = {};
function excedeLimite(req) {
 var ip = ((req.headers["x-forwarded-for"] || "") + "").split(",")[0].trim() || "x";
 var ahora = Date.now();
 var lista = (_visitas[ip] || []).filter(function (t) { return ahora - t < 60000; });
 lista.push(ahora);
 _visitas[ip] = lista;
 return lista.length > 20;
}

module.exports = async function handler(req, res) {
 if (req.method !== "POST") {
  res.status(405).json({ error: { message: "Method not allowed" } });
  return;
 }
 if (!GEMINI_API_KEY && !ANTHROPIC_API_KEY && !GROQ_API_KEY && !OPENROUTER_API_KEY) {
  res.status(500).json({ error: { message: "El servidor no tiene configurada ninguna llave de IA." } });
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

  /* Protección: solo se aceptan los campos que usa el chat, con límites,
     para que nadie pueda usar este servidor como una llave de Gemini gratis. */
  body = limpiarCuerpo(body);
  if (!body) {
   res.status(400).json({ error: { message: "Solicitud no válida." } });
   return;
  }
  /* Moderación: respuestas fijas para riesgo/datos personales y reglas de
     seguridad + adaptación de nivel agregadas en el servidor. */
  var fija = moderacion.respuestaFija(body);
  if (fija) {
   console.log("[moderacion] " + fija.motivo);
   res.status(200).json({ candidates: [{ content: { parts: [{ text: fija.texto }] } }] });
   return;
  }
  body = moderacion.reforzar(body);
  if (excedeLimite(req)) {
   res.status(429).json({ error: { message: "Demasiados mensajes. Espera un momento." } });
   return;
  }

  /* Reintentos con respaldo: hasta 4 intentos (~8 s máx.), alternando modelos
     cuando Gemini responde saturado (503), límite (429) o error interno (500). */
  var upstream = null, data = {};
  var t0 = Date.now();
  var intentos = 0;
  /* 1) Claude (2 intentos) */
  if (ANTHROPIC_API_KEY) {
   for (var k = 0; k < 2; k++) {
    var c1 = new AbortController();
    var t1 = setTimeout(function () { c1.abort(); }, 9000);
    try {
     var rc = await llamarClaude(body, c1.signal);
     if (rc.status === 200) { res.status(200).json(rc.data); return; }
     if ([429, 500, 502, 503, 529].indexOf(rc.status) === -1) break;
    } catch (e) { /* tiempo agotado o red: se intenta de nuevo / respaldo */ }
    finally { clearTimeout(t1); }
    await esperar(600);
   }
  }
  /* 1b) Groq (gratis): prueba cada modelo, con tiempo límite */
  if (GROQ_API_KEY) {
   for (var g = 0; g < GROQ_MODELOS.length * 2; g++) {
    var c2 = new AbortController();
    var t2 = setTimeout(function () { c2.abort(); }, 8000);
    try {
     var rg = await llamarGroq(body, GROQ_MODELOS[g % GROQ_MODELOS.length], c2.signal);
     if (rg.status === 200) { res.status(200).json(rg.data); return; }
     if ([404, 429, 500, 502, 503].indexOf(rg.status) === -1) break;
    } catch (e) { /* siguiente */ }
    finally { clearTimeout(t2); }
    if (Date.now() - t0 > 15000) break;
    await esperar(400);
   }
  }
  /* 1c) OpenRouter (gratis): 2 intentos */
  if (OPENROUTER_API_KEY) {
   for (var o = 0; o < 2; o++) {
    var c3 = new AbortController();
    var t3 = setTimeout(function () { c3.abort(); }, 9000);
    try {
     var ro = await llamarOpenRouter(body, c3.signal);
     if (ro.status === 200) { res.status(200).json(ro.data); return; }
     if ([429, 500, 502, 503].indexOf(ro.status) === -1) break;
    } catch (e) { /* siguiente */ }
    finally { clearTimeout(t3); }
    await esperar(400);
   }
  }
  /* 2) Respaldo: Gemini con varios modelos */
  if (GEMINI_API_KEY) {
   for (var i = 0; i < 4; i++) {
    var modelo = MODELOS[i % MODELOS.length];
    try {
     var ctl = new AbortController();
     var timer = setTimeout(function () { ctl.abort(); }, 7000);
     try {
      upstream = await fetch(urlModelo(modelo) + "?key=" + encodeURIComponent(GEMINI_API_KEY), {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify(body || {}),
       signal: ctl.signal
      });
      data = await upstream.json().catch(function () { return {}; });
     } finally { clearTimeout(timer); }
    } catch (e) { upstream = null; }
    if (upstream && upstream.ok) break;
    if (upstream && [429, 500, 503].indexOf(upstream.status) === -1 && upstream.status !== 404) break;
    if (Date.now() - t0 > 26000) break;
    await esperar(500 * (i + 1));
   }
  }
  if (!upstream) { res.status(504).json({ error: { message: "Gemini no respondió a tiempo." } }); return; }
  res.status(upstream.status).json(data);
 } catch (err) {
  res.status(502).json({ error: { message: "No se pudo contactar a Gemini desde el servidor: " + (err && err.message ? err.message : String(err)) } });
 }
};

/* Permite que la función viva hasta 30 s (Vercel). */
module.exports.config = { maxDuration: 30 };
