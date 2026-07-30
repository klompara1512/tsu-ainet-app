# Version 6.1 – automatische Synchronisierung wiederhergestellt

- GitHub-Actions-Lauf alle 30 Minuten
- manueller Start über `workflow_dispatch`
- Prüfung, ob `FIREBASE_SERVICE_ACCOUNT` vorhanden ist
- reproduzierbare Installation mit `npm ci`
- parallele Synchronisierungsläufe werden verhindert
