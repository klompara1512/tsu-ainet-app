# Version 15.0.2 – Spielbericht-Abfrage Fix

Die App sucht Spielberichte jetzt über das Firestore-Feld `matchId` statt vorauszusetzen, dass die Dokument-ID mit der Spiel-ID identisch ist. Dadurch werden bereits synchronisierte Aufstellungen, Ersatzbänke und Ereignisse im Spieldetail gefunden und angezeigt.
