# Version 15.1.0 – Official Match ID Resolver

- Spielbericht-Links werden vor dem Import aus den offiziellen ÖFB-Spielplanseiten neu ermittelt.
- Falsche oder veraltete gameId-, oefbMatchId- und reportUrl-Felder in kfvMatches werden automatisch korrigiert.
- Lurnfeld – TSU Ainet am 01.08.2026 ist mit der offiziellen ÖFB-Spiel-ID 4074032 abgesichert.
- Erst danach werden Aufstellungen, Ersatzbank, Ereignisse und Berichtsdaten eingelesen.
- Der Sync-Status enthält reportIndexCount, resolvedMatchCount und correctedMatchLinks.
