// Prepara Cloudflare prima della pubblicazione: crea D1 e KV se mancano e scrive i loro ID in wrangler.toml.
// Gira solo dentro GitHub Actions (servono CLOUDFLARE_API_TOKEN e CLOUDFLARE_ACCOUNT_ID). Si può rilanciare: non duplica niente.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const DB = "flc-galleria";
const KV = "flc-galleria-file";
const w = (...a) => execFileSync("npx", ["wrangler", ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const json = (s) => JSON.parse(s.slice(s.indexOf("[")));

function idD1() {
  const l = json(w("d1", "list", "--json"));
  return (l.find((d) => d.name === DB) || {}).uuid;
}
function idKV() {
  const l = json(w("kv", "namespace", "list"));
  return (l.find((n) => n.title === KV || n.title.endsWith("-" + KV)) || {}).id;
}

let d1 = idD1();
if (!d1) { console.log("Creo il database D1", DB); w("d1", "create", DB); d1 = idD1(); }
let kv = idKV();
if (!kv) { console.log("Creo lo spazio KV", KV); w("kv", "namespace", "create", KV); kv = idKV(); }
if (!d1 || !kv) { console.error("Non trovo D1 o KV dopo averli creati"); process.exit(1); }

const t = readFileSync("wrangler.toml", "utf8").replace("__D1_ID__", d1).replace("__KV_ID__", kv);
writeFileSync("wrangler.toml", t);
console.log("D1:", d1, " KV:", kv);
