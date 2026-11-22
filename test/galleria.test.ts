// Prove della Galleria: una prova per regola, più guasti messi apposta (vedi la fine del file).
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import worker, { daNascondere, decidi, ogniOra } from "../src/index";
import { controllaScheda, controllaTesto, controllaZip, LIMITI, Rifiuto } from "../src/controlli";
import { leggiRisposta, unisci } from "../src/ia";

const E = env as any;
const BASE = "https://galleria.prova";
const ADMIN = "chiave-di-amministrazione-delle-prove-0123456789";

// ------------------------------------------------------------------ attrezzi
function inst(n: number) { return n.toString(16).padStart(32, "0"); }
function aiFinta(risposta: string | (() => never)) {
  const chiamate: any[] = [];
  return { chiamate, run: async (_m: string, input: any) => { chiamate.push(input); if (typeof risposta === "function") risposta(); return { response: risposta }; } };
}
let AI = aiFinta("OK");
// risposte diverse una dopo l'altra (l'ultima si ripete)
function aiSequenza(risposte: string[]) {
  const chiamate: any[] = [];
  return { chiamate, run: async (_m: string, input: any) => { chiamate.push(input); return { response: risposte[Math.min(chiamate.length - 1, risposte.length - 1)] }; } };
}

async function chiama(metodo: string, percorso: string, opz: { inst?: number; json?: any; body?: Uint8Array; chiave?: string; admin?: string; ai?: any } = {}) {
  const h: Record<string, string> = {};
  if (opz.inst !== undefined) h["x-flc-installazione"] = inst(opz.inst);
  if (opz.chiave) h["x-flc-chiave"] = opz.chiave;
  if (opz.admin) h["authorization"] = "Bearer " + opz.admin;
  let body: BodyInit | undefined;
  if (opz.json !== undefined) { body = JSON.stringify(opz.json); h["content-type"] = "application/json"; h["content-length"] = String(new TextEncoder().encode(body as string).length); }
  if (opz.body) { body = opz.body; h["content-length"] = String(opz.body.length); }
  const ctx = createExecutionContext();
  const r = await worker.fetch(new Request(BASE + percorso, { method: metodo, headers: h, body }), { ...E, AI: opz.ai ?? AI }, ctx);
  await waitOnExecutionContext(ctx);
  let dati: any = null;
  const tipo = r.headers.get("content-type") || "";
  if (tipo.includes("json")) dati = await r.json(); else dati = new Uint8Array(await r.arrayBuffer());
  return { stato: r.status, dati, r };
}

// ZIP «stored» minimo, come lo scrive FreeLaserCut (project.json + images/*.png)
function zip(voci: { nome: string; dati: Uint8Array; espanso?: number }[]): Uint8Array {
  const enc = new TextEncoder();
  const locali: Uint8Array[] = [], centrali: Uint8Array[] = [];
  let off = 0;
  for (const v of voci) {
    const nome = enc.encode(v.nome);
    const l = new Uint8Array(30 + nome.length + v.dati.length), dl = new DataView(l.buffer);
    dl.setUint32(0, 0x04034b50, true); dl.setUint32(18, v.dati.length, true); dl.setUint32(22, v.espanso ?? v.dati.length, true);
    dl.setUint16(26, nome.length, true); l.set(nome, 30); l.set(v.dati, 30 + nome.length);
    const c = new Uint8Array(46 + nome.length), dc = new DataView(c.buffer);
    dc.setUint32(0, 0x02014b50, true); dc.setUint32(20, v.dati.length, true); dc.setUint32(24, v.espanso ?? v.dati.length, true);
    dc.setUint16(28, nome.length, true); dc.setUint32(42, off, true); c.set(nome, 46);
    locali.push(l); centrali.push(c); off += l.length;
  }
  const dimC = centrali.reduce((s, c) => s + c.length, 0);
  const fine = new Uint8Array(22), df = new DataView(fine.buffer);
  df.setUint32(0, 0x06054b50, true); df.setUint16(8, voci.length, true); df.setUint16(10, voci.length, true);
  df.setUint32(12, dimC, true); df.setUint32(16, off, true);
  const tutto = new Uint8Array(off + dimC + 22);
  let p = 0;
  for (const x of [...locali, ...centrali, fine]) { tutto.set(x, p); p += x.length; }
  return tutto;
}
const PROGETTO = zip([{ nome: "project.json", dati: new TextEncoder().encode('{"shapes":[]}') }, { nome: "images/a1.png", dati: new Uint8Array(10) }]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

let impr = 0;
function scheda(extra: any = {}) {
  impr++;
  return {
    titolo: "Scatola di Natale", descrizione: "Incastri 3 mm, tiglio", categoria: "scatole", materiale: "Tiglio",
    spessore_mm: 3, laser_famiglia: "Longer B1", potenza_w: 40, tipo: "entrambi", larghezza_mm: 200, altezza_mm: 150,
    tempo_s: 900, licenza: "cc-by-4.0", autore_nome: "Ale", impronta: impr.toString(16).padStart(64, "0"),
    versione_flc: "0.22.0", foto_n: 0, regole_accettate: true, opera_mia: true, ...extra,
  };
}

async function condividiTutto(n = 1, extra: any = {}, ai?: any) {
  const c = await chiama("POST", "/v1/condividi", { inst: n, json: scheda(extra) });
  expect(c.stato).toBe(201);
  const { id, chiave_autore, carica } = c.dati;
  for (const parte of carica) {
    const body = parte === "progetto" ? PROGETTO : parte === "anteprima" ? PNG : JPG;
    const r = await chiama("PUT", `/v1/carica/${id}/${parte}`, { chiave: chiave_autore, body });
    expect(r.stato, parte).toBe(200);
  }
  const fine = await chiama("POST", `/v1/concludi/${id}`, { chiave: chiave_autore, ai });
  return { id, chiave: chiave_autore, fine };
}

beforeEach(() => { AI = aiFinta("OK"); });

// ------------------------------------------------------------------ prove
describe("salute e indirizzi", () => {
  it("salute risponde", async () => {
    const r = await chiama("GET", "/v1/salute");
    expect(r.stato).toBe(200); expect(r.dati.ok).toBe(true);
  });
  it("indirizzo sconosciuto: 404", async () => {
    expect((await chiama("GET", "/v2/elenco")).stato).toBe(404);
    expect((await chiama("DELETE", "/v1/elenco")).stato).toBe(404);
  });
});

describe("condivisione", () => {
  it("percorso completo: pubblico, nell'elenco, file scaricabili", async () => {
    const { id, fine } = await condividiTutto(1);
    expect(fine.dati.stato).toBe("pubblico");
    const el = await chiama("GET", "/v1/elenco?ordine=nuovi");
    expect(el.dati.lavori.map((l: any) => l.id)).toContain(id);
    const l = el.dati.lavori.find((x: any) => x.id === id);
    expect(l.nuovo).toBe(true);
    expect(l).not.toHaveProperty("inst_hash"); expect(l).not.toHaveProperty("chiave_hash"); expect(l).not.toHaveProperty("impronta");
    const f = await chiama("GET", `/v1/file/${id}`);
    expect(f.stato).toBe(200); expect(f.r.headers.get("content-disposition")).toContain(".flcut");
    expect((await chiama("GET", `/v1/anteprima/${id}`)).stato).toBe(200);
    expect((await chiama("GET", `/v1/lavoro/${id}`)).dati.scaricati_n).toBe(1);
  });
  it("senza installazione: rifiutato", async () => {
    const r = await chiama("POST", "/v1/condividi", { json: scheda() });
    expect(r.stato).toBe(401);
  });
  it("regole e opera mia obbligatorie", async () => {
    expect((await chiama("POST", "/v1/condividi", { inst: 2, json: scheda({ regole_accettate: false }) })).dati.errore).toBe("regole");
    expect((await chiama("POST", "/v1/condividi", { inst: 2, json: scheda({ opera_mia: false }) })).dati.errore).toBe("opera_mia");
  });
  it("testi con link, mail, telefono, parolacce: rifiutati", async () => {
    for (const [titolo, codice] of [["Visita www.sito.com", "testo_link"], ["scrivi a a@b.it", "testo_mail"],
      ["chiama +39 333 1234567", "testo_telefono"], ["porno gratis", "testo_parole"], ["SCATOLA BELLISSIMA GRANDE", "testo_maiuscolo"]]) {
      const r = await chiama("POST", "/v1/condividi", { inst: 3, json: scheda({ titolo }) });
      expect(r.dati.errore, titolo).toBe(codice);
    }
  });
  it("doppione: 409 con l'id esistente", async () => {
    const s = scheda();
    const a = await chiama("POST", "/v1/condividi", { inst: 4, json: s });
    for (const parte of a.dati.carica) await chiama("PUT", `/v1/carica/${a.dati.id}/${parte}`, { chiave: a.dati.chiave_autore, body: parte === "progetto" ? PROGETTO : parte === "anteprima" ? PNG : JPG });
    await chiama("POST", `/v1/concludi/${a.dati.id}`, { chiave: a.dati.chiave_autore });
    const b = await chiama("POST", "/v1/condividi", { inst: 5, json: s });
    expect(b.stato).toBe(409); expect(b.dati.id).toBe(a.dati.id);
  });
  it("limite di 5 al giorno per installazione", async () => {
    for (let i = 0; i < LIMITI.condivisioniInstGiorno; i++) expect((await chiama("POST", "/v1/condividi", { inst: 6, json: scheda() })).stato).toBe(201);
    expect((await chiama("POST", "/v1/condividi", { inst: 6, json: scheda() })).stato).toBe(429);
  });
  it("file sbagliati: tipo, grandezza, parte, chiave", async () => {
    const c = (await chiama("POST", "/v1/condividi", { inst: 7, json: scheda() })).dati;
    expect((await chiama("PUT", `/v1/carica/${c.id}/anteprima`, { chiave: c.chiave_autore, body: JPG })).dati.errore).toBe("file_tipo");
    expect((await chiama("PUT", `/v1/carica/${c.id}/mini`, { chiave: c.chiave_autore, body: PNG })).dati.errore).toBe("file_tipo");
    expect((await chiama("PUT", `/v1/carica/${c.id}/progetto`, { chiave: c.chiave_autore, body: PNG })).dati.errore).toBe("zip");
    expect((await chiama("PUT", `/v1/carica/${c.id}/foto1`, { chiave: c.chiave_autore, body: JPG })).dati.errore).toBe("parte");
    expect((await chiama("PUT", `/v1/carica/${c.id}/progetto`, { chiave: "sbagliata", body: PROGETTO })).stato).toBe(403);
    const grande = new Uint8Array(LIMITI.anteprimaByte + 1); grande.set(PNG);
    expect((await chiama("PUT", `/v1/carica/${c.id}/anteprima`, { chiave: c.chiave_autore, body: grande })).stato).toBe(413);
  });
  it("concludere con file mancanti: errore con l'elenco", async () => {
    const c = (await chiama("POST", "/v1/condividi", { inst: 8, json: scheda({ foto_n: 1 }) })).dati;
    expect(c.carica).toEqual(["progetto", "anteprima", "mini", "foto1", "foto1mini"]);
    await chiama("PUT", `/v1/carica/${c.id}/progetto`, { chiave: c.chiave_autore, body: PROGETTO });
    const r = await chiama("POST", `/v1/concludi/${c.id}`, { chiave: c.chiave_autore });
    expect(r.dati.mancano).toEqual(["anteprima", "mini", "foto1", "foto1mini"]);
  });
});

describe("controllo con l'IA", () => {
  it("NO:adult rifiuta, e il lavoro non è visibile", async () => {
    const { id, fine } = await condividiTutto(9, {}, aiFinta("NO: adult"));
    expect(fine.dati.stato).toBe("rifiutato");
    expect((await chiama("GET", `/v1/lavoro/${id}`)).stato).toBe(404);
    expect((await chiama("GET", `/v1/file/${id}`)).stato).toBe(404);
  });
  it("risposta strana o IA rotta: in attesa, mai pubblico", async () => {
    expect((await condividiTutto(10, {}, aiFinta("Sure! This looks fine"))).fine.dati.stato).toBe("attesa");
    expect((await condividiTutto(11, {}, aiFinta(() => { throw new Error("quota"); }))).fine.dati.stato).toBe("attesa");
    expect((await condividiTutto(12, {}, {})).fine.dati.stato).toBe("attesa");
  });
  it("not_laser: nascosto per la mail settimanale", async () => {
    expect((await condividiTutto(13, {}, aiFinta("NO:not_laser"))).fine.dati.stato).toBe("nascosto");
  });
  it("le foto passano tutte dal controllo", async () => {
    const ai = aiFinta("OK");
    await condividiTutto(14, { foto_n: 2 }, ai);
    expect(ai.chiamate.length).toBe(3);
    expect(ai.chiamate[0].image).toMatch(/^data:image\/jpeg;base64,/);
  });
  it("ogni ora: i lavori in attesa si ricontrollano e diventano pubblici", async () => {
    const { id } = await condividiTutto(15, {}, aiFinta("boh"));
    const r = await ogniOra({ ...E, AI: aiFinta("OK") });
    expect(r.ricontrollati).toBeGreaterThanOrEqual(1);
    expect((await chiama("GET", `/v1/lavoro/${id}`)).stato).toBe(200);
  });
  it("0.22.0: risposte scritte male che dicono il motivo: rifiuto (la prova del portachiavi esplicito)", () => {
    for (const r of ["**NO: adult**", "No, adult content.", "NO - adult", "no:adult.", "Answer: NO:adult", "OK but this is sexual",
      "NO: explicit", "The image shows a phallic shape", "\"NO:violence\""])
      expect(leggiRisposta({ response: r }).esito, r).toBe("no");
    expect(leggiRisposta({ response: "No, adult content." })).toEqual({ esito: "no", motivo: "adult" });
    expect(leggiRisposta({ response: "**OK**" }).esito).toBe("ok");
    expect(leggiRisposta({ response: "Answer: OK" }).esito).toBe("ok");
    expect(leggiRisposta({ response: "NO: not laser" }).esito).toBe("nascondi");
    expect(leggiRisposta({ response: "OK, it looks like a nice keychain for everyone" }).esito).toBe("non_so");
    expect(leggiRisposta({ response: "I cannot help with that." }).esito).toBe("non_so");
  });
  it("0.22.0: dopo un «non so» servono due OK di fila", async () => {
    expect((await condividiTutto(16, {}, aiSequenza(["boh", "OK", "OK"]))).fine.dati.stato).toBe("pubblico");
    expect((await condividiTutto(17, {}, aiSequenza(["boh", "OK", "boh"]))).fine.dati.stato).toBe("attesa");
    expect((await condividiTutto(18, {}, aiSequenza(["boh", "OK", "NO:adult"]))).fine.dati.stato).toBe("rifiutato");
    expect((await condividiTutto(19, {}, aiSequenza(["boh", "NO: adult"]))).fine.dati.stato).toBe("rifiutato");
    const ai = aiSequenza(["OK"]);
    expect((await condividiTutto(20, {}, ai)).fine.dati.stato).toBe("pubblico");
    expect(ai.chiamate.length).toBe(1); // al primo colpo basta un OK
  });
  it("0.22.0: ogni ora, un lavoro in attesa diventa pubblico solo con due OK di fila", async () => {
    const { id, chiave } = await condividiTutto(21, {}, aiFinta("boh"));
    await ogniOra({ ...E, AI: aiSequenza(["OK", "boh"]) });
    expect((await chiama("GET", `/v1/lavoro/${id}`, { chiave })).dati.stato).toBe("attesa");
    await ogniOra({ ...E, AI: aiSequenza(["OK", "NO:adult"]) });
    expect((await chiama("GET", `/v1/lavoro/${id}`)).stato).toBe(404);
    const due = await condividiTutto(22, {}, aiFinta("boh"));
    const ai = aiSequenza(["OK", "OK"]);
    await ogniOra({ ...E, AI: ai });
    expect((await chiama("GET", `/v1/lavoro/${due.id}`)).stato).toBe(200);
  });
  it("lettura delle risposte", () => {
    expect(leggiRisposta({ response: "OK" }).esito).toBe("ok");
    expect(leggiRisposta({ response: "ok." }).esito).toBe("ok");
    expect(leggiRisposta({ response: "NO:violence" })).toEqual({ esito: "no", motivo: "violence" });
    expect(leggiRisposta({ response: "NO:qualcosa" }).esito).toBe("non_so");
    expect(leggiRisposta(null).esito).toBe("non_so");
    expect(unisci([{ esito: "ok" }, { esito: "no", motivo: "hate" }]).esito).toBe("no");
  });
});

describe("community", () => {
  it("stelle: un voto per installazione, cambiabile; non sul proprio lavoro", async () => {
    const { id } = await condividiTutto(20);
    await chiama("POST", "/v1/voto", { inst: 21, json: { id, stelle: 5 } });
    await chiama("POST", "/v1/voto", { inst: 21, json: { id, stelle: 3 } });
    const r = await chiama("POST", "/v1/voto", { inst: 22, json: { id, stelle: 4 } });
    expect(r.dati.stelle_n).toBe(2); expect(r.dati.stelle_media).toBe(3.5);
    expect((await chiama("POST", "/v1/voto", { inst: 20, json: { id, stelle: 5 } })).stato).toBe(403);
    expect((await chiama("POST", "/v1/voto", { inst: 21, json: { id, stelle: 6 } })).stato).toBe(400);
  });
  it("l'ho fatto anch'io: contato una volta", async () => {
    const { id } = await condividiTutto(23);
    await chiama("POST", "/v1/fatto", { inst: 24, json: { id } });
    const r = await chiama("POST", "/v1/fatto", { inst: 24, json: { id } });
    expect(r.dati.fatti_n).toBe(1);
  });
  it("3 segnalazioni da installazioni diverse: nascosto", async () => {
    const { id } = await condividiTutto(25);
    for (const n of [26, 26, 27]) await chiama("POST", "/v1/segnala", { inst: n, json: { id, motivo: "copiato" } });
    expect((await chiama("GET", `/v1/lavoro/${id}`)).stato).toBe(200);
    await chiama("POST", "/v1/segnala", { inst: 28, json: { id, motivo: "spam" } });
    expect((await chiama("GET", `/v1/lavoro/${id}`)).stato).toBe(404);
  });
  it("1 segnalazione «non adatto» su un lavoro nuovo: nascosto", async () => {
    const { id } = await condividiTutto(29);
    await chiama("POST", "/v1/segnala", { inst: 30, json: { id, motivo: "non_adatto" } });
    expect((await chiama("GET", `/v1/lavoro/${id}`)).stato).toBe(404);
  });
  it("regola per nascondere", () => {
    const ora = Date.now();
    const l = { segnalazioni_n: 1, revisionate_n: 0, pubblicato: ora - 1000, stelle_n: 0 };
    expect(daNascondere(l, "non_adatto", ora)).toBe(true);
    expect(daNascondere({ ...l, stelle_n: 9 }, "non_adatto", ora)).toBe(false);
    expect(daNascondere({ ...l, pubblicato: ora - 30 * 86400000 }, "non_adatto", ora)).toBe(false);
    expect(daNascondere({ ...l, segnalazioni_n: 3 }, "spam", ora)).toBe(true);
    expect(daNascondere({ ...l, segnalazioni_n: 3, revisionate_n: 3 }, "spam", ora)).toBe(false);
  });
  it("motivo sconosciuto: rifiutato", async () => {
    const { id } = await condividiTutto(31);
    expect((await chiama("POST", "/v1/segnala", { inst: 32, json: { id, motivo: "boh" } })).stato).toBe(400);
  });
});

describe("autore e amministratore", () => {
  it("l'autore modifica e toglie con la sua chiave", async () => {
    const { id, chiave } = await condividiTutto(40);
    expect((await chiama("POST", `/v1/modifica/${id}`, { chiave, json: { titolo: "Scatola nuova" } })).stato).toBe(200);
    expect((await chiama("GET", `/v1/lavoro/${id}`)).dati.titolo).toBe("Scatola nuova");
    expect((await chiama("POST", `/v1/modifica/${id}`, { chiave, json: { titolo: "vai su www.x.com" } })).stato).toBe(400);
    expect((await chiama("POST", `/v1/togli/${id}`, { chiave: "sbagliata" })).stato).toBe(403);
    expect((await chiama("POST", `/v1/togli/${id}`, { chiave })).stato).toBe(200);
    expect((await chiama("GET", `/v1/file/${id}`)).stato).toBe(404);
    expect(await E.FILES.get(`${id}/progetto`)).toBeNull();
  });
  it("amministratore: elenco dei nascosti, ripristina, togli; chiave sbagliata rifiutata", async () => {
    const { id } = await condividiTutto(41, {}, aiFinta("NO:not_laser"));
    expect((await chiama("GET", "/v1/admin/nascosti", { admin: "sbagliata" })).stato).toBe(403);
    const el = await chiama("GET", "/v1/admin/nascosti", { admin: ADMIN });
    expect(el.dati.map((l: any) => l.id)).toContain(id);
    expect((await chiama("POST", `/v1/admin/ripristina/${id}`, { admin: ADMIN })).stato).toBe(200);
    expect((await chiama("GET", `/v1/lavoro/${id}`)).stato).toBe(200);
    expect((await chiama("POST", `/v1/admin/togli/${id}`, { admin: ADMIN })).stato).toBe(200);
    expect((await chiama("GET", `/v1/lavoro/${id}`)).stato).toBe(404);
  });
  it("0.22.0: l'anteprima di un lavoro non pubblico la vede solo l'autore", async () => {
    const { id, chiave } = await condividiTutto(43, {}, aiFinta("?"));
    expect((await chiama("GET", `/v1/anteprima/${id}`)).stato).toBe(404);
    expect((await chiama("GET", `/v1/anteprima/${id}`, { chiave: "x".repeat(40) })).stato).toBe(404);
    const r = await chiama("GET", `/v1/anteprima/${id}`, { chiave });
    expect(r.stato).toBe(200);
    expect(r.r.headers.get("cache-control")).toBe("private, no-store");
    expect((await chiama("GET", `/v1/file/${id}`, { chiave })).stato).toBe(404); // il progetto no
    await chiama("POST", `/v1/togli/${id}`, { chiave, json: {} });
    expect((await chiama("GET", `/v1/anteprima/${id}`, { chiave })).stato).toBe(404);
  });
  it("l'autore vede lo stato del suo lavoro in attesa", async () => {
    const { id, chiave } = await condividiTutto(42, {}, aiFinta("?"));
    expect((await chiama("GET", `/v1/lavoro/${id}`)).stato).toBe(404);
    const r = await chiama("GET", `/v1/lavoro/${id}`, { chiave });
    expect(r.dati.stato).toBe("attesa");
  });
});

describe("elenco", () => {
  it("filtri, ricerca e pagine", async () => {
    await condividiTutto(50, { categoria: "giochi", titolo: "Puzzle del drago", materiale: "Pioppo" });
    const r = await chiama("GET", "/v1/elenco?categoria=giochi&cerca=drago");
    expect(r.dati.lavori.length).toBe(1);
    expect((await chiama("GET", "/v1/elenco?materiale=piop")).dati.lavori.length).toBeGreaterThanOrEqual(1);
    expect((await chiama("GET", "/v1/elenco?cerca=%25")).dati.lavori.length).toBe(0);
    expect((await chiama("GET", "/v1/elenco?pagina=-5&ordine=strano")).stato).toBe(200);
  });
});

describe("controlli senza rete", () => {
  it("ZIP: solo project.json e images/*.png, niente bombe", () => {
    expect(() => controllaZip(PROGETTO)).not.toThrow();
    expect(() => controllaZip(zip([{ nome: "images/a.png", dati: new Uint8Array(3) }]))).toThrow(/project.json/);
    expect(() => controllaZip(zip([{ nome: "project.json", dati: new Uint8Array(3) }, { nome: "../evil.exe", dati: new Uint8Array(3) }]))).toThrow(/non ammesso/);
    expect(() => controllaZip(zip([{ nome: "project.json", dati: new Uint8Array(10), espanso: 10 * 1000 }]))).toThrow(/gonfiato/);
    expect(() => controllaZip(new Uint8Array(30))).toThrow(Rifiuto);
  });
  it("testi", () => {
    expect(controllaTesto("Portachiavi con il nome, 3 mm")).toBeNull();
    expect(controllaTesto("Città di L'Aquila 2026")).toBeNull();
    expect(controllaTesto("Aaaaaaaaaaaa")).toBe("ripetuto");
    for (const t of ["Portachiavi con contenuto esplicito", "Explicit keychain", "Llavero erótico", "Porte-clés sexy"])
      expect(controllaTesto(t), t).toBe("parole");
    for (const t of ["Tagliere in legno nudo", "Hard maple 6 mm", "Scatola per hard disk", "Sesto senso"])
      expect(controllaTesto(t), t).toBeNull();
  });
  it("scheda: categorie, licenze e numeri fuori dai limiti", () => {
    expect(() => controllaScheda(scheda({ categoria: "armi" }))).toThrow(/categoria/);
    expect(() => controllaScheda(scheda({ licenza: "tutti i diritti" }))).toThrow(/licenza/);
    expect(() => controllaScheda(scheda({ spessore_mm: -1 }))).toThrow(/spessore/);
    expect(() => controllaScheda(scheda({ foto_n: 4 }))).toThrow(/foto_n/);
    expect(() => controllaScheda(scheda({ impronta: "x".repeat(64) }))).toThrow(/impronta/);
  });
});
