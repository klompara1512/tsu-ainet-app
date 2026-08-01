# Version 10.3.5 – Dubletten-Sync-Fix

Diese Version stabilisiert die ÖFB-Spielesynchronisierung.

## Wichtig

Nach dem Einspielen muss der GitHub-Workflow „ÖFB-Daten automatisch synchronisieren“
einmal ausgeführt werden. Dabei werden die neuen eindeutigen Datensätze geschrieben und
alte automatisch importierte Dubletten auf `active: false` gesetzt.

Manuell angelegte Spiele werden nicht automatisch deaktiviert.
