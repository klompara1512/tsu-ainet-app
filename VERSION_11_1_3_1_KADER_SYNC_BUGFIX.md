# Version 11.1.3.1 – Kader-Sync-Bugfix

Diese Bugfix-Version verhindert, dass ein vorübergehend leerer oder nicht erkannter ÖFB-Kader den gesamten GitHub-Workflow beendet.

## Verhalten bei 0 erkannten Spielern

- `kfvSquad` wird nicht überschrieben.
- Vorhandene Spieler werden nicht deaktiviert.
- Der Lauf wird mit einer Warnung fortgesetzt.
- Spiele, Tabellen, Logos und Spielberichte werden normal synchronisiert.

## Diagnose

Im GitHub-Protokoll erscheinen die geprüften Kader-URLs und die Warnung `ÖFB-Kader-Sync: 0 Spieler erkannt`.
