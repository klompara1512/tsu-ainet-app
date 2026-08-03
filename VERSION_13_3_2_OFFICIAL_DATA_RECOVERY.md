# Version 13.3.2 – Official Data Recovery

Behobene Ursachen:

- Der KFV-Fragmentlink `#mannschaften` bleibt bei der Kampfmannschaft erhalten.
- Die offizielle ÖFB-KM-Tabelle ist die primäre Tabellenquelle; die KFV-Vereinsseite bleibt Rückfallquelle.
- KFV-Tabellen ohne ÖFB-Mannschaftspfad erhalten sicher die Zuordnung `KM / Kampfmannschaft`.
- Dynamisch nachgeladene Inhalte werden durch vollständiges Scrollen vor dem Parser aktiviert.
- Kaderseiten werden unabhängig vom konkreten Mannschaftsslug erkannt.
- Parser- und Dataset-Version auf 13.3.2 erhöht.

Prüfungen:

- JavaScript-Syntax erfolgreich
- TypeScript-Prüfung erfolgreich
- Official-Sync-Selbsttest erfolgreich
- Projektstrukturprüfung erfolgreich

Hinweis: Ein echter Produktiv-Sync benötigt das GitHub-Secret `FIREBASE_SERVICE_ACCOUNT` und Internetzugriff auf die offiziellen KFV-/ÖFB-Seiten.
