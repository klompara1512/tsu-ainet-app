# KFV-Fehlerbehebung

Behoben wurden:

- `src/kfvFirestore.ts` war leer und wurde vollständig ergänzt.
- `src/kfvTypes.ts` war leer und wurde vollständig ergänzt.
- Der CSS-Import in `src/kfvLive.tsx` verweist jetzt korrekt auf `src/assets/kfvLive.css`.
- `Dashboard.tsx` enthält nun die Seite `kfv-live` und übergibt `onOpenKfvLive` an das Live-Dashboard.
- TypeScript-Type-Imports wurden korrigiert.

## Start unter Windows

Im Projektordner ausführen:

```bash
npm install
npm run dev
```

Zum Prüfen des Produktions-Builds:

```bash
npm run build
```

Die Collections `kfvMatches` und `kfvStandings` dürfen zunächst leer sein. Die App zeigt dann einen leeren Hinweis an, sollte aber ohne Importfehler starten.
