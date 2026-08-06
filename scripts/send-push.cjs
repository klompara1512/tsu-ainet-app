process.env.TZ = "Europe/Vienna";

const admin = require("firebase-admin");

const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!rawServiceAccount) throw new Error("FIREBASE_SERVICE_ACCOUNT fehlt.");

let serviceAccount;
try {
  serviceAccount = JSON.parse(rawServiceAccount);
} catch {
  throw new Error("FIREBASE_SERVICE_ACCOUNT ist kein gültiges JSON.");
}

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

const DEFAULT_LINK = "https://tsu-ainet-fussball.web.app/";
const INVALID_TOKEN_CODES = new Set([
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
]);

function cleanText(value, fallback, maxLength) {
  const text = String(value || fallback || "").replace(/\s+/g, " ").trim();
  return text.slice(0, maxLength);
}

function validLink(value) {
  try {
    const url = new URL(String(value || DEFAULT_LINK), DEFAULT_LINK);
    return url.protocol === "https:" ? url.toString() : DEFAULT_LINK;
  } catch {
    return DEFAULT_LINK;
  }
}

async function removeInvalidTokens(tokenEntries, responses) {
  const invalidRefs = [];
  responses.forEach((response, index) => {
    if (response.success) return;
    const code = response.error?.code || "";
    if (INVALID_TOKEN_CODES.has(code) && tokenEntries[index]?.ref) invalidRefs.push(tokenEntries[index].ref);
  });
  await Promise.all(invalidRefs.map((ref) => ref.delete().catch(() => undefined)));
  return invalidRefs.length;
}

async function processMessage(document) {
  const message = document.data();
  const title = cleanText(message.title, "TSU Ainet", 60);
  const body = cleanText(message.body, "Neue Nachricht", 220);
  const target = cleanText(message.target, "all", 40);
  const link = validLink(message.link);

  await document.ref.update({
    status: "sending",
    processingStartedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const tokensSnapshot = await db.collection("fcmTokens").where("active", "==", true).get();
  const selectedEntries = tokensSnapshot.docs
    .map((entry) => ({ ref: entry.ref, ...entry.data() }))
    .filter((entry) => {
      const topics = Array.isArray(entry.topics) ? entry.topics : [];
      return Boolean(entry.token) && (target === "all" || topics.includes(target) || topics.includes("all"));
    });

  let success = 0;
  let failed = 0;
  let invalidTokensRemoved = 0;

  for (let index = 0; index < selectedEntries.length; index += 500) {
    const chunk = selectedEntries.slice(index, index + 500);
    const response = await admin.messaging().sendEachForMulticast({
      tokens: chunk.map((entry) => entry.token),
      notification: { title, body },
      data: { link, target, queueId: document.id },
      webpush: {
        headers: { Urgency: target === "all" ? "normal" : "high" },
        notification: {
          icon: "/icon-192.png",
          badge: "/favicon-64.png",
          tag: `tsu-ainet-${target}`,
          renotify: true,
        },
        fcmOptions: { link },
      },
    });

    success += response.successCount;
    failed += response.failureCount;
    invalidTokensRemoved += await removeInvalidTokens(chunk, response.responses);
  }

  const result = {
    status: "sent",
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
    processedAt: admin.firestore.FieldValue.serverTimestamp(),
    success,
    failed,
    target,
    tokenCount: selectedEntries.length,
    invalidTokensRemoved,
    link,
    error: admin.firestore.FieldValue.delete(),
  };

  await document.ref.update(result);
  return result;
}

async function main() {
  const startedAt = admin.firestore.Timestamp.now();
  const statusRef = db.doc("settings/pushStatus");
  await statusRef.set({
    running: true,
    success: null,
    startedAt,
    provider: "firebase-cloud-messaging",
    workflow: process.env.GITHUB_WORKFLOW || "Push-Benachrichtigungen senden",
    githubRunId: String(process.env.GITHUB_RUN_ID || ""),
  }, { merge: true });

  try {
    const queue = await db.collection("notificationQueue")
      .where("status", "==", "pending")
      .limit(20)
      .get();

    let messagesSent = 0;
    let deliveriesSuccessful = 0;
    let deliveriesFailed = 0;
    let invalidTokensRemoved = 0;

    for (const document of queue.docs) {
      try {
        const result = await processMessage(document);
        messagesSent += 1;
        deliveriesSuccessful += result.success;
        deliveriesFailed += result.failed;
        invalidTokensRemoved += result.invalidTokensRemoved;
      } catch (error) {
        deliveriesFailed += 1;
        await document.ref.update({
          status: "error",
          error: String(error?.stack || error),
          processedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    const finishedAt = admin.firestore.Timestamp.now();
    await statusRef.set({
      running: false,
      success: true,
      lastSuccessAt: finishedAt,
      finishedAt,
      durationMs: finishedAt.toMillis() - startedAt.toMillis(),
      queueCount: queue.size,
      messagesSent,
      deliveriesSuccessful,
      deliveriesFailed,
      invalidTokensRemoved,
      lastError: admin.firestore.FieldValue.delete(),
    }, { merge: true });

    console.log(`Push-Verarbeitung erfolgreich: ${messagesSent} Nachricht(en), ${deliveriesSuccessful} zugestellt, ${deliveriesFailed} fehlgeschlagen.`);
  } catch (error) {
    const finishedAt = admin.firestore.Timestamp.now();
    await statusRef.set({
      running: false,
      success: false,
      finishedAt,
      durationMs: finishedAt.toMillis() - startedAt.toMillis(),
      lastError: String(error?.stack || error),
    }, { merge: true });
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
