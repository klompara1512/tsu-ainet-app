# TSU Ainet – Release Code Audit RC1

Version: **18.2.2-rc.1**

## Automatisierte Prüfungen

Der neue Befehl

```bash
npm run release:audit
```

prüft vor jedem Release:

- Pflichtdateien und Projektstruktur
- einheitliche Versionsnummern in App, npm-Paket und PWA-Cache
- Syntax aller JavaScript-/Synchronisationsskripte
- GitHub-Actions-Workflows auf Grundstruktur und entfernte Instagram-Abhängigkeiten
- typische versehentlich eingecheckte Zugangsdaten
- bekannte Regressionen wie `canManageAnything`
- zentrale Firestore-Regeln
- erforderliche npm-Prüfskripte

Der vollständige lokale Prüfablauf lautet:

```bash
npm install
npm run release:check
```

## Bei diesem Audit behoben

- Versionsnummern vereinheitlicht
- PWA-Cache auf den RC1-Stand angehoben
- permanenter Release-Audit ergänzt
- Instagram-Reste werden als Release-Fehler erkannt
- bekannte TypeScript-Regression `canManageAnything` wird geprüft
- Firestore-Regeln werden auf offene Schreibrechte kontrolliert

## Noch manuell zu prüfen

- Rollen und Berechtigungen mit echten Testkonten
- alle GitHub-Actions mit echten Secrets
- Synchronisationsstatus und Zeitstempel in Firestore
- iPhone, Android, Tablet und Desktop
- Datenschutz, Impressum und Domain

## Hinweis zur Build-Prüfung

In der Erstellungsumgebung konnte `npm install` nicht vollständig ausgeführt werden, weil das interne npm-Register `zod-validation-error@4.0.2` nicht bereitstellt. Die JavaScript-Syntax aller vorhandenen `.cjs`-Skripte wurde erfolgreich geprüft. Der vollständige TypeScript-/Vite-Build muss deshalb auf dem Entwicklungsrechner mit `npm run release:check` abgeschlossen werden.
