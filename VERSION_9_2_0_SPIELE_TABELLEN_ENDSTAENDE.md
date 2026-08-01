# TSU Ainet App – Version 9.2.0

## Verbesserte ÖFB-/KFV-Synchronisierung

- Endstände werden zuverlässig erkannt und als `finished` gespeichert.
- Anstoßzeiten wie `19:00` werden nicht als Ergebnis `19:0` interpretiert.
- Endstand-Markierungen wie `Endstand`, `beendet`, `FT` und `Abpfiff` werden unterstützt.
- Halbzeit- und Zwischenstände werden nicht als Endstand importiert.
- Ergebnisse mit `n. V.` und `i. E.` werden erkannt.
- Bereits gespeicherte Endstände bleiben erhalten, wenn eine ÖFB-Antwort kurzfristig kein Ergebnis enthält.
- Neue korrigierte Endstände überschreiben alte Ergebnisse.
- Abgesagte oder verschobene Spiele verlieren einen eventuell alten Endstand.
- Spiel-IDs verwenden bevorzugt die offizielle ÖFB-Spiel-ID und bleiben dadurch bei Uhrzeitänderungen stabil.
- Tabellen werden nach Mannschaft und normalisiertem Vereinsnamen entdoppelt.
- Unvollständige Tabellenläufe mit weniger als drei plausiblen Zeilen überschreiben keine bestehende Tabelle.
- `undefined`-Werte werden vor Firestore-Schreibvorgängen entfernt.
- Der Workflow protokolliert geplante, beendete, verschobene und abgesagte Spiele getrennt.

## Test

```powershell
node --check scripts/kfv-sync.cjs
npm run build
```

Danach zu GitHub hochladen. Der automatische Workflow aktualisiert Firestore.
