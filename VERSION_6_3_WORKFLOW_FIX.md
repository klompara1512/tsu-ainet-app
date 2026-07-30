# Version 6.3 – GitHub-Actions-Fix

Der Workflow verwendet nicht mehr `npm ci` und ist daher nicht von einer veralteten `package-lock.json` abhängig.
Für die automatische Synchronisierung werden nur die drei benötigten Pakete installiert:

- firebase-admin
- cheerio
- puppeteer

Der Workflow läuft automatisch alle 30 Minuten und kann zusätzlich manuell gestartet werden.
