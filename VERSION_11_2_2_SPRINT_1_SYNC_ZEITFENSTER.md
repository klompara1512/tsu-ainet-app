# Version 11.2.2 – Sprint 1: Synchronisationslogik

## Änderungen

- Automatische ÖFB-Synchronisierung nur zwischen 08:00 und 22:00 Uhr (Europe/Vienna).
- Der 22:00-Lauf wird noch ausgeführt; 22:30 und spätere automatische Läufe werden übersprungen.
- Manuelle Synchronisierung über `workflow_dispatch` bleibt jederzeit möglich.
- Dublettenbereinigung automatisch nur einmal täglich beim 08:00-Lauf.
- Bei manuellen Läufen kann die Dublettenbereinigung über die Checkbox `run_dedup` gezielt aktiviert werden.
- Sync-Protokoll und Firestore-Status speichern, ob die Dublettenbereinigung ausgeführt wurde.

## Noch nicht Teil dieses Sprints

- Datumsfenster −14/+7 Tage
- getrennte Jugend-Synchronisierung
- differenzielle Firestore-Schreibvorgänge

Diese Punkte folgen in den nächsten Sprints von Version 11.2.2.
