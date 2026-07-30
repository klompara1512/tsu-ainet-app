# Version 5.1.2 – Uhrzeit und Ergebnis sauber getrennt

- Der ÖFB-Parser sucht ein Ergebnis erst nach Datum und Anstoßzeit.
- Eine Anstoßzeit wie `17:00` oder `19:00` wird nicht mehr als Ergebnis interpretiert.
- Zukünftige Spiele zeigen weiterhin die Uhrzeit.
- Abgeschlossene Spiele zeigen den vom ÖFB/KFV importierten Endstand.
- Parser-Version: `5.1.2-kickoff-score-separation`.

Nach dem Hochladen muss der GitHub-Workflow „KFV-Daten synchronisieren“ einmal manuell ausgeführt werden, damit die falsch gespeicherten Datensätze überschrieben werden.
