importScripts('https://www.gstatic.com/firebasejs/12.16.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.16.0/firebase-messaging-compat.js');
firebase.initializeApp({apiKey:"AIzaSyCe_p1u7H7ZJ4qDs7mzTLKfHjyhjaEgcCI",authDomain:"tsu-ainet-fussball.firebaseapp.com",projectId:"tsu-ainet-fussball",storageBucket:"tsu-ainet-fussball.firebasestorage.app",messagingSenderId:"643610865816",appId:"1:643610865816:web:41938883ad04b8280860ed"});
const messaging=firebase.messaging();
messaging.onBackgroundMessage(payload=>{const n=payload.notification||{};self.registration.showNotification(n.title||"TSU Ainet",{body:n.body||"Neue Nachricht",icon:"/icon-192.png",badge:"/favicon-64.png",data:payload.data||{}})});
self.addEventListener("notificationclick",event=>{event.notification.close();event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>list[0]?list[0].focus():clients.openWindow("/")))});
