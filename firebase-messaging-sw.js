self.addEventListener('notificationclick', event => {
  event.notification.close();
  const conversationId = event.notification.data?.conversationId;
  const target = conversationId ? '/?chat=' + encodeURIComponent(conversationId) : '/';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
    for (const client of windowClients) {
      if ('focus' in client) {
        if ('navigate' in client) client.navigate(target);
        return client.focus();
      }
    }
    return clients.openWindow(target);
  }));
});

importScripts('https://www.gstatic.com/firebasejs/12.5.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.5.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyC-9rNObRxRJezgvZK6JcYylfzu9tW3Ggk',
  authDomain: 'bishwo-45430.firebaseapp.com',
  projectId: 'bishwo-45430',
  storageBucket: 'bishwo-45430.firebasestorage.app',
  messagingSenderId: '140669463257',
  appId: '1:140669463257:web:e37e76d59133159183ecc8',
});

const messaging = firebase.messaging();
messaging.onBackgroundMessage(payload => {
  if (payload.notification) return;
  const title = payload.data?.title || 'New Bishwa message';
  const options = {
    body: payload.data?.body || 'You have a new message.',
    icon: '/favicon.ico',
    data: payload.data || {},
    tag: payload.data?.conversationId || 'bishwa-message',
  };
  self.registration.showNotification(title, options);
});
