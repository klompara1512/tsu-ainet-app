TSU Ainet v1.0.15 – MANUELLE ERGEBNISSE + STATISTIK

Enthaltene Änderungen:
- src/MatchAdmin.tsx
  -> Heim- und Auswärtstore können manuell eingetragen werden.
  -> Sobald beide Torzahlen gesetzt sind, Status automatisch "Beendet".
  -> Kennzeichnung manualResultOverride schützt den Endstand.
  -> Leere Torfelder entfernen den manuellen Vorrang wieder.

- src/kfvFirestore.ts + src/kfvTypes.ts
  -> Manuelle Endstände werden über den öffentlichen ÖFB-Snapshot gelegt.
  -> Dadurch aktualisieren sich Startseite, Kalender, Spielcenter und alle aus den Spielen
     berechneten Statistiken/Formwerte sofort und verwenden denselben Endstand.
  -> Manuelle Ergebnisse haben bei Dubletten höchste Priorität.

- scripts/kfv-sync.cjs
  -> Der automatische ÖFB-Sync erkennt manualResultOverride und überschreibt einen
     manuell gesetzten Endstand nicht mehr.

- src/kfvLive.tsx + src/LiveDashboard.tsx
  -> Enthalten die Änderungen aus v1.0.14 (Aufstellungen erster Reiter + Logos wie Kalender).

Einspielen:
1. Ordnerstruktur aus diesem ZIP in das Projekt kopieren und Dateien ersetzen.
2. npm run build
3. Änderungen committen und zu GitHub pushen (wichtig für den aktualisierten Sync-Schutz).
4. Erst danach Hosting deployen.

Manuelles Ergebnis eintragen:
Mehr/Verwaltung -> Spiele verwalten -> Spiel bearbeiten -> Heimtore + Auswärtstore eintragen -> Änderungen speichern.

Wichtig:
Beide Torzahlen müssen immer gemeinsam gesetzt werden. Der Endstand wird dann automatisch
als beendet behandelt und sofort für Ergebnisdarstellung und Statistik/Formkurve verwendet.
