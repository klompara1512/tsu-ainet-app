# TSU Ainet App – Version 8.4.0

## Änderungen

- Falsches Doppel-Logo im Spielkalender behoben.
- Nur TSU Ainet verwendet das TSU-Ainet-Logo als lokales Ersatzlogo.
- Gegner ohne importiertes Logo erhalten ein neutrales Vereinswappen.
- Liga-/Mannschaftsbezeichnungen vereinheitlicht:
  - Kampfmannschaft: `1. Klasse West`
  - Challenge: `Challenge 1. Klasse West`
  - U17: `U17`
  - U12: `U12`
  - U10: `U10`
  - U8: `U8`
- Monats-, Listen- und Detailansicht verwenden dieselbe Logo- und Bezeichnungslogik.

## Installation

1. Projektinhalt in den echten GitHub-Projektordner kopieren.
2. Vorhandene `.env` behalten.
3. `npm install`
4. `npm run dev`
5. Nach erfolgreichem Test: `npm run build`
6. Danach: `firebase deploy --only hosting`
