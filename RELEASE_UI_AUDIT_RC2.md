# Version 18.2.5 RC3 – Phase 2 UI Audit

## Umgesetzt

- nicht personalisierter Willkommens-Hero
- „Willkommen bei der TSU Ainet“
- „Since 1966“
- Slogan „Mehr als ein Verein – eine Familie“
- automatischer Matchday-Zustand am Spieltag
- größere Vereinslogos in der Spielkarte
- Tabellenreihenfolge: Platz, Logo, Verein, Spiele, Punkte
- TSU Ainet in der Tabelle optisch hervorgehoben
- 11teamsports-Kennzeichnung im Fanshop
- Navigation „Verein“ statt „Mehr“
- automatischer statischer UI-Audit
- eigener GitHub-Actions-Workflow für den UI-Audit
- Fallback-Hintergrund für den Hero

## Prüfung

```bash
npm install
npm run release:ui-audit
npm run release:check
```

Ein eigenes Foto kann später die Datei `public/tsu-ainet-hero.svg` ersetzen oder über die CSS-Variable `--tsu-hero-image` gesetzt werden.
