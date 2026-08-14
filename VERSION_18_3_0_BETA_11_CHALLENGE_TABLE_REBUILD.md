# Version 18.3.0-beta.11 – Challenge Tabelle komplett neu

- Eigener GitHub-Workflow: `ÖFB Challenge Tabelle exakt`
- Eigener Parser nur für `Res/Tabellen`
- Eigener Firestore-Schreibweg für `teamKey=CHALLENGE`
- Vollständige Plausibilitätsprüfung vor jedem Schreibvorgang
- Bei unvollständigen/falschen Daten wird Firestore nicht verändert
- Allgemeiner KFV/ÖFB Tabellen-Sync darf Challenge nicht mehr überschreiben
- Täglich vier Prüfungen + manueller Start
