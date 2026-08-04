# Version 14.3.0 – Phase 4: Spielbericht- und News-Sync

Phase 4 synchronisiert unabhängig vom Core-, Club- und Kader-Sync offizielle ÖFB-Spielberichte.

## Funktionen

- lädt nur bekannte Spiele mit offiziellem Bericht-Link
- begrenzt den Abruf standardmäßig auf 45 Tage zurück und 7 Tage voraus
- speichert Resultat, Aufstellungen, Ereignisse, Schiedsrichter, Zuschauer und Spielort in `kfvMatchReports`
- erstellt in `news` einen unveröffentlichten Entwurf pro Spiel
- veröffentlicht Entwürfe niemals automatisch
- verändert keine manuell geschützten News (`manualOverride: true` oder `source: manual`)
- überschreibt bereits vorhandene Berichtsdaten nicht mit leeren Ergebnissen
- protokolliert Status und Diagnosen in `settings/kfvReportNewsSyncStatus`

## Workflow

`KFV / ÖFB Spielberichte und News synchronisieren`

Der Workflow läuft einmal täglich und kann manuell gestartet werden.
