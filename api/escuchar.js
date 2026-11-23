var cupo = require("./_cupo");
// EVO ENGLISH · el alumno habla y esto lo convierte en texto (funciona en iPhone, Android y PC)
// Usa tu GROQ_API_KEY (Whisper). La llave vive solo en Vercel.
const hits = new Map();
function limite(ip) {
  const now = Date.now();
  const a = (hits.get(ip) || []).filter((t) => now - t < 60000);
  a.push(now);
  hits.set(ip, a);
  return a.length > 30;
}
module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  var cu = await cupo.usarCupo(req, "escuchar", 150);
  if (!cu.ok) return res.status(cu.status).json({ error: { message: cu.mensaje } });
  const key = process.env.GROQ_API_KEY;
  if (!key) return res.status(503).json({ error: "sin_llave" });
  const ip = String(req.headers["x-forwarded-for"] || "x").split(",")[0].trim();
  if (limite(ip)) return res.status(429).json({ error: "limite" });
  let b = {};
  try { b = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}; } catch (e) {}
  const b64 = String(b.audio || "");
  if (!b64 || b64.length > 4200000) return res.status(400).json({ error: "audio" });
  const buf = Buffer.from(b64, "base64");
  if (buf.length < 1500) return res.status(200).json({ text: "" });
  const mime = String(b.mime || "audio/mp4").split(";")[0];
  const ext = /webm/.test(mime) ? "webm" : /ogg/.test(mime) ? "ogg" : /wav/.test(mime) ? "wav" : /mpeg|mp3/.test(mime) ? "mp3" : "m4a";
  try {
    const fd = new FormData();
    fd.append("file", new Blob([buf], { type: mime }), "voz." + ext);
    fd.append("model", process.env.GROQ_STT_MODEL || "whisper-large-v3-turbo");
    fd.append("language", b.lang === "es" ? "es" : "en");
    fd.append("temperature", "0");
    fd.append("response_format", "json");
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 22000);
    let r;
    try { r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", { method: "POST", headers: { Authorization: "Bearer " + key }, body: fd, signal: c.signal }); } finally { clearTimeout(t); }
    if (!r.ok) return res.status(502).json({ error: "stt_" + r.status });
    const j = await r.json();
    return res.status(200).json({ text: String(j.text || "").trim() });
  } catch (e) {
    return res.status(502).json({ error: "stt_fallo" });
  }
};
module.exports.config = { maxDuration: 30 };
