import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
  onMessage,
} from "firebase/messaging";
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";
import { app, auth, db } from "./firebase";

export const PUSH_TOPICS = [
  "all",
  "km",
  "challenge",
  "u17",
  "u12",
  "u10",
  "u8",
  "news",
  "events",
  "results",
] as const;

export type PushTopic = (typeof PUSH_TOPICS)[number];

export type PushSupport = {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  installedPwa: boolean;
  serviceWorker: boolean;
};

function tokenId(token: string) {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0).toString(36);
}

function normalizeTopics(topics: PushTopic[]) {
  const valid = topics.filter((topic): topic is PushTopic => PUSH_TOPICS.includes(topic));
  return [...new Set(valid.length ? valid : ["all"])] as PushTopic[];
}

export async function getPushSupport(): Promise<PushSupport> {
  const serviceWorker = "serviceWorker" in navigator;
  const supported = serviceWorker && "Notification" in window && await isSupported();
  const installedPwa = window.matchMedia("(display-mode: standalone)").matches
    || ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone));

  return {
    supported,
    permission: supported ? Notification.permission : "unsupported",
    installedPwa,
    serviceWorker,
  };
}

async function getPushRegistration() {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Dieser Browser unterstützt keine Service Worker.");
  }

  await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

async function removeOtherTokens(uid: string, keepDocumentId: string) {
  const snapshot = await getDocs(query(collection(db, "fcmTokens"), where("uid", "==", uid)));
  await Promise.all(snapshot.docs
    .filter((entry) => entry.id !== keepDocumentId)
    .map((entry) => deleteDoc(entry.ref).catch(() => undefined)));
}


export async function hasActivePushToken() {
  if (!auth.currentUser) return false;
  const snapshot = await getDocs(
    query(
      collection(db, "fcmTokens"),
      where("uid", "==", auth.currentUser.uid),
    ),
  ).catch(() => null);
  if (!snapshot) return false;
  return snapshot.docs.some((entry) => entry.data().active === true && Boolean(entry.data().token));
}

export async function enablePush(topics: PushTopic[]) {
  const support = await getPushSupport();
  if (!support.supported) throw new Error("Push wird auf diesem Browser nicht unterstützt.");
  if (!auth.currentUser) throw new Error("Bitte zuerst anmelden.");

  const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;
  if (!vapidKey) {
    throw new Error("VAPID-Schlüssel fehlt. Bitte VITE_FIREBASE_VAPID_KEY in der .env-Datei eintragen.");
  }

  const permission = Notification.permission === "granted"
    ? "granted"
    : await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error("Benachrichtigungen wurden nicht erlaubt.");
  }

  const registration = await getPushRegistration();
  const messaging = getMessaging(app);
  const token = await getToken(messaging, {
    vapidKey,
    serviceWorkerRegistration: registration,
  });
  if (!token) throw new Error("Kein Push-Token erhalten.");

  const uid = auth.currentUser.uid;
  const documentId = `${uid}_${tokenId(token)}`;
  const selectedTopics = normalizeTopics(topics);

  await setDoc(doc(db, "fcmTokens", documentId), {
    uid,
    token,
    topics: selectedTopics,
    active: true,
    permission: Notification.permission,
    userAgent: navigator.userAgent,
    language: navigator.language,
    installedPwa: support.installedPwa,
    updatedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  }, { merge: true });

  await removeOtherTokens(uid, documentId);
  return token;
}

export async function disablePush() {
  if (!(await isSupported()) || !auth.currentUser) return;

  const uid = auth.currentUser.uid;
  const messaging = getMessaging(app);
  const registration = await getPushRegistration().catch(() => undefined);
  const token = await getToken(messaging, registration ? { serviceWorkerRegistration: registration } : undefined)
    .catch(() => "");

  if (token) {
    await deleteDoc(doc(db, "fcmTokens", `${uid}_${tokenId(token)}`)).catch(() => undefined);
    await deleteToken(messaging).catch(() => undefined);
  }

  const snapshot = await getDocs(query(collection(db, "fcmTokens"), where("uid", "==", uid))).catch(() => null);
  if (snapshot) {
    await Promise.all(snapshot.docs.map((entry) => deleteDoc(entry.ref).catch(() => undefined)));
  }
}

export async function listenForeground(
  callback: (title: string, body: string, link?: string) => void,
) {
  if (!(await isSupported())) return () => undefined;

  return onMessage(getMessaging(app), (payload) => {
    callback(
      payload.notification?.title || "TSU Ainet",
      payload.notification?.body || "Neue Nachricht",
      payload.data?.link,
    );
  });
}
