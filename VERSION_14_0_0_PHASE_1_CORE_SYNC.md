# Version 14.0.0 – Phase 1 Core Sync

Der automatische 30-Minuten-Workflow synchronisiert nur noch:

- Spielpläne
- Ergebnisse
- Tabellen
- Spielstatus

Nicht mehr im regelmäßigen Workflow enthalten:

- Kader und Spielerfotos
- separate Vereinsseiten/Logo-Suche
- Spielberichte und Aufstellungen
- Dubletten-Großbereinigung

Diese langsamen Datenarten bleiben im manuellen Workflow **KFV / ÖFB Voll-Sync manuell** verfügbar und werden in den nächsten Phasen in eigene Tages-Workflows ausgelagert.

## GitHub Actions

- `KFV / ÖFB Core-Daten synchronisieren`: automatisch alle 30 Minuten, Zeitlimit 15 Minuten
- `KFV / ÖFB Voll-Sync manuell`: nur manuell, Zeitlimit 45 Minuten

## Lokale Prüfung

```bash
npm install
npm run sync:check
npm run typecheck
npm run dev
```
