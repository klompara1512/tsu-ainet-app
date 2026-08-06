# 17.1.0 – Mobile First UI

- Hauptseiten bereinigt und mobile Kalenderansicht verbessert.

# 17.0.0 – Clear Club Experience

- Modernes, ruhiges und sportliches Vereinsdesign
- Fünf klare Navigationspunkte: Start, Spiele, Teams, News, Mehr
- Vereinfachte Startseite und strukturierter Mehr-Bereich
- Mobile Tabellen priorisieren Platz, Verein und Punkte
- Technische Hinweise aus der normalen Oberfläche entfernt
- Größere Touchflächen und optimierte iPhone-Abstände

## 11.2.2 – Mannschaftsspezifische ÖFB-Quellen

- Eigene Spielplan- und Tabellenquelle für KM, Challenge, U17, U12 und U10.
- Strikte Trennung von Spiele- und Tabellenparser.
- Schutz vor vermischten oder veralteten Tabellen.
- Mannschaftsbezogene Sync-Diagnose.

# 11.2.1 – Spielplan- und Logo-Stabilisierung

- Unvollständig geladene ÖFB-Seiten deaktivieren keine bereits bekannten Spiele mehr.
- Bereits bekannte Spiele der Saison werden bei einem Teilausfall aus Firestore ergänzt.
- U17, U12 und U10 bleiben dadurch sichtbar, auch wenn eine Quellseite vorübergehend nicht geladen wird.
- Bestehende Vereinslogos bleiben erhalten, wenn die Quelle in einem Lauf kein Logo liefert.
- Das Seitenlimit wurde von 40 auf 120 erhöht, damit alle Mannschafts-, Tabellen-, Kader- und Spielberichtsseiten verarbeitet werden können.
- Echte Dubletten werden weiterhin bereinigt.

# 11.2.0 – Intelligenter Spielbericht-Import

- Berichtseiten werden automatisch aus der offiziellen Spiel-ID erzeugt und besucht.
- Veröffentlichte Berichtsdaten werden vor leeren Folgeantworten geschützt.
- Verbesserte Zuordnung zu Spielen und ausführlichere Sync-Statistik.

# Changelog

## 11.1.3.1 – Kader-Sync-Bugfix

- Ein fehlgeschlagener Kader-Parser beendet nicht mehr die komplette ÖFB-Synchronisierung.
- Spiele, Tabellen, Logos und offizielle Spielberichte werden weiterhin verarbeitet.
- Bestehende Dokumente in `kfvSquad` bleiben bei 0 erkannten Spielern unverändert.
- Der Sync-Status enthält eine Warnung statt eines Fehlers.
- Zusätzliche Diagnoseausgaben zeigen die geprüften Kader-URLs.

# Version 11.1.3 – Offizieller ÖFB-Spielbericht-Sync

- ÖFB-Spielberichtsseiten werden automatisch besucht.
- Startelf, Ersatzbank und Trainer werden in `kfvMatchReports` gespeichert.
- Tore, Karten, Wechsel, Halbzeit und Spielende werden als Timeline importiert.
- Aufstellungen und Liveticker-Tabs lesen die offiziellen Daten aus Firestore.
- Leere oder noch nicht veröffentlichte Berichte überschreiben keine vorhandenen Daten.

# Version 11.1.2 – Premium Match-Center Tabs

- Neue Tabs: Übersicht, Liveticker, Aufstellungen und Statistik.
- Sticky Tab-Navigation für Smartphone und Desktop.
- Direkter Wechsel ohne Verlassen der Spieldetailseite.
- Eigene Übersichts-, Live-, Aufstellungs- und Statistikbereiche.
- Saisonbilanz aus den bereits synchronisierten Endständen.
- Mobile Schnellnavigation folgt der aktiven Ansicht.
- Keine erfundenen Live-Ereignisse oder Aufstellungen.

# Changelog
## 11.0.3 – Smart Sync Control

- Aktiver Admin-Button zur kostenlosen GitHub-Actions-Synchronisierung.
- Automatische Statusüberwachung über Firestore.
- Fortschrittsanzeige und automatische Datenzähler-Aktualisierung.
- Systemdiagnose für Internet, Firestore, Workflow, Historie und Match-ID.
- Keine Cloud Functions und keine kostenpflichtigen Firebase-Dienste.


## 11.0.2a – Architektur- und Code-Cleanup

- zentrale Sync-Konfiguration eingeführt
- produktiven GitHub-Workflow vereinheitlicht
- automatische Projekt- und Konfigurationsprüfung ergänzt
- Sync-Logs als GitHub-Artefakt und Job-Zusammenfassung verfügbar
- Dokumentation, `.gitignore` und `.env.example` ergänzt
- keine Änderung an bestehenden App-Funktionen oder Firestore-Collections

# Version 11.0.2 – Admin Sync Center

- neues, ausschließlich für Administratoren sichtbares Synchronisationszentrum
- Live-Zähler für Spiele, Tabellenzeilen, Kaderspieler und Vereinslogos
- letzter Status, Laufzeit, Parser-Version und Systemzustand
- Ergebnisübersicht für neue und aktualisierte Spiele sowie Dubletten und Warnungen
- Historie der letzten zehn Synchronisationsläufe mit Detailansicht
- das Sync-Script schreibt ab jetzt jeden Lauf nach `kfvSyncRuns`
- Vorbereitung des kostenlosen GitHub-Startbuttons für Version 11.0.3

# Changelog

## 11.0.1 – Stabile Spiel-ID und Dubletten-Migration

- jedes ÖFB/KFV-Spiel erhält ein dauerhaftes Feld `matchUid`
- offizielle ÖFB-Spiel-ID wird bevorzugt verwendet
- Ligaspiele behalten bei Datum-, Uhrzeit- und Spielortänderungen dieselbe Dokument-ID
- bestehende alte Match-Dokumente werden beim nächsten Sync automatisch auf die neue ID migriert
- alte Dubletten werden deaktiviert und mit `duplicateOf` verknüpft
- aktuelle Sync-Daten haben Vorrang vor alten, bereits mehrfach gespeicherten Terminen
- Sync-Protokoll zeigt neue und aktualisierte Spiele getrennt
- Sync-Status speichert `newMatchCount`, `updatedMatchCount` und `matchIdentityVersion`

## 10.4.4
- Smart Dashboard 2.0 mit Matchday-, LIVE- und Endstand-Modus.

## 10.4.3
- KFV-/ÖFB Smart Sync für Spielort, Schiedsrichter, Liveticker und Aktualisierungszeit.

## 10.4.2

- Premium-Spielcenter mit größerem Scoreboard und klarer Statusanzeige
- Direkte Route, Liveticker- und Spielbericht-Aktionen
- Spielinformation, Form und Top-5-Tabelle in einer Ansicht
- Aufstellungs- und Ereignisbereiche für künftige Live-Daten vorbereitet
- Feste Smartphone-Schnellnavigation zu Tabelle, Kader und Spielplan
- Doppelte Mannschaftsauswahl im KFV-Live-Filter entfernt

## 10.3.6

- Dublettenprüfung verwendet jetzt einen kanonischen Mannschaftsschlüssel.
- Alte Firestore-Dubletten werden beim Sync automatisch deaktiviert.
- Spieleverwaltung und öffentliche Ansichten blenden Dubletten sofort aus.

## 10.3.5

- ÖFB-Spiele werden unabhängig vom Seitentitel eindeutig zusammengeführt
- Dubletten nach Mannschaft, Spieltag, Heim- und Auswärtsteam entfernt
- häufigste erkannte Anstoßzeit gewinnt bei widersprüchlichen Parserwerten
- alte ÖFB-Dubletten werden beim nächsten Sync automatisch deaktiviert
- Bewerbsnamen wie „Spiele - Res - Saison …“ werden bereinigt
- zusätzliche Dubletten-Sicherung beim Laden in der Webapp
- Spieleverwaltung blendet inaktive Datensätze und Dubletten standardmäßig aus
- Sync-Status protokolliert Rohdaten und entfernte Dubletten


## 10.3.4

- Mannschaftsstatistik mit Siegquote, Punkten und Toren pro Spiel
- Heim-/Auswärtsvergleich
- Zu-null-Spiele und Tordifferenz
- visuelle Leistungsbalken
- responsive Statistik-Karten
## 10.3.3
- Spielerprofil um Geburtstag ergänzt
- Geburtstag in der Vereinsverwaltung bearbeitbar
- Keine weiteren persönlichen Daten im Profil
- Geburtstag bleibt bei ÖFB-Synchronisierung erhalten

# Changelog

## 10.2.0
- Premium-Spielcenter
- Große Vereinslogos und Ergebnisanzeige
- Matchstatus und Countdown
- Routen- und Spielbericht-Aktionen
- Mobile Bottom-Sheet-Ansicht


## 10.0.0

- Neues dunkles TSU-Ainet-Designsystem
- Einheitliche Farben, Abstände, Radien und Schatten
- Aufgeräumte Bottom-Navigation mit modernisierten Icons
- Navigation „Kalender“ in „Spiele“ umbenannt
- Moderne Icons im Bereich „Mehr“ statt Buchstaben und Emojis
- Verbesserte Touch-Flächen, Fokusdarstellung und Smartphone-Lesbarkeit
- Bestehende Funktionen und KFV-Synchronisierung unverändert übernommen

## 10.1.0
- Dashboard vollständig neu gestaltet und aufgeräumt.
- Große weiße Flächen durch dunkle Sport-App-Karten ersetzt.
- Emojis in Schnellzugriffen durch einheitliche SVG-Icons ersetzt.
- Nächstes Spiel, Ergebnisse, Tabelle, Termine und Vereinsinfos kompakter dargestellt.
- Smartphone-Bedienung und Touch-Flächen verbessert.
## 10.3.1 – Mannschaftszentrale: Team-Hub
- Premium-Team-Hub für KM, Challenge, U17, U12 und U10
- Tabellenplatz, Form, nächstes Spiel und Saisonbilanz
- Top-5-Tabelle und letzte Ergebnisse
- Schnellzugriffe und neuer Karten-Kader
- Mobile-First-Optimierung


## 11.2.2
- Smart Sync Optimizer und Tabellenparser-Fix.

## 13.0.0 – Vereins-ID-Architektur
- Vereinslogos werden primär über KFV-/ÖFB-Vereinskennungen zugeordnet.
- Spiele und Tabellen speichern Vereins-ID und Vereinsseite.
- Zentrale `kfvClubs`-Datenbank mit Aliasen und stabilen IDs.
- Alte falsche Ainet-Logos bei Gegnern werden beim Sync bereinigt.
- Namensvergleich bleibt nur als Fallback erhalten.

## 16.1.1 – Spark Delta Sync

- Tabellen Freitag bis Sonntag und an österreichischen Feiertagen alle 30 Minuten.
- Spielplan täglich um 06:00, 12:00 und 18:00 Uhr Europe/Vienna.
- Tabellen und Kader schreiben nur tatsächliche Änderungen nach Firestore.
- Kaderbestand wird nur einmal pro Lauf gelesen.

## 18.3.3 RC10 – Sprint 3
- Kopfsponsor-Kacheln verbreitert.
- Sponsorenlaufband und Vereinslogos vereinheitlicht.
- Mannschaftskarten und Mannschaftsfotos vergrößert.
