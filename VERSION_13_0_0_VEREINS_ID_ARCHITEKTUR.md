# Version 13.0.0 – Vereins-ID-Architektur

- Vereinslogos werden primär über KFV-/ÖFB-Vereinskennungen zugeordnet.
- Spiele speichern `homeClubId`, `awayClubId` sowie die Vereinsseiten.
- Tabellen speichern `clubId` und `clubUrl`.
- `kfvClubs` ist die zentrale Vereinsdatenbank mit ID, Aliasen, Logo und Quellseite.
- Namensvergleich bleibt nur als Fallback für Quellen ohne Vereinslink.
- Alte, irrtümlich bei Gegnern gespeicherte Ainet-Logos werden bereinigt.
- Leere neue Logoantworten überschreiben keine korrekten bestehenden Logos.
