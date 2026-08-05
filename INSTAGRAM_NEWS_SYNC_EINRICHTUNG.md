# Version 18.2.0 – Instagram News Sync, Phase 1

Alle Beiträge des professionellen Instagram-Kontos `@tsu.ainet` werden über die offizielle Instagram API in die Firestore-Collection `news` übernommen.

## 1. Meta-App verbinden

In Meta for Developers eine App mit **Instagram API with Instagram Login** einrichten und das professionelle Konto `@tsu.ainet` autorisieren.

Benötigte Mindestberechtigung:

- `instagram_business_basic`

## 2. GitHub Secrets

Im GitHub-Repository unter **Settings → Secrets and variables → Actions** anlegen:

- `FIREBASE_SERVICE_ACCOUNT` – bereits für die ÖFB/KFV-Synchronisierung vorhanden
- `INSTAGRAM_ACCESS_TOKEN` – Zugriffstoken der Meta-/Instagram-App
- `INSTAGRAM_USER_ID` – professionelle Instagram-Konto-ID (empfohlen; ohne Wert versucht das Skript `/me`)

## 3. Erster Test

GitHub → Actions → **Instagram News synchronisieren** → **Run workflow**.

Erwartete Ausgabe:

```text
Instagram @tsu.ainet: 25 Beiträge geprüft.
Neu: 25; aktualisiert: 0; übersprungen: 0.
```

Danach erscheinen die importierten Beiträge automatisch im Newsbereich der App.

## 4. Automatik

Der Workflow läuft jeweils zur Minute 07 und 37, also ungefähr alle 30 Minuten.

## 5. Firestore-Daten

Dokument-ID: `instagram_<hash der Media-ID>`

Wichtige Felder:

- `source: "instagram"`
- `instagramId`
- `instagramMediaType`
- `instagramPermalink`
- `published: true`
- `publishedAt`
- `imageUrl`
- `content`

Doppelte Beiträge werden durch die Instagram-Media-ID verhindert. Manuell überschriebene Beiträge werden nicht ersetzt.

## Hinweise

- Bild, Karussell und Reel werden unterstützt.
- Bei Reels wird das Vorschaubild verwendet.
- Klick auf „Auf Instagram ansehen“ öffnet den Originalbeitrag.
- Stories werden in Phase 1 nicht importiert.
- Das Zugriffstoken darf niemals in den Quellcode eingegeben werden.
