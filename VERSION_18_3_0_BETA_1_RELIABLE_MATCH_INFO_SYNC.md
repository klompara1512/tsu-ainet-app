# 18.3.0 Beta 1 – Reliable Match Info Sync

- Aufstellung, Spielort und Schiedsrichter werden für alle TSU-Ainet-Spiele geprüft.
- Prüfung täglich alle 30 Minuten, nicht nur am Wochenende.
- Relevantes Zeitfenster: 60 Minuten vor bis 30 Minuten nach Anstoß.
- Vollständig vorhandene Spiele werden übersprungen.
- Leere Ergebnisse überschreiben keine bereits vorhandenen Daten.
- Aufstellungen, Ersatzbank, Spielort, Schiedsrichter und Assistenten werden zusätzlich direkt in `kfvMatches` gespiegelt.
- Manueller Workflow-Start bleibt möglich und nutzt das erweiterte Force-Zeitfenster.
