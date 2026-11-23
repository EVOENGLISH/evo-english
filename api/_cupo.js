"use strict";
/* Cupo diario por alumno. Valida el "pase personal" (cabecera x-evo-token)
   contra Supabase y cuenta el uso del día. Si Supabase no responde, deja
   pasar (no queremos tumbar la práctica por un fallo de red). */
var URL_SB = process.env.SUPABASE_URL || "https://djldztsatvzgemashunk.supabase.co";
var KEY_SB = process.env.SUPABASE_PUBLISHABLE_KEY || "sb_publishable_ioY719QrXjQ5d94lRzLTFA_77tgWj4A";

async function usarCupo(req, tipo, limite) {
 var token = String((req.headers && req.headers["x-evo-token"]) || "").trim();
 if (token.length < 32 || token.length > 200) return { ok: false, status: 401, mensaje: "Inicia sesión de nuevo para seguir practicando." };
 try {
  var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, 4000);
  var r;
  try {
   r = await fetch(URL_SB + "/rest/v1/rpc/evo_usar_cupo", {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": KEY_SB, "Authorization": "Bearer " + KEY_SB },
    body: JSON.stringify({ p_token: token, p_tipo: tipo, p_limite: limite }),
    signal: ctl.signal
   });
  } finally { clearTimeout(t); }
  if (!r.ok) return { ok: true };
  var d = await r.json().catch(function () { return null; });
  if (!d) return { ok: true };
  if (d.ok) return { ok: true };
  if (d.motivo === "limite") return { ok: false, status: 429, mensaje: "Hoy ya llegaste a tu límite de práctica. ¡Mañana sigues, buen trabajo!" };
  return { ok: false, status: 401, mensaje: "Inicia sesión de nuevo para seguir practicando." };
 } catch (e) { return { ok: true }; }
}
module.exports = { usarCupo: usarCupo };
