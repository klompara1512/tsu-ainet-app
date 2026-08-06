importScripts("https://www.gstatic.com/firebasejs/12.16.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyCe_p1u7H7ZJ4qDs7mzTLKfHjyhjaEgcCI",
  authDomain: "tsu-ainet-fussball.firebaseapp.com",
  projectId: "tsu-ainet-fussball",
  storageBucket: "tsu-ainet-fussball.firebasestorage.app",
  messagingSenderId: "643610865816",
  appId: "1:643610865816:web:41938883ad04b8280860ed",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const notification = payload.notification || {};
  const data = payload.data || {};
  self.registration.showNotification(notification.title || "TSU Ainet", {
    body: notification.body || "Neue Nachricht",
    icon: "/icon-192.png",
    badge: "/favicon-64.png",
    tag: `tsu-ainet-${data.target || "all"}`,
    renotify: true,
    data: {
      ...data,
      link: data.link || "/",
    },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const requestedLink = event.notification.data?.link || "/";
  const targetUrl = new URL(requestedLink, self.location.origin).toString();

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clientList) => {
      for (const client of clientList) {
        if ("navigate" in client) await client.navigate(targetUrl).catch(() => undefined);
        if ("focus" in client) return client.focus();
      }
      return clients.openWindow(targetUrl);
    }),
  );
});
