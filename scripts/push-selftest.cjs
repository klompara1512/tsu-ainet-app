const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

const requiredFiles = [
  "src/push.ts",
  "src/NotificationsAdmin.tsx",
  "public/firebase-messaging-sw.js",
  "scripts/send-push.cjs",
  ".github/workflows/send-push.yml",
];

for (const relativePath of requiredFiles) {
  const absolutePath = path.join(root, relativePath);

  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Push-Pflichtdatei fehlt: ${relativePath}`);
  }
}

const sender = fs.readFileSync(
  path.join(root, "scripts/send-push.cjs"),
  "utf8",
);

const serviceWorker = fs.readFileSync(
  path.join(root, "public/firebase-messaging-sw.js"),
  "utf8",
);

const rules = fs.readFileSync(
  path.join(root, "firestore.rules"),
  "utf8",
);

const workflow = fs.readFileSync(
  path.join(root, ".github/workflows/send-push.yml"),
  "utf8",
);

const checks = [
  [sender.includes("sendEachForMulticast"), "Multicast-Versand fehlt"],
  [
    sender.includes("registration-token-not-registered"),
    "Ungültige Tokens werden nicht bereinigt",
  ],
  [
    sender.includes("settings/pushStatus"),
    "Push-Status wird nicht in Firestore protokolliert",
  ],
  [
    serviceWorker.includes("notificationclick"),
    "Benachrichtigungsklick wird nicht verarbeitet",
  ],
  [
    serviceWorker.includes("data.link"),
    "Deep-Link wird im Service Worker nicht verwendet",
  ],
  [
    rules.includes("resource.data.uid == request.auth.uid"),
    "Token-Löschregel prüft den Besitzer nicht",
  ],
  [
    workflow.includes("workflow_dispatch"),
    "Push-Workflow kann nicht manuell gestartet werden",
  ],
  [
    !workflow.includes('cron: "*/5 * * * *"') &&
      !workflow.includes("cron: '*/5 * * * *'"),
    "Alter 5-Minuten-Zeitplan ist noch im Push-Workflow vorhanden",
  ],
  [
    workflow.includes("npm run push:selftest"),
    "Push-Selbsttest wird im Workflow nicht ausgeführt",
  ],
  [
    workflow.includes("npm run push:send"),
    "Push-Warteschlange wird im Workflow nicht verarbeitet",
  ],
];

const failed = checks
  .filter(([passed]) => !passed)
  .map(([, message]) => message);

if (failed.length) {
  throw new Error(
    `Push-Selbsttest fehlgeschlagen:\n- ${failed.join("\n- ")}`,
  );
}

console.log(
  "Push-Selbsttest erfolgreich: Token, Versand, Status, Deep-Link und manueller Workflow geprüft.",
);
