-- Galleria FreeLaserCut: schema iniziale (22/11/2026)
CREATE TABLE IF NOT EXISTS config (chiave TEXT PRIMARY KEY, valore TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS lavori (
  id TEXT PRIMARY KEY,
  titolo TEXT NOT NULL,
  descrizione TEXT NOT NULL DEFAULT '',
  categoria TEXT NOT NULL,
  materiale TEXT NOT NULL,
  spessore_mm REAL,
  laser_famiglia TEXT NOT NULL DEFAULT '',
  potenza_w REAL,
  tipo TEXT NOT NULL,
  larghezza_mm REAL,
  altezza_mm REAL,
  tempo_s INTEGER,
  licenza TEXT NOT NULL,
  autore_nome TEXT NOT NULL DEFAULT '',
  impronta TEXT NOT NULL,
  versione_flc TEXT NOT NULL DEFAULT '',
  inst_hash TEXT NOT NULL,
  chiave_hash TEXT NOT NULL,
  foto_n INTEGER NOT NULL DEFAULT 0,
  parti TEXT NOT NULL DEFAULT '',
  stato TEXT NOT NULL,             -- caricamento | attesa | pubblico | nascosto | rifiutato | tolto
  motivo_stato TEXT NOT NULL DEFAULT '',
  tentativi_ia INTEGER NOT NULL DEFAULT 0,
  creato INTEGER NOT NULL,         -- millisecondi
  pubblicato INTEGER,
  stelle_somma INTEGER NOT NULL DEFAULT 0,
  stelle_n INTEGER NOT NULL DEFAULT 0,
  fatti_n INTEGER NOT NULL DEFAULT 0,
  segnalazioni_n INTEGER NOT NULL DEFAULT 0,
  revisionate_n INTEGER NOT NULL DEFAULT 0,
  scaricati_n INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS lavori_stato ON lavori (stato, pubblicato);
CREATE INDEX IF NOT EXISTS lavori_impronta ON lavori (impronta);
CREATE INDEX IF NOT EXISTS lavori_inst ON lavori (inst_hash, creato);

CREATE TABLE IF NOT EXISTS voti (lavoro TEXT NOT NULL, inst_hash TEXT NOT NULL, stelle INTEGER NOT NULL, data INTEGER NOT NULL, PRIMARY KEY (lavoro, inst_hash));
CREATE TABLE IF NOT EXISTS fatti (lavoro TEXT NOT NULL, inst_hash TEXT NOT NULL, data INTEGER NOT NULL, PRIMARY KEY (lavoro, inst_hash));
CREATE TABLE IF NOT EXISTS segnalazioni (lavoro TEXT NOT NULL, inst_hash TEXT NOT NULL, motivo TEXT NOT NULL, data INTEGER NOT NULL, PRIMARY KEY (lavoro, inst_hash));
CREATE TABLE IF NOT EXISTS limiti (inst_hash TEXT NOT NULL, giorno TEXT NOT NULL, tipo TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (inst_hash, giorno, tipo));
