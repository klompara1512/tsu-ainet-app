# Version 14.5.0 – Smart Logo Engine

- KFV-Wappen aus `/oefb2/images/` haben höchste Priorität.
- ÖFB-Header-, Verbands-, Platzhalter- und mehrfach verwendete Standardlogos werden verworfen.
- Logo-Kandidaten werden anhand des Vereinsnamens im direkten DOM-Kontext bewertet.
- Alte ungeprüfte Logos werden nicht mehr automatisch beibehalten.
- Frontend sucht Vereine zuerst über `clubId` und verwendet keine unsichere Ein-Wort-Zuordnung mehr.
- Rohlogos aus Spielen werden nur noch akzeptiert, wenn sie aus dem offiziellen KFV-Bildpfad stammen.
- App-Versionsanzeige zentral auf 14.5.0 aktualisiert.
