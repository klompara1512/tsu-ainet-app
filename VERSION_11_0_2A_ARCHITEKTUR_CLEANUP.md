# Version 11.0.2a – Architektur- und Code-Cleanup

- produktiver GitHub-Workflow liegt jetzt direkt unter `.github/workflows/`
- zentrale Sync-Konfiguration unter `config/kfv-sync.config.json`
- Parser liest Saison, Mannschaften, URLs und Intervall aus dieser Datei
- neue Projektprüfung mit `npm run sync:check`
- GitHub Actions erzeugt eine Zusammenfassung und speichert das Sync-Log 14 Tage als Artefakt
- `.gitignore`, `.env.example`, Architektur- und Wartungsdokumentation ergänzt
- Funktionsumfang und Firestore-Datenmodell unverändert
