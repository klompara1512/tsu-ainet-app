# Version 11.0.1 – Stabile Match-ID

## Ziel

Jedes Spiel soll in Firestore dauerhaft genau einem Dokument zugeordnet sein. Termin-, Uhrzeit- oder Spielortänderungen aktualisieren dieses Dokument, statt ein weiteres Spiel anzulegen.

## Neue Felder in `kfvMatches`

- `matchUid`: stabile fachliche Spiel-ID
- `oefbMatchId`: offizielle ÖFB-Spiel-ID, sofern vorhanden
- `canonicalKey`: Quellvergleich für identische Funde desselben Laufs
- `matchIdentityVersion`: wird im Sync-Status als `11.0.1` gespeichert

## Identitätsregeln

1. Ist eine offizielle ÖFB-Spiel-ID vorhanden, wird `oefb:<ID>` verwendet.
2. Ohne offizielle ID wird für Ligaspiele aus Saison, TSU-Mannschaft, Heim- und Auswärtsteam eine stabile ID erstellt. Datum, Uhrzeit und Spielort sind bewusst nicht Bestandteil dieser ID.
3. Bei Cup- und Freundschaftsspielen wird zusätzlich das Datum berücksichtigt, da dort dieselbe Paarung mehrfach vorkommen kann.

## Migration beim ersten Sync

Der erste Lauf nach dem Update:

1. schreibt alle aktuellen Spiele mit der neuen stabilen Dokument-ID,
2. gruppiert bestehende ÖFB-Dokumente nach `matchUid`,
3. bevorzugt die Daten des aktuellen Laufs,
4. deaktiviert alte Dokumente,
5. setzt bei alten Dokumenten `duplicateOf` auf die neue Dokument-ID.

Manuell angelegte Spiele mit einer anderen Quelle werden nicht automatisch gelöscht.

## Kontrolle

Im GitHub-Protokoll erscheinen künftig unter anderem:

```text
Neue Spiele: ...
Aktualisierte Spiele: ...
Alte Firestore-Dubletten deaktiviert: ...
```
