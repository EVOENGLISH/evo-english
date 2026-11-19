// EVO ENGLISH · voz natural para LEVO (proxy seguro, las llaves viven en Vercel)
// Orden: ElevenLabs (si pones ELEVENLABS_API_KEY) -> Gemini TTS (usa tu GEMINI_API_KEY) -> Groq Orpheus (usa GROQ_API_KEY)
// Si todo falla responde 503 y la app usa la voz del navegador, el alumno nunca ve un error.
const cache = new Map();
const hits = new Map();
const MAX = 300;

function limite(ip) {
  const now = Date.now();
  const a = (hits.get(ip) || []).filter((t) => now - t < 60000);
  a.push(now);
  hits.set(ip, a);
  return a.length > 40;
}

function wav(pcm, rate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.length, 4); h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

function buscarAudio(o) {
  // busca recursivamente un base64 de audio en la respuesta de Gemini
  if (!o || typeof o !== "object") return null;
  if (typeof o.data === "string" && o.data.length > 200) return { b64: o.data, mime: o.mime_type || o.mimeType || "" };
  for (const k of Object.keys(o)) {
    const r = buscarAudio(o[k]);
    if (r) return r;
  }
  return null;
}

async function conTiempo(url, opts, ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  try { return await fetch(url, { ...opts, signal: c.signal }); } finally { clearTimeout(t); }
}

async function elevenlabs(texto) {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return null;
  const voz = process.env.ELEVENLABS_VOICE_ID || "bMxLr8fP6hzNRRi9nJxU";
  const r = await conTiempo("https://api.elevenlabs.io/v1/text-to-speech/" + voz, {
    method: "POST",
    headers: { "xi-api-key": key, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text: texto, model_id: "eleven_turbo_v2_5" }),
  }, 12000);
  if (!r.ok) return null;
  return { buf: Buffer.from(await r.arrayBuffer()), tipo: "audio/mpeg" };
}

async function gemini(texto) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const voz = process.env.GEMINI_VOICE || "Kore";
  const modelos = [process.env.GEMINI_TTS_MODEL, "gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts", "gemini-3.1-flash-tts-preview"].filter(Boolean);
  for (const m of modelos) {
    // 1) endpoint clasico generateContent
    try {
      const r = await conTiempo("https://generativelanguage.googleapis.com/v1beta/models/" + m + ":generateContent", {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "Say clearly and warmly, like a friendly English teacher: " + texto }] }],
          generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voz } } } },
        }),
      }, 9000);
      if (r.ok) {
        const a = buscarAudio(await r.json());
        if (a) {
          const buf = Buffer.from(a.b64, "base64");
          if (buf.slice(0, 4).toString() === "RIFF") return { buf, tipo: "audio/wav" };
          return { buf: wav(buf, 24000), tipo: "audio/wav" };
        }
      }
    } catch (e) {}
    // 2) endpoint interactions
    try {
      const r = await conTiempo("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: m,
          input: [{ type: "user_input", content: [{ type: "text", text: texto }] }],
          response_format: { type: "audio" },
          generation_config: { speech_config: [{ voice: voz }] },
        }),
      }, 9000);
      if (r.ok) {
        const a = buscarAudio(await r.json());
        if (a) {
          const buf = Buffer.from(a.b64, "base64");
          if (buf.slice(0, 4).toString() === "RIFF") return { buf, tipo: "audio/wav" };
          return { buf: wav(buf, 24000), tipo: "audio/wav" };
        }
      }
    } catch (e) {}
  }
  return null;
}

async function groq(texto) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  const r = await conTiempo("https://api.groq.com/openai/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "canopylabs/orpheus-v1-english", input: texto.slice(0, 200), voice: process.env.GROQ_VOICE || "hannah", response_format: "wav" }),
  }, 9000);
  if (!r.ok) return null;
  return { buf: Buffer.from(await r.arrayBuffer()), tipo: "audio/wav" };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const ip = String(req.headers["x-forwarded-for"] || "x").split(",")[0].trim();
  if (limite(ip)) return res.status(429).json({ error: "limite" });
  let texto = "";
  try {
    const b = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    texto = String(b.text || "").replace(/\s+/g, " ").trim().slice(0, MAX);
  } catch (e) {}
  if (!texto) return res.status(400).json({ error: "vacio" });
  let r = cache.get(texto);
  if (!r) {
    for (const f of [elevenlabs, gemini, groq]) {
      try { r = await f(texto); } catch (e) { r = null; }
      if (r) break;
    }
    if (r) {
      if (cache.size > 200) cache.delete(cache.keys().next().value);
      cache.set(texto, r);
    }
  }
  if (!r) return res.status(503).json({ error: "sin_voz" });
  res.setHeader("Content-Type", r.tipo);
  res.setHeader("Cache-Control", "public, max-age=86400");
  return res.status(200).send(r.buf);
};
module.exports.config = { maxDuration: 30 };
