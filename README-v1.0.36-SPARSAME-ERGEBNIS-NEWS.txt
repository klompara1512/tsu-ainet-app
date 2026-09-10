TSU Ainet v1.0.36 – sparsame automatische Ergebnis-News

Änderung gegenüber v1.0.35:
- KEIN GitHub-Actions-Zeitplan alle 15 Minuten mehr.
- Der Workflow "Automatische Ergebnis-News" ist nur noch manuell startbar.
- U10/U12: Beim manuellen Speichern des Endstands wird die News direkt in derselben Firestore-Batch erstellt/aktualisiert.
- U17/Challenge/KM: Die automatische News wird weiterhin am Ende der ohnehin vorhandenen Spiel-/Spielbericht-Synchronisierung erzeugt.
- Pro Spiel wird weiterhin dieselbe feste News-ID verwendet; Ergebniskorrekturen aktualisieren den Beitrag statt einen zweiten zu erzeugen.

Wichtig:
Da Trainer nun beim U10/U12-Ergebnis direkt eine streng eingeschränkte automatische News mitschreiben dürfen, muss firestore.rules einmal mit veröffentlicht werden.

Dateien ersetzen:
- src/kfvFirestore.ts
- firestore.rules
- scripts/auto-result-news.cjs
- scripts/kfv-report-news-sync.cjs
- .github/workflows/auto-result-news.yml
- .github/workflows/kfv-games-sync.yml
- .github/workflows/kfv-report-news-sync.yml
- package.json

Danach:
npm run build
firebase deploy --only firestore:rules
firebase deploy --only hosting

Anschließend committen und zu GitHub pushen, damit die Workflow-Änderungen aktiv werden.
