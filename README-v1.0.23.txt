TSU Ainet v1.0.23 – Vereinsmenü Listenansicht

Geändert:
- Vereinsbereich nicht mehr als kleine Kacheln, sondern als vertikale Liste.
- Alle Namen werden vollständig ausgeschrieben.
- Alle Beschreibungen werden vollständig angezeigt.
- „Spielergebnis eintragen“ wird nicht mehr abgeschnitten.
- Vereinsinfo, Trainingsplaner, Sponsoren, Trainer, Termine usw. bleiben unverändert verlinkt.
- Administration bleibt als eigener Eintrag unter der Liste.
- Desktop und Smartphone verwenden dieselbe übersichtliche Listenstruktur.

Dateien ersetzen/kopieren:
- src/Dashboard.tsx
- src/ClearClubListFix.css (neu)

Danach:
npm run build

Wenn 0 Fehler:
firebase deploy --only hosting
