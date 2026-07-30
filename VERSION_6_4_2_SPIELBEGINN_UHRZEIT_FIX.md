# Version 6.4.2 – Spielbeginn-Uhrzeit Fix

Die GitHub-Runner arbeiten standardmäßig in UTC. Dadurch wurden aus einer ÖFB-Anstoßzeit wie 17:00 Uhr beim Speichern und Anzeigen in Österreich teilweise 19:00 Uhr.

## Korrektur

- Der Parser verwendet jetzt ausdrücklich die Zeitzone `Europe/Vienna`.
- Der GitHub-Workflow setzt ebenfalls `TZ: Europe/Vienna`.
- Sommer- und Winterzeit werden automatisch korrekt berücksichtigt.
- Ergebnisse bleiben von der Zeitkorrektur unberührt.
- Parser-Version: `6.4.2-austria-kickoff-time`.

Nach dem Hochladen den Workflow einmal manuell starten, damit die offiziellen Spieltermine neu gespeichert werden.
