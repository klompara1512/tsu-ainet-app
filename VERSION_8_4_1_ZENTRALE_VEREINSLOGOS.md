# Version 8.4.1 – Zentrale Vereinslogos

## Neu

- Vereinslogos können zentral über die Firestore-Collection `kfvClubs` gepflegt werden.
- Der Kalender sucht zuerst in `kfvClubs` nach dem passenden Verein.
- Wenn dort kein Logo vorhanden ist, wird das Logo aus `kfvMatches` verwendet.
- Nur TSU Ainet erhält das TSU-Ainet-Logo als festes Ersatzlogo.
- Gegner ohne Logo erhalten ein neutrales Fußballwappen.
- Ligabezeichnungen:
  - KM: `1. Klasse West`
  - Challenge: `Challenge 1. Klasse West`
  - U17: `U17`
  - U12: `U12`
  - U10: `U10`

## Firestore: kfvClubs

Beispieldokument `doelsach`:

```text
name: TSU Dölsach
normalizedName: doelsach
logoUrl: https://...
primaryColor: #...
secondaryColor: #...
stadium: Sportplatz Dölsach
website: https://...
active: true
```

Die App funktioniert auch ohne Einträge in `kfvClubs`; dann werden vorhandene Logos aus `kfvMatches` verwendet.
