// Service worker de Firebase Cloud Messaging — recibe push con la app cerrada
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyBETz59-ROzmnv66NZ6MoVoOiYvD41xdFg",
  authDomain: "pachanguitas-fc.firebaseapp.com",
  databaseURL: "https://pachanguitas-fc-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "pachanguitas-fc",
  storageBucket: "pachanguitas-fc.firebasestorage.app",
  messagingSenderId: "784360320301",
  appId: "1:784360320301:web:112f9beed629880e45f7a4"
});

const messaging = firebase.messaging();

// Las notificaciones con payload 'notification' las muestra el navegador solo.
// Al tocar la notificación → abrir/enfocar la app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.includes(self.location.origin) && 'focus' in c) return c.focus();
      }
      return clients.openWindow('/');
    })
  );
});
