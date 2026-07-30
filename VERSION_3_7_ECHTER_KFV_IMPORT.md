# Version 3.7 – echter öffentlicher KFV-Import

- Keine Testspiele oder Platzhalter werden erzeugt.
- Der Import verarbeitet klassische Tabellen, Karten/Listen und eingebettete JSON-Daten.
- Es werden nur Begegnungen mit TSU Ainet übernommen.
- KFV-Datensätze erhalten `source: kfv-public`; manuelle Einträge bleiben unberührt.
- Nicht mehr gefundene KFV-Datensätze werden deaktiviert statt gelöscht.
- Ein Lauf schlägt sichtbar fehl, wenn keine echten KFV-Daten erkannt wurden.
- Diagnoseinformationen werden unter `settings/kfvSyncStatus` gespeichert.
- GitHub Actions verwendet Node.js 24 und `npm install`.
