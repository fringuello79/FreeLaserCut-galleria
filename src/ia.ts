// Galleria FreeLaserCut — controllo delle immagini e dei testi con Workers AI.
// Risposta attesa: «OK» oppure «NO:<motivo>». Qualunque altra cosa vale «non so»: il lavoro resta in attesa.

export const MODELLO = "@cf/meta/llama-3.2-11b-vision-instruct";
export const MOTIVI_RIFIUTO = ["adult", "violence", "hate", "weapon", "drugs", "spam"] as const;

export type Esito = { esito: "ok" } | { esito: "no"; motivo: string } | { esito: "nascondi"; motivo: string } | { esito: "non_so"; motivo: string };

const ISTRUZIONI =
  "You moderate a public gallery of laser engraving and laser cutting projects (wood signs, boxes, keychains, " +
  "ornaments, photos engraved on wood, test grids). You get one picture (a project preview or a photo of the " +
  "finished piece) and its title and description, written by a user in any language. Reply with exactly one line: " +
  "OK if it is acceptable for all ages, or NO:<reason> where reason is one of adult, violence, hate, weapon, drugs, " +
  "spam, not_laser. Sexual shapes (genitals, sex acts) and texts that call the content explicit, sexual, erotic or " +
  "adult are NO:adult. Use not_laser only if the picture clearly has nothing to do with a laser project. " +
  "Ordinary objects, text, logos, animals, people in normal photos and holiday themes are OK. Do not explain.";

// Parole che, dentro una risposta scritta male, dicono comunque il motivo del rifiuto (0.22.0: la prova di Ale del
// 22/11 con un portachiavi esplicito ha avuto una risposta che non era né «OK» né «NO:adult», ed è rimasto in attesa).
const SINONIMI: Record<string, string> = {
  adult: "adult", sexual: "adult", sex: "adult", explicit: "adult", nsfw: "adult", porn: "adult", nudity: "adult",
  nude: "adult", erotic: "adult", genital: "adult", genitals: "adult", phallic: "adult", penis: "adult",
  violence: "violence", violent: "violence", gore: "violence", blood: "violence",
  hate: "hate", hateful: "hate", racist: "hate", nazi: "hate",
  weapon: "weapon", weapons: "weapon", gun: "weapon", guns: "weapon", firearm: "weapon",
  drugs: "drugs", drug: "drugs", cannabis: "drugs", marijuana: "drugs",
  spam: "spam", advertising: "spam", advertisement: "spam",
};

export function leggiRisposta(r: unknown): Esito {
  const t = typeof r === "string" ? r : (r as any)?.response;
  if (typeof t !== "string") return { esito: "non_so", motivo: "risposta vuota" };
  // via la formattazione che i modelli aggiungono (grassetto, virgolette, punto finale, «Answer:»)
  const s = t.trim().replace(/[*`"'«»“”]/g, "").replace(/^\s*(answer|reply|risposta)\s*[:\-]\s*/i, "").trim();
  const parole = s.toLowerCase().split(/[^a-z_]+/).filter(Boolean);
  const m = /^no\s*[:,\-]?\s*([a-z_]+)/i.exec(s);
  if (m) {
    const motivo = m[1].toLowerCase();
    if ((MOTIVI_RIFIUTO as readonly string[]).includes(motivo)) return { esito: "no", motivo };
    if (motivo === "not_laser" || (motivo === "not" && parole.includes("laser"))) return { esito: "nascondi", motivo: "not_laser" };
  }
  // un motivo di rifiuto scritto da qualche parte vale come rifiuto, anche se la risposta comincia con «OK»
  for (const p of parole) if (SINONIMI[p]) return { esito: "no", motivo: SINONIMI[p] };
  if (/^ok\b/i.test(s) && parole.length <= 3) return { esito: "ok" };
  return { esito: "non_so", motivo: s.slice(0, 60) };
}

function base64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function controllaImmagine(ai: any, jpeg: Uint8Array, titolo: string, descrizione: string): Promise<Esito> {
  if (!ai || typeof ai.run !== "function") return { esito: "non_so", motivo: "IA non disponibile" };
  try {
    const r = await ai.run(MODELLO, {
      messages: [
        { role: "system", content: ISTRUZIONI },
        { role: "user", content: `Title: ${titolo}\nDescription: ${descrizione || "-"}` },
      ],
      image: "data:image/jpeg;base64," + base64(jpeg),
      max_tokens: 12,
      temperature: 0,
    });
    return leggiRisposta(r);
  } catch (e) {
    return { esito: "non_so", motivo: "errore IA: " + String((e as Error)?.message || e).slice(0, 60) };
  }
}

// Unisce gli esiti di più immagini: basta un «no» per rifiutare; un «non so» lascia in attesa.
export function unisci(esiti: Esito[]): Esito {
  const no = esiti.find((e) => e.esito === "no");
  if (no) return no;
  const ns = esiti.find((e) => e.esito === "non_so");
  if (ns) return ns;
  const na = esiti.find((e) => e.esito === "nascondi");
  if (na) return na;
  return { esito: "ok" };
}
