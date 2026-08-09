# 18.3.0-beta.1 – Complete Match Sync

- Ergebnis wird aus dem offiziellen Spielbericht direkt in `kfvMatches` übernommen.
- Nach Anpfiff bleibt ein Spiel bis zu 12 Stunden im automatischen Sync, solange Ergebnis, Aufstellung, Schiedsrichter oder Spielort fehlen.
- Vor Anpfiff wird nicht unnötig auf ein noch nicht vorhandenes Ergebnis gewartet.
- Leere spätere Abrufe überschreiben keine bereits gespeicherten Aufstellungen, Ergebnisse, Schiedsrichter oder Spielorte.
- Teilinformationen wie Spielort/Schiedsrichter werden bereits gespeichert, auch wenn die Aufstellung noch nicht veröffentlicht ist.
- `reportComplete` und `reportLastCheckedAt` werden auf Bericht und Spiel gepflegt.
