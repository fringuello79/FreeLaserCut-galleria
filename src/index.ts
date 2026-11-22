// Galleria FreeLaserCut — servizio (Cloudflare Worker). GPL-3.0-or-later.
// Indirizzi e regole in freeburn/galleria.md. Niente account: l'installazione si riconosce da un numero a caso
// (intestazione X-FLC-Installazione), di cui qui si salva solo un'impronta con sale.

import {
  LIMITI, MOTIVI, Rifiuto, controllaParte, controllaScheda, controllaTesto, limiteParte, parti, punteggio,
} from "./controlli";
import { controllaImmagine, unisci, type Esito } from "./ia";

export interface Env {
  DB: D1Database;
  FILES: KVNamespace;
  AI?: any;
  LIMITE?: { limit(o: { key: string }): Promise<{ success: boolean }> };
  ADMIN_TOKEN?: string;
  VERSIONE?: string;
}

const PAGINA = 24;
const GIORNO_MS = 24 * 3600 * 1000;
const NUOVO_MS = 7 * GIORNO_MS;

// ------------------------------------------------------------------ utilità
const enc = new TextEncoder();
async function sha256hex(s: string | Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", typeof s === "string" ? enc.encode(s) : s);
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
function casuale(n: number, alfabeto = "abcdefghijkmnpqrstuvwxyz23456789"): string {
  const b = crypto.getRandomValues(new Uint8Array(n));
  return [...b].map((x) => alfabeto[x % alfabeto.length]).join("");
}
function uguali(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const giorno = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type, x-flc-installazione, x-flc-versione, x-flc-chiave, authorization",
  "access-control-allow-methods": "GET, POST, PUT, OPTIONS",
};
function json(dati: unknown, stato = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(dati), {
    status: stato,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS, ...extra },
  });
}
const errore = (codice: string, messaggio: string, stato = 400) => json({ errore: codice, messaggio }, stato);

async function sale(env: Env): Promise<string> {
  const r = await env.DB.prepare("SELECT valore FROM config WHERE chiave = 'sale'").first<{ valore: string }>();
  if (r) return r.valore;
  const s = casuale(48);
  await env.DB.prepare("INSERT OR IGNORE INTO config (chiave, valore) VALUES ('sale', ?)").bind(s).run();
  const r2 = await env.DB.prepare("SELECT valore FROM config WHERE chiave = 'sale'").first<{ valore: string }>();
  return r2!.valore;
}

async function installazione(req: Request, env: Env): Promise<string> {
  const id = req.headers.get("x-flc-installazione") || "";
  if (!/^[0-9a-f-]{32,64}$/i.test(id)) throw new Rifiuto("installazione", "installazione non riconosciuta", 401);
  return sha256hex((await sale(env)) + ":" + id.toLowerCase());
}

async function conta(env: Env, inst: string, tipo: string, massimo: number): Promise<void> {
  const g = giorno();
  const r = await env.DB.prepare(
    "INSERT INTO limiti (inst_hash, giorno, tipo, n) VALUES (?, ?, ?, 1) " +
    "ON CONFLICT (inst_hash, giorno, tipo) DO UPDATE SET n = n + 1 RETURNING n",
  ).bind(inst, g, tipo).first<{ n: number }>();
  if (r && r.n > massimo) throw new Rifiuto("limite", "limite di oggi raggiunto, riprova domani", 429);
}

async function corpoJson(req: Request): Promise<any> {
  const n = Number(req.headers.get("content-length") || "0");
  if (n > 16 * 1024) throw new Rifiuto("grande", "richiesta troppo grande", 413);
  try { return await req.json(); } catch { throw new Rifiuto("json", "richiesta non valida"); }
}

type Lavoro = Record<string, any>;

function pubblico(l: Lavoro, ora = Date.now()) {
  return {
    id: l.id, titolo: l.titolo, descrizione: l.descrizione, categoria: l.categoria, materiale: l.materiale,
    spessore_mm: l.spessore_mm, laser_famiglia: l.laser_famiglia, potenza_w: l.potenza_w, tipo: l.tipo,
    larghezza_mm: l.larghezza_mm, altezza_mm: l.altezza_mm, tempo_s: l.tempo_s, licenza: l.licenza,
    autore_nome: l.autore_nome, versione_flc: l.versione_flc, foto_n: l.foto_n, pubblicato: l.pubblicato,
    nuovo: !!l.pubblicato && ora - l.pubblicato < NUOVO_MS,
    stelle_media: l.stelle_n ? Math.round((l.stelle_somma / l.stelle_n) * 10) / 10 : null,
    stelle_n: l.stelle_n, fatti_n: l.fatti_n, scaricati_n: l.scaricati_n,
  };
}

async function lavoro(env: Env, id: string): Promise<Lavoro | null> {
  if (!/^[a-z0-9]{10}$/.test(id)) return null;
  return env.DB.prepare("SELECT * FROM lavori WHERE id = ?").bind(id).first<Lavoro>();
}

async function autore(req: Request, env: Env, id: string): Promise<Lavoro> {
  const l = await lavoro(env, id);
  if (!l || l.stato === "tolto") throw new Rifiuto("non_trovato", "lavoro non trovato", 404);
  const chiave = req.headers.get("x-flc-chiave") || "";
  if (!chiave || !uguali(await sha256hex(chiave), l.chiave_hash)) throw new Rifiuto("chiave", "chiave dell'autore sbagliata", 403);
  return l;
}

function amministratore(req: Request, env: Env): void {
  const t = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN.length < 30 || !uguali(t, env.ADMIN_TOKEN))
    throw new Rifiuto("admin", "non autorizzato", 403);
}

async function togliFile(env: Env, l: Lavoro): Promise<void> {
  await Promise.all(parti(l.foto_n).map((p) => env.FILES.delete(`${l.id}/${p}`)));
}

// ------------------------------------------------------------------ condivisione
async function condividi(req: Request, env: Env): Promise<Response> {
  const inst = await installazione(req, env);
  const s = controllaScheda(await corpoJson(req));
  const doppione = await env.DB.prepare(
    "SELECT id FROM lavori WHERE impronta = ? AND stato IN ('attesa', 'pubblico', 'nascosto')",
  ).bind(s.impronta).first<{ id: string }>();
  if (doppione) return json({ errore: "doppione", messaggio: "questo progetto è già nella Galleria", id: doppione.id }, 409);
  await conta(env, inst, "condividi", LIMITI.condivisioniInstGiorno);
  await conta(env, "tutti", "condividi", LIMITI.condivisioniTotaliGiorno);
  const id = casuale(10);
  const chiave = casuale(40, "abcdefghijklmnopqrstuvwxyz0123456789");
  await env.DB.prepare(
    `INSERT INTO lavori (id, titolo, descrizione, categoria, materiale, spessore_mm, laser_famiglia, potenza_w, tipo,
      larghezza_mm, altezza_mm, tempo_s, licenza, autore_nome, impronta, versione_flc, inst_hash, chiave_hash, foto_n,
      stato, creato) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'caricamento', ?)`,
  ).bind(id, s.titolo, s.descrizione, s.categoria, s.materiale, s.spessore_mm, s.laser_famiglia, s.potenza_w, s.tipo,
    s.larghezza_mm, s.altezza_mm, s.tempo_s, s.licenza, s.autore_nome, s.impronta, s.versione_flc, inst,
    await sha256hex(chiave), s.foto_n, Date.now()).run();
  return json({ id, chiave_autore: chiave, carica: parti(s.foto_n) }, 201);
}

async function carica(req: Request, env: Env, id: string, parte: string): Promise<Response> {
  const l = await autore(req, env, id);
  if (l.stato !== "caricamento") throw new Rifiuto("stato", "il lavoro è già stato concluso", 409);
  if (!parti(l.foto_n).includes(parte)) throw new Rifiuto("parte", "parte sconosciuta");
  const n = Number(req.headers.get("content-length") || "-1");
  if (!(n > 0)) throw new Rifiuto("lunghezza", "manca la lunghezza del file", 411);
  if (n > limiteParte(parte)) throw new Rifiuto("file_grande", "file troppo grande", 413);
  const b = new Uint8Array(await req.arrayBuffer());
  controllaParte(parte, b);
  await env.FILES.put(`${id}/${parte}`, b, { metadata: { byte: b.length } });
  const fatte = new Set((l.parti as string).split(",").filter(Boolean));
  fatte.add(parte);
  await env.DB.prepare("UPDATE lavori SET parti = ? WHERE id = ?").bind([...fatte].join(","), id).run();
  return json({ ok: true, parte });
}

async function moderazione(env: Env, l: Lavoro): Promise<Esito> {
  const chiavi = ["mini", ...Array.from({ length: l.foto_n }, (_, i) => `foto${i + 1}mini`)];
  const esiti: Esito[] = [];
  for (const k of chiavi) {
    const b = await env.FILES.get(`${l.id}/${k}`, "arrayBuffer");
    if (!b) return { esito: "non_so", motivo: "manca " + k };
    esiti.push(await controllaImmagine(env.AI, new Uint8Array(b), l.titolo, l.descrizione));
    if (esiti[esiti.length - 1].esito === "no") break;
  }
  return unisci(esiti);
}

async function applicaEsito(env: Env, l: Lavoro, e: Esito): Promise<string> {
  const ora = Date.now();
  if (e.esito === "ok") {
    await env.DB.prepare("UPDATE lavori SET stato = 'pubblico', motivo_stato = '', pubblicato = ? WHERE id = ?").bind(ora, l.id).run();
    return "pubblico";
  }
  if (e.esito === "no") {
    await env.DB.prepare("UPDATE lavori SET stato = 'rifiutato', motivo_stato = ? WHERE id = ?").bind("ia:" + e.motivo, l.id).run();
    return "rifiutato";
  }
  if (e.esito === "nascondi") {
    await env.DB.prepare("UPDATE lavori SET stato = 'nascosto', motivo_stato = ? WHERE id = ?").bind("ia:" + e.motivo, l.id).run();
    return "nascosto";
  }
  const tentativi = (l.tentativi_ia || 0) + 1;
  const stato = tentativi >= 24 ? "nascosto" : "attesa"; // dopo un giorno di «non so» passa alla mail settimanale
  await env.DB.prepare("UPDATE lavori SET stato = ?, motivo_stato = ?, tentativi_ia = ? WHERE id = ?")
    .bind(stato, "ia:" + e.motivo, tentativi, l.id).run();
  return stato;
}

async function concludi(req: Request, env: Env, id: string): Promise<Response> {
  const l = await autore(req, env, id);
  if (l.stato !== "caricamento") throw new Rifiuto("stato", "il lavoro è già stato concluso", 409);
  const mancano = parti(l.foto_n).filter((p) => !(l.parti as string).split(",").includes(p));
  if (mancano.length) return json({ errore: "mancano", messaggio: "mancano dei file", mancano }, 400);
  const stato = await applicaEsito(env, l, await moderazione(env, l));
  const r = await lavoro(env, id);
  return json({ id, stato, motivo: r?.motivo_stato || "" });
}

// ------------------------------------------------------------------ lettura
async function elenco(url: URL, env: Env): Promise<Response> {
  const q = url.searchParams;
  const dove = ["stato = 'pubblico'"];
  const val: unknown[] = [];
  for (const campo of ["categoria", "tipo", "laser_famiglia"] as const) {
    const v = q.get(campo === "laser_famiglia" ? "laser" : campo);
    if (v) { dove.push(`${campo} = ?`); val.push(v.slice(0, 80)); }
  }
  const mat = q.get("materiale");
  if (mat) { dove.push("materiale LIKE ? ESCAPE '\\'"); val.push("%" + mat.slice(0, 40).replace(/[\\%_]/g, "\\$&") + "%"); }
  const cerca = q.get("cerca");
  if (cerca) {
    dove.push("(titolo LIKE ? ESCAPE '\\' OR descrizione LIKE ? ESCAPE '\\')");
    const s = "%" + cerca.slice(0, 40).replace(/[\\%_]/g, "\\$&") + "%";
    val.push(s, s);
  }
  const ordine = q.get("ordine") || "voti";
  const pagina = Math.max(0, Math.min(500, Number(q.get("pagina") || "0") | 0));
  const sql = {
    nuovi: "pubblicato DESC",
    fatti: "fatti_n DESC, pubblicato DESC",
    scaricati: "scaricati_n DESC, pubblicato DESC",
    voti: "((17.5 + stelle_somma) * 1.0 / (5 + stelle_n)) + MIN(fatti_n, 50) * 0.02 DESC, pubblicato DESC",
  }[ordine] || "pubblicato DESC";
  const righe = await env.DB.prepare(
    `SELECT * FROM lavori WHERE ${dove.join(" AND ")} ORDER BY ${sql} LIMIT ? OFFSET ?`,
  ).bind(...val, PAGINA + 1, pagina * PAGINA).all<Lavoro>();
  const r = righe.results || [];
  const ora = Date.now();
  return json(
    { pagina, altre: r.length > PAGINA, lavori: r.slice(0, PAGINA).map((l) => ({ ...pubblico(l, ora), punteggio: punteggio(l.stelle_somma, l.stelle_n, l.fatti_n) })) },
    200, { "cache-control": "public, max-age=60" },
  );
}

async function scheda(req: Request, env: Env, id: string): Promise<Response> {
  const l = await lavoro(env, id);
  if (!l) return errore("non_trovato", "lavoro non trovato", 404);
  if (l.stato === "pubblico") return json(pubblico(l));
  const chiave = req.headers.get("x-flc-chiave") || "";
  if (chiave && uguali(await sha256hex(chiave), l.chiave_hash) && l.stato !== "tolto")
    return json({ ...pubblico(l), stato: l.stato, motivo: l.motivo_stato });
  return errore("non_trovato", "lavoro non trovato", 404);
}

async function file(env: Env, ctx: ExecutionContext, id: string, parte: string): Promise<Response> {
  const l = await lavoro(env, id);
  if (!l || l.stato !== "pubblico") return errore("non_trovato", "lavoro non trovato", 404);
  if (!parti(l.foto_n).includes(parte) || parte === "mini" || parte.endsWith("mini")) return errore("non_trovato", "file non trovato", 404);
  const b = await env.FILES.get(`${id}/${parte}`, "arrayBuffer");
  if (!b) return errore("non_trovato", "file non trovato", 404);
  const tipi: Record<string, string> = { progetto: "application/zip", anteprima: "image/png" };
  const h: Record<string, string> = { ...CORS, "content-type": tipi[parte] || "image/jpeg", "cache-control": "public, max-age=86400" };
  if (parte === "progetto") {
    h["content-disposition"] = `attachment; filename="${id}.flcut"`;
    h["cache-control"] = "no-store";
    ctx.waitUntil(env.DB.prepare("UPDATE lavori SET scaricati_n = scaricati_n + 1 WHERE id = ?").bind(id).run());
  }
  return new Response(b, { headers: h });
}

// ------------------------------------------------------------------ community
async function voto(req: Request, env: Env): Promise<Response> {
  const inst = await installazione(req, env);
  const b = await corpoJson(req);
  const stelle = b?.stelle;
  if (!Number.isInteger(stelle) || stelle < 1 || stelle > 5) throw new Rifiuto("stelle", "stelle da 1 a 5");
  const l = await lavoro(env, String(b?.id || ""));
  if (!l || l.stato !== "pubblico") return errore("non_trovato", "lavoro non trovato", 404);
  if (l.inst_hash === inst) throw new Rifiuto("proprio", "non puoi votare un tuo lavoro", 403);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO voti (lavoro, inst_hash, stelle, data) VALUES (?, ?, ?, ?) ON CONFLICT (lavoro, inst_hash) DO UPDATE SET stelle = excluded.stelle, data = excluded.data")
      .bind(l.id, inst, stelle, Date.now()),
    env.DB.prepare("UPDATE lavori SET stelle_somma = (SELECT COALESCE(SUM(stelle), 0) FROM voti WHERE lavoro = ?1), stelle_n = (SELECT COUNT(*) FROM voti WHERE lavoro = ?1) WHERE id = ?1")
      .bind(l.id),
  ]);
  const r = await lavoro(env, l.id);
  return json(pubblico(r!));
}

async function fatto(req: Request, env: Env): Promise<Response> {
  const inst = await installazione(req, env);
  const b = await corpoJson(req);
  const l = await lavoro(env, String(b?.id || ""));
  if (!l || l.stato !== "pubblico") return errore("non_trovato", "lavoro non trovato", 404);
  if (l.inst_hash === inst) throw new Rifiuto("proprio", "è un tuo lavoro", 403);
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO fatti (lavoro, inst_hash, data) VALUES (?, ?, ?)").bind(l.id, inst, Date.now()),
    env.DB.prepare("UPDATE lavori SET fatti_n = (SELECT COUNT(*) FROM fatti WHERE lavoro = ?1) WHERE id = ?1").bind(l.id),
  ]);
  const r = await lavoro(env, l.id);
  return json(pubblico(r!));
}

export function daNascondere(l: Lavoro, motivo: string, ora = Date.now()): boolean {
  const nuove = l.segnalazioni_n - l.revisionate_n;
  if (nuove >= 3) return true;
  return motivo === "non_adatto" && !!l.pubblicato && ora - l.pubblicato < NUOVO_MS && l.stelle_n < 5 && nuove >= 1;
}

async function segnala(req: Request, env: Env): Promise<Response> {
  const inst = await installazione(req, env);
  const b = await corpoJson(req);
  const motivo = String(b?.motivo || "");
  if (!(MOTIVI as readonly string[]).includes(motivo)) throw new Rifiuto("motivo", "motivo non valido");
  const l = await lavoro(env, String(b?.id || ""));
  if (!l || l.stato !== "pubblico") return errore("non_trovato", "lavoro non trovato", 404);
  await conta(env, inst, "segnala", LIMITI.segnalazioniInstGiorno);
  const nuova = await env.DB.prepare("INSERT OR IGNORE INTO segnalazioni (lavoro, inst_hash, motivo, data) VALUES (?, ?, ?, ?)")
    .bind(l.id, inst, motivo, Date.now()).run();
  if (!nuova.meta.changes) return json({ ok: true, gia: true });
  await env.DB.prepare("UPDATE lavori SET segnalazioni_n = (SELECT COUNT(*) FROM segnalazioni WHERE lavoro = ?1) WHERE id = ?1").bind(l.id).run();
  const r = (await lavoro(env, l.id))!;
  if (daNascondere(r, motivo)) {
    await env.DB.prepare("UPDATE lavori SET stato = 'nascosto', motivo_stato = ? WHERE id = ?").bind("segnalato:" + motivo, l.id).run();
  }
  return json({ ok: true });
}

async function modifica(req: Request, env: Env, id: string): Promise<Response> {
  const l = await autore(req, env, id);
  const b = await corpoJson(req);
  const s = controllaScheda({ ...l, ...b, impronta: l.impronta, foto_n: l.foto_n, regole_accettate: true, opera_mia: true });
  await env.DB.prepare(
    "UPDATE lavori SET titolo = ?, descrizione = ?, categoria = ?, materiale = ?, spessore_mm = ?, tipo = ?, licenza = ?, autore_nome = ? WHERE id = ?",
  ).bind(s.titolo, s.descrizione, s.categoria, s.materiale, s.spessore_mm, s.tipo, s.licenza, s.autore_nome, id).run();
  return json({ ok: true });
}

async function togli(req: Request, env: Env, id: string): Promise<Response> {
  const l = await autore(req, env, id);
  await togliFile(env, l);
  await env.DB.prepare("UPDATE lavori SET stato = 'tolto', motivo_stato = 'autore' WHERE id = ?").bind(id).run();
  return json({ ok: true });
}

// ------------------------------------------------------------------ amministrazione
async function admin(req: Request, env: Env, azione: string, id: string): Promise<Response> {
  amministratore(req, env);
  if (azione === "nascosti" && req.method === "GET") {
    const r = await env.DB.prepare(
      "SELECT * FROM lavori WHERE stato IN ('nascosto', 'attesa') ORDER BY creato DESC LIMIT 200",
    ).all<Lavoro>();
    return json((r.results || []).map((l) => ({ ...pubblico(l), stato: l.stato, motivo: l.motivo_stato, segnalazioni_n: l.segnalazioni_n })));
  }
  const l = await lavoro(env, id);
  if (!l || l.stato === "tolto") return errore("non_trovato", "lavoro non trovato", 404);
  if (azione === "togli" && req.method === "POST") {
    await togliFile(env, l);
    await env.DB.prepare("UPDATE lavori SET stato = 'tolto', motivo_stato = 'amministratore' WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }
  if (azione === "ripristina" && req.method === "POST") {
    await env.DB.prepare(
      "UPDATE lavori SET stato = 'pubblico', motivo_stato = '', revisionate_n = segnalazioni_n, pubblicato = COALESCE(pubblicato, ?) WHERE id = ?",
    ).bind(Date.now(), id).run();
    return json({ ok: true });
  }
  return errore("non_trovato", "azione sconosciuta", 404);
}

// ------------------------------------------------------------------ lavori di ogni ora
export async function ogniOra(env: Env): Promise<{ ricontrollati: number; puliti: number }> {
  const attesa = await env.DB.prepare("SELECT * FROM lavori WHERE stato = 'attesa' ORDER BY creato LIMIT 20").all<Lavoro>();
  let ricontrollati = 0;
  for (const l of attesa.results || []) {
    await applicaEsito(env, l, await moderazione(env, l));
    ricontrollati++;
  }
  const limite = Date.now() - GIORNO_MS;
  const vecchi = await env.DB.prepare(
    "SELECT * FROM lavori WHERE stato IN ('caricamento', 'rifiutato') AND creato < ? LIMIT 50",
  ).bind(limite).all<Lavoro>();
  for (const l of vecchi.results || []) {
    await togliFile(env, l);
    await env.DB.prepare("DELETE FROM lavori WHERE id = ?").bind(l.id).run();
  }
  await env.DB.prepare("DELETE FROM limiti WHERE giorno < ?").bind(giorno(Date.now() - 7 * GIORNO_MS)).run();
  return { ricontrollati, puliti: (vecchi.results || []).length };
}

// ------------------------------------------------------------------ smistamento
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const p = url.pathname.replace(/\/+$/, "").split("/").slice(1); // ["v1", ...]
    if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
    try {
      if (p[0] !== "v1") return errore("non_trovato", "indirizzo sconosciuto", 404);
      const [_, a, b, c] = p;
      if (req.method !== "GET" && env.LIMITE) {
        const ip = req.headers.get("cf-connecting-ip") || "sconosciuto";
        if (!(await env.LIMITE.limit({ key: ip })).success) return errore("troppe", "troppe richieste, riprova fra un minuto", 429);
      }
      if (req.method === "GET") {
        if (a === "salute") return json({ ok: true, versione: env.VERSIONE || "", ora: new Date().toISOString() });
        if (a === "elenco") return await elenco(url, env);
        if (a === "lavoro" && b) return await scheda(req, env, b);
        if (a === "file" && b) return await file(env, ctx, b, "progetto");
        if (a === "anteprima" && b) return await file(env, ctx, b, "anteprima");
        if (a === "foto" && b && /^[1-3]$/.test(c || "")) return await file(env, ctx, b, "foto" + c);
        if (a === "admin" && b === "nascosti") return await admin(req, env, "nascosti", "");
      }
      if (req.method === "POST") {
        if (a === "condividi") return await condividi(req, env);
        if (a === "concludi" && b) return await concludi(req, env, b);
        if (a === "voto") return await voto(req, env);
        if (a === "fatto") return await fatto(req, env);
        if (a === "segnala") return await segnala(req, env);
        if (a === "modifica" && b) return await modifica(req, env, b);
        if (a === "togli" && b) return await togli(req, env, b);
        if (a === "admin" && b && c) return await admin(req, env, b, c);
      }
      if (req.method === "PUT" && a === "carica" && b && c) return await carica(req, env, b, c);
      return errore("non_trovato", "indirizzo sconosciuto", 404);
    } catch (e) {
      if (e instanceof Rifiuto) return errore(e.codice, e.message, e.stato);
      console.error("errore", e);
      return errore("interno", "errore del servizio", 500);
    }
  },
  async scheduled(_c: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(ogniOra(env));
  },
} satisfies ExportedHandler<Env>;

export { controllaTesto };
