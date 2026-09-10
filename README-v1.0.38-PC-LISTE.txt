TSU Ainet v1.0.38 – Vereinsbereich PC Listenansicht

Geändert:
- Vereinsbereich am PC jetzt einspaltig als Liste wie mobil.
- Alle Bezeichnungen und Untertitel vollständig lesbar.
- Keine abgeschnittenen Texte mehr bei Sponsoren, Trikotsätze, Trainings- & Spielplaner usw.
- Mobile Darstellung bleibt ebenfalls als Liste bestehen.

Dateien ersetzen:
src/Dashboard.tsx
src/ClearClubListFix.css

Danach: npm run build && firebase deploy --only hosting
