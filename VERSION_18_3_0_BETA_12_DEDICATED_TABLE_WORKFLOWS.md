# Version 18.3.0-beta.12 – getrennte Tabellenworkflows

Die Tabellen von Kampfmannschaft, Challenge, U17, U12 und U10 werden ab dieser Version ausschließlich durch getrennte, autoritative ÖFB-Workflows synchronisiert.

- KM: /KM/Tabellen
- Challenge: /Res/Tabellen
- U17: /U17/Tabellen
- U12: /U12/Tabellen
- U10: /U10/Tabellen

Jeder Workflow liest nur seine feste Quelle, akzeptiert ausschließlich eine vollständige Tabelle mit Ainet und schreibt nur Dokumente des eigenen teamKey nach oefbV12Standings. Bei fehlender oder unplausibler Tabelle wird nichts überschrieben.
