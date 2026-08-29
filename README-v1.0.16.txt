TSU Ainet v1.0.16 – Trainer-Ergebniseingabe

Änderungen:
- Trainer können Endstände direkt im Spielcenter nach dem voraussichtlichen Spielende eintragen.
- Trainer sehen die Eingabe nur für Mannschaften, die in ihrem Benutzerprofil über teamIds zugeordnet sind.
- U8/U10: Freigabe ca. 70 Minuten nach Anstoß.
- U12: Freigabe ca. 90 Minuten nach Anstoß.
- U17/Challenge/Kampfmannschaft: Freigabe ca. 110 Minuten nach Anstoß.
- Bereits vorhandene Ergebnisse können vom zuständigen Trainer korrigiert werden.
- Manuelle Ergebnisse setzen manualResultOverride=true und werden vom ÖFB-Sync nicht überschrieben.
- Kalender, Startseite, Spielcenter und Form-/Statistikwerte verwenden automatisch den manuellen Endstand.
- Trainer haben keinen Zugriff mehr auf die allgemeine Spiele-Verwaltung; dort bleiben Admin/Sektionsleitung zuständig.
- Firestore-Regeln erlauben Trainern Ergebnisänderungen nur für ihre zugeordneten teamIds und nur an den Ergebnisfeldern.

Installation:
1. Dateien entsprechend der Ordnerstruktur ins Projekt kopieren/ersetzen.
2. npm run build
3. Firestore-Regeln deployen: firebase deploy --only firestore:rules
4. Danach Hosting deployen: firebase deploy --only hosting
5. Änderungen an scripts/kfv-sync.cjs weiterhin zu GitHub pushen, damit der Sync-Schutz aktiv bleibt.

Prüfung:
- TypeScript tsc -b erfolgreich (0 TypeScript-Fehler).
- Vite-Bundle konnte in der Linux-Prüfumgebung wegen eines plattformspezifischen optionalen Rolldown-Bindings nicht ausgeführt werden; dies betrifft nicht den TypeScript-Code.
