# Version 11.2.1 – Spielplan- und Logo-Stabilisierung

Diese Bugfix-Version verhindert Datenverlust bei teilweise geladenen ÖFB-Seiten. Der bestehende Spielplan wird mit den aktuellen Daten zusammengeführt, statt fehlende Mannschaften oder Spiele zu deaktivieren. Vereinslogos werden bei kurzfristig leeren Quellfeldern aus dem vorhandenen Firestore-Datensatz beibehalten.
