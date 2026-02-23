const CACHE_NAME = 'lotto-ajp-v1';
const urlsToCache = [
    './',
    './index.html',
    './renderer.js',
    './loteria.png',
    './ajp.png',
    './manifest.json',
    './notification.mp3'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                console.log('Archivos base cacheados');
                return cache.addAll(urlsToCache);
            })
    );
});

self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => {
                if (response) {
                    return response;
                }
                return fetch(event.request).then(
                    function (response) {
                        if (!response || response.status !== 200) {
                            return response;
                        }

                        // Cachear dinámicamente imágenes y scripts de Firebase
                        var responseToCache = response.clone();
                        caches.open(CACHE_NAME)
                            .then(function (cache) {
                                cache.put(event.request, responseToCache);
                            });

                        return response;
                    }
                );
            })
    );
});

self.addEventListener('activate', event => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cacheName => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName);
                    }
                })
            );
        })
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const animal = event.notification.data ? event.notification.data.animal : null;

    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
            for (const client of clientList) {
                if ('focus' in client) {
                    return client.focus().then(focusedClient => {
                        if (animal && focusedClient) {
                            focusedClient.postMessage({ action: 'verHistorial', animal: animal });
                        }
                    });
                }
            }
            if (clients.openWindow) {
                return clients.openWindow('./');
            }
        })
    );
});