# Version 7.6 – kostenlose Spielerfotos

- Spielerfotos können im Adminbereich direkt vom Gerät ausgewählt werden.
- Das Bild wird im Browser auf 480 × 480 Pixel zugeschnitten und als JPEG komprimiert.
- Speicherung direkt im jeweiligen Firestore-Spielerdokument als Data-URL.
- Kein Firebase Storage und kein Blaze-Tarif erforderlich.
- Manuell gesetzte Fotos bleiben durch `manualOverride` beim nächsten ÖFB-Sync erhalten.
- Foto-Vorschau, Entfernen-Funktion und Anzeige in Admin- sowie Teamansicht.

Hinweis: Firestore hat pro Dokument ein Größenlimit. Deshalb begrenzt die App das komprimierte Bild auf ungefähr 750 KB. Empfohlen sind normale Porträtfotos unter 5 MB.
