# Galleria FreeLaserCut

Il servizio che riceve, controlla e mostra i lavori condivisi dagli utenti di [FreeLaserCut](https://github.com/fringuello79/FreeLaserCut).

- **Dove gira:** Cloudflare (piano gratuito). Worker per le regole, D1 per il database, KV per i file, Workers AI per il controllo delle immagini.
- **Indirizzo:** `https://flc-galleria.freelasercut.workers.dev/v1/…` (elenco degli indirizzi in `src/index.ts`).
- **Pubblicazione:** a ogni push su `main`, GitHub Actions fa le prove e, se passano, pubblica (`.github/workflows/pubblica.yml`).
- **Segreti** (Settings → Secrets and variables → Actions): `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `GALLERIA_ADMIN_TOKEN`.

## Regole
- Niente account: ogni installazione di FreeLaserCut ha un numero a caso; il servizio ne salva solo un'impronta con sale.
- Controlli automatici a ogni condivisione: dati, testi (niente link, mail, telefoni, parole vietate), file (`.flcut` con solo `project.json` e `images/*.png`, niente file gonfiati), immagini con l'IA. Senza un «OK» dell'IA un lavoro non diventa mai pubblico; dopo una risposta dubbia servono due «OK» di fila (1.1.0). Una risposta scritta male che nomina un motivo di rifiuto vale come rifiuto. L'autore vede l'anteprima dei suoi lavori non ancora pubblici, con la sua chiave.
- Poi decide la community: stelle, «L'ho fatto anch'io», segnalazioni. Con 3 segnalazioni (o 1 «non adatto» su un lavoro nuovo) il lavoro si nasconde da solo.
- Limiti: 5 condivisioni al giorno per installazione, 200 in tutto.

## Prove
```
npm ci
npm test
```

Licenza: GPL-3.0-or-later.
