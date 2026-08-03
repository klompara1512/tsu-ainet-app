# Version 12.2.1 – Logo-Zuordnung Fix

- Verhindert, dass das TSU-Ainet-Wappen als Gegnerlogo angezeigt wird.
- Prüft Match- und Vereinslogo-URLs zentral.
- Entfernt beim Sync fremde Vereinsprofile, die dasselbe Logo wie TSU Ainet verwenden.
- Bei identischen Heim-/Auswärtslogos wird nur das plausibel richtige Logo behalten.
- Falsche Alt-Daten werden bereits in der App abgefangen; nach dem nächsten Sync auch in Firestore korrigiert.
