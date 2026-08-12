# Version 18.3.0 Beta 1 – Trikotsatz-Verwaltung

Neue interne Verwaltung für Administratoren und Sektionsleitung.

- eigener Menüpunkt **Trikotsätze verwalten** in der Administration
- Foto pro Trikotsatz
- Zuordnung zu Mannschaft / Bereich
- Bestandszahlen für Oberteile, Hosen, Stutzen und Tubes
- optionale Notiz und Status „aktiv / außer Verwendung“
- Filter nach Mannschaft
- Bestandsübersicht und Minimum-Anzeige pro Satz
- Firestore-Pfad `settings/kitInventory/sets`, damit die bestehenden Sektionsleitungs-Regeln ohne neue Rules-Bereitstellung greifen
- Bilder werden clientseitig komprimiert und Spark-kompatibel direkt im Firestore-Dokument gespeichert
