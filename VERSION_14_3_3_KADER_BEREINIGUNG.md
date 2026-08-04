# Version 14.3.3 – Kaderbereinigung

- Strenger Kaderparser: Navigation, Seitentitel, „Zu- & Abgänge“, „TSU Ainet“, Dachangebots-Texte und sonstige Nicht-Spieler werden ausgeschlossen.
- Doppelte DOM-Treffer werden pro Mannschaft nach normalisiertem Namen zusammengeführt.
- Dokument-IDs enthalten nun zusätzlich die Mannschaftskennung.
- Alte Kaderdokumente ohne `teamKey` oder mit früheren `teamId`-Werten werden erkannt und bereinigt.
- Alte Dubletten und falsche Spieler-Dokumente werden deaktiviert.
- Statusdiagnose enthält `rawCandidateCount`, `invalidFiltered`, `duplicateFiltered`, `invalidDeactivated` und `duplicateDeactivated`.
