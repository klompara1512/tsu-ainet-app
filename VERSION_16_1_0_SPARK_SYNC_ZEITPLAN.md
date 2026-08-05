# Version 16.1.0 – Spark-Sync-Zeitplan

## Tabellen

Tabellen werden alle 30 Minuten nur samstags, sonntags und an österreichischen gesetzlichen Feiertagen synchronisiert. Ein manueller Workflow-Start ist an jedem Tag möglich.

## Spielpläne und Ergebnisse

Spielpläne und Ergebnisse laufen alle drei Stunden. Danach werden die Heimspiel-Aufgaben aktualisiert.

## Spielberichte

Der Workflow startet alle 30 Minuten. Firestore lädt jedoch nur Spiele im relevanten Zeitfenster:

- ab 60 Minuten vor dem Anstoß
- bis 300 Minuten nach dem Anstoß

Außerhalb dieses Fensters werden keine alten oder weit entfernten Spiele verarbeitet.
