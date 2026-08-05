# Version 17.2.0 – Logo Manager Phase 1

## Enthalten

- neue Firestore-Collection `clubLogos`
- einheitliches Datenmodell für Vereinsname, Aliase, Logo-URL und Storage-Pfad
- stabile Normalisierung unterschiedlicher Vereins-/Mannschaftsschreibweisen
- zentrale TypeScript-Funktionen zum Laden, Speichern, Deaktivieren und Löschen
- zentrale Auflösung eines manuell verwalteten Logos anhand von Vereinsname oder Alias
- Firestore-Regeln: Logos sind öffentlich lesbar, Änderungen nur für Admin und Sektionsleitung

## Dokumentstruktur

```text
clubLogos/{normalisierter-vereinsname}
  clubName
  normalizedName
  aliases[]
  normalizedAliases[]
  logoUrl
  storagePath
  source
  active
  createdAt
  updatedAt
  updatedByUid
  updatedByName
  schemaVersion: 1
```

Phase 1 schafft nur die Datenbasis. Die sichtbare Verwaltungsseite und der Bild-Upload folgen in Phase 2.
