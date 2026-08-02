# Changelog

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

