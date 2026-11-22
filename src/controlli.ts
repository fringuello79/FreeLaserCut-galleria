// Galleria FreeLaserCut — controlli automatici sui dati, sui testi e sui file. Niente rete: si provano da soli.

export const CATEGORIE = [
  "insegne", "scatole", "portachiavi", "decorazioni", "giochi",
  "casa", "utensili", "foto", "test", "altro",
] as const;
export const TIPI = ["taglio", "incisione", "entrambi"] as const;
export const LICENZE = ["cc-by-4.0", "cc-by-nc-4.0", "cc0"] as const;
export const MOTIVI = ["non_funziona", "non_adatto", "copiato", "spam"] as const;

export const LIMITI = {
  condivisioniInstGiorno: 5,
  condivisioniTotaliGiorno: 200,
  segnalazioniInstGiorno: 20,
  progettoByte: 10 * 1024 * 1024,
  anteprimaByte: 1024 * 1024,
  miniByte: 120 * 1024,
  fotoByte: 1024 * 1024,
  fotoMax: 3,
  zipVoci: 500,
  zipEspanso: 200 * 1024 * 1024,
  zipRapporto: 300,
};

export type Scheda = {
  titolo: string; descrizione: string; categoria: string; materiale: string;
  spessore_mm: number | null; laser_famiglia: string; potenza_w: number | null; tipo: string;
  larghezza_mm: number | null; altezza_mm: number | null; tempo_s: number | null;
  licenza: string; autore_nome: string; impronta: string; versione_flc: string; foto_n: number;
};

export class Rifiuto extends Error {
  constructor(public codice: string, messaggio: string, public stato = 400) { super(messaggio); }
}

function testo(v: unknown, campo: string, min: number, max: number): string {
  if (v === undefined || v === null) v = "";
  if (typeof v !== "string") throw new Rifiuto("campo", `${campo}: deve essere un testo`);
  const s = v.normalize("NFC").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (s.length < min) throw new Rifiuto("campo", `${campo}: troppo corto (almeno ${min} caratteri)`);
  if (s.length > max) throw new Rifiuto("campo", `${campo}: troppo lungo (al massimo ${max} caratteri)`);
  return s;
}

function numero(v: unknown, campo: string, min: number, max: number, facoltativo = true): number | null {
  if ((v === undefined || v === null || v === "") && facoltativo) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max)
    throw new Rifiuto("campo", `${campo}: numero fra ${min} e ${max}`);
  return v;
}

function scelta<T extends readonly string[]>(v: unknown, campo: string, valori: T): T[number] {
  if (typeof v !== "string" || !(valori as readonly string[]).includes(v))
    throw new Rifiuto("campo", `${campo}: valore non valido`);
  return v as T[number];
}

// ------------------------------------------------------------------ testi
const PAROLE_VIETATE = [
  // spam e pubblicità
  "viagra", "cialis", "casino", "scommesse", "bitcoin", "crypto", "forex", "escort", "onlyfans", "telegram.me",
  // contenuti per adulti
  "porn", "porno", "xxx", "nsfw", "hentai",
  // 0.22.0: chi descrive il proprio lavoro come esplicito o per adulti (it, en, es, fr, pt)
  "esplicito", "esplicita", "espliciti", "esplicite", "explicit", "explicito", "explicita", "explicite",
  // non «nudo» (legno nudo) né «hard» (hard maple, hard disk)
  "sex", "sexy", "sesso", "sexo", "sexe", "erotico", "erotica", "erotic", "erotique", "nudes", "dildo", "penis",
  "vagina",
  // volgarità frequenti (it, en, es, fr, pt); il resto lo guarda il controllo con l'IA
  "cazzo", "puttana", "troia", "vaffanculo", "fuck", "shit", "bitch", "puta", "mierda", "joder",
  "putain", "merde", "salope", "caralho", "porra",
];

export function controllaTesto(s: string): string | null {
  if (!s) return null;
  const t = s.toLowerCase();
  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(s)) return "mail";
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|it|ru|cn|xyz|shop|top|info|biz|me|ly)\b/i.test(s)) return "link";
  if (/(\+?\d[\d .\-()]{7,}\d)/.test(s) && (s.match(/\d/g) || []).length >= 9) return "telefono";
  const parole = t.normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9.]+/);
  for (const p of PAROLE_VIETATE) if (parole.includes(p)) return "parole";
  if (/(.)\1{7,}/.test(s)) return "ripetuto";
  const lettere = s.replace(/[^\p{L}]/gu, "");
  if (lettere.length > 12 && lettere.replace(/[^\p{Lu}]/gu, "").length / lettere.length > 0.8) return "maiuscolo";
  return null;
}

// ------------------------------------------------------------------ scheda
export function controllaScheda(b: any): Scheda {
  if (!b || typeof b !== "object") throw new Rifiuto("scheda", "scheda mancante");
  if (b.regole_accettate !== true) throw new Rifiuto("regole", "bisogna accettare le regole della Galleria");
  if (b.opera_mia !== true) throw new Rifiuto("opera_mia", "bisogna dichiarare che il lavoro è tuo o che puoi condividerlo");
  const s: Scheda = {
    titolo: testo(b.titolo, "titolo", 3, 80),
    descrizione: testo(b.descrizione, "descrizione", 0, 600),
    categoria: scelta(b.categoria, "categoria", CATEGORIE),
    materiale: testo(b.materiale, "materiale", 2, 60),
    spessore_mm: numero(b.spessore_mm, "spessore_mm", 0, 100),
    laser_famiglia: testo(b.laser_famiglia, "laser_famiglia", 0, 80),
    potenza_w: numero(b.potenza_w, "potenza_w", 0, 500),
    tipo: scelta(b.tipo, "tipo", TIPI),
    larghezza_mm: numero(b.larghezza_mm, "larghezza_mm", 0, 3000),
    altezza_mm: numero(b.altezza_mm, "altezza_mm", 0, 3000),
    tempo_s: numero(b.tempo_s, "tempo_s", 0, 7 * 24 * 3600),
    licenza: scelta(b.licenza, "licenza", LICENZE),
    autore_nome: testo(b.autore_nome, "autore_nome", 0, 40),
    impronta: testo(b.impronta, "impronta", 64, 64).toLowerCase(),
    versione_flc: testo(b.versione_flc, "versione_flc", 0, 20),
    foto_n: numero(b.foto_n ?? 0, "foto_n", 0, LIMITI.fotoMax, false) as number,
  };
  if (!/^[0-9a-f]{64}$/.test(s.impronta)) throw new Rifiuto("campo", "impronta: 64 cifre esadecimali");
  if (!Number.isInteger(s.foto_n)) throw new Rifiuto("campo", "foto_n: numero intero");
  for (const [campo, v] of [["titolo", s.titolo], ["descrizione", s.descrizione], ["materiale", s.materiale],
                            ["autore_nome", s.autore_nome], ["laser_famiglia", s.laser_famiglia]] as const) {
    const m = controllaTesto(v);
    if (m) throw new Rifiuto("testo_" + m, `${campo}: testo non accettato (${m})`);
  }
  return s;
}

// ------------------------------------------------------------------ file
export function parti(fotoN: number): string[] {
  const p = ["progetto", "anteprima", "mini"];
  for (let i = 1; i <= fotoN; i++) p.push(`foto${i}`, `foto${i}mini`);
  return p;
}

export function limiteParte(parte: string): number {
  if (parte === "progetto") return LIMITI.progettoByte;
  if (parte === "anteprima") return LIMITI.anteprimaByte;
  if (parte === "mini" || parte.endsWith("mini")) return LIMITI.miniByte;
  return LIMITI.fotoByte;
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPG = [0xff, 0xd8, 0xff];
function inizia(b: Uint8Array, firma: number[]) { return b.length >= firma.length && firma.every((x, i) => b[i] === x); }

export function controllaParte(parte: string, b: Uint8Array): void {
  if (b.length === 0) throw new Rifiuto("file_vuoto", "file vuoto");
  if (b.length > limiteParte(parte)) throw new Rifiuto("file_grande", "file troppo grande", 413);
  if (parte === "progetto") return controllaZip(b);
  if (parte === "anteprima") { if (!inizia(b, PNG)) throw new Rifiuto("file_tipo", "l'anteprima deve essere PNG"); return; }
  if (!inizia(b, JPG)) throw new Rifiuto("file_tipo", "le foto e le miniature devono essere JPEG");
}

// Legge solo la directory centrale dello ZIP: niente decompressione (pochi millisecondi anche per 10 MB).
export function controllaZip(b: Uint8Array): void {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (b.length < 22 || v.getUint32(0, true) !== 0x04034b50) throw new Rifiuto("zip", "il progetto non è un file .flcut");
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Rifiuto("zip", "file .flcut rovinato");
  const voci = v.getUint16(eocd + 10, true);
  const dim = v.getUint32(eocd + 12, true);
  const inizio = v.getUint32(eocd + 16, true);
  if (voci === 0 || voci > LIMITI.zipVoci) throw new Rifiuto("zip", "troppi file dentro il progetto");
  if (inizio + dim > eocd) throw new Rifiuto("zip", "file .flcut rovinato");
  let p = inizio, espanso = 0, compresso = 0, progetto = false;
  const dec = new TextDecoder("utf-8", { fatal: false, ignoreBOM: false });
  for (let n = 0; n < voci; n++) {
    if (p + 46 > eocd || v.getUint32(p, true) !== 0x02014b50) throw new Rifiuto("zip", "file .flcut rovinato");
    const flag = v.getUint16(p + 8, true);
    const metodo = v.getUint16(p + 10, true);
    const c = v.getUint32(p + 20, true), u = v.getUint32(p + 24, true);
    const ln = v.getUint16(p + 28, true), le = v.getUint16(p + 30, true), lc = v.getUint16(p + 32, true);
    const nome = dec.decode(b.subarray(p + 46, p + 46 + ln));
    if (flag & 1) throw new Rifiuto("zip", "file cifrati non ammessi");
    if (metodo !== 0 && metodo !== 8) throw new Rifiuto("zip", "compressione non ammessa");
    if (nome === "project.json") progetto = true;
    else if (!/^images\/[A-Za-z0-9_-]{1,64}\.png$/.test(nome)) throw new Rifiuto("zip", "file non ammesso nel progetto: " + nome.slice(0, 60));
    if (c > 0 && u / c > LIMITI.zipRapporto) throw new Rifiuto("zip", "file .flcut gonfiato");
    espanso += u; compresso += c;
    if (espanso > LIMITI.zipEspanso) throw new Rifiuto("zip", "progetto troppo grande una volta aperto");
    p += 46 + ln + le + lc;
  }
  if (!progetto) throw new Rifiuto("zip", "manca project.json: non è un progetto di FreeLaserCut");
  if (compresso > b.length) throw new Rifiuto("zip", "file .flcut rovinato");
}

// ------------------------------------------------------------------ ordine
export function punteggio(somma: number, n: number, fatti: number): number {
  const C = 5, m = 3.5;
  return (C * m + somma) / (C + n) + Math.min(fatti, 50) * 0.02;
}
