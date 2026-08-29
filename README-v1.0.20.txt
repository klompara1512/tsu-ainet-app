TSU Ainet v1.0.20 – Spielergebnis direkt im Verein-Menü

Neu:
- Im sichtbaren Bereich „Verein“ gibt es eine eigene Kachel:
  „Spielergebnis eintragen“
  Untertitel: „Nach Spielende für dein Team“
- Sichtbar für Trainer, Sektionsleitung und Admin.
- Beim Antippen öffnet sich direkt „Spiele & Ergebnisse“.
- Im jeweiligen Spiel bleibt die Ergebnisfunktion vor Spielende sichtbar, aber gesperrt.
- Nach Spielende wird sie automatisch freigeschaltet.
- Trainer können weiterhin ausschließlich Ergebnisse ihrer zugeordneten Mannschaft eintragen.

Spielzeiten/Freigabe:
- U17: 2 × 45 Min. + Nachspielzeit
- U12: 3 × 20 Min.
- U10: 4 × 12 Min.
- Pausen und ein realistischer Puffer bis zum Spielende sind berücksichtigt.

Einspielen:
1. src/Dashboard.tsx ersetzen
2. src/kfvLive.tsx ersetzen
3. npm run build
4. Bei erfolgreichem Build: firebase deploy --only hosting
