> Aktueller Entwicklungsstand: **Version 11.0.1** – stabile Match-ID und automatische Dubletten-Migration.

# TSU Ainet Vereinsapp – Version 3.6

Diese Version synchronisiert öffentliche KFV-Daten kostenlos über GitHub Actions alle 30 Minuten mit Firestore. Firebase Blaze ist dafür nicht erforderlich.

Siehe `VERSION_3_6_KFV_SYNC_OHNE_BLAZE.md` für die Einrichtung.

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

## KFV-Automatik (Version 3.5)

Die Cloud Function `kfvSyncEvery30Minutes` liest ausschließlich öffentliche HTTPS-Seiten von `kfv-fussball.at` und synchronisiert Spiele/Tabellen alle 30 Minuten nach Firestore. Im Bereich **Mehr → KFV-Synchronisierung** kann die öffentliche Vereins-URL gespeichert und ein manueller Lauf gestartet werden.

Einmalig bereitstellen:

```bash
cd functions
npm install
cd ..
npm run build
firebase deploy --only functions,hosting,firestore:rules
```

Hinweis: Für geplante Cloud Functions muss das Firebase-Projekt den Blaze-Tarif verwenden. Es werden keine Anmeldungen, Captchas oder Schutzmechanismen umgangen. Ändert der KFV das HTML, zeigt der Sync-Status den Fehler und behält die zuletzt gespeicherten Daten.


## Lokal starten (Version 5.1)

```cmd
npm install
npm run start
```

Alternativ funktioniert weiterhin `npm run dev`.
