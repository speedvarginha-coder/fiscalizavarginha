/* Zela Varginha — Service Worker v3 (fix identifiers JS quebrados) */
const CACHE = "zela-v3";
const STATIC = [
  "./",
  "./index.html",
  "./prefeitura.html",
  "./camara.html",
  "./relatorios.html",
  "./pessoal.html",
  "./cobrar.html",
  "./sobre.html",
  "./marcadores.html",
  "./style.css",
  "./app.js",
  "./app-glossario.js",
  "./favicon.svg",
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE)
      .then(function (c) { return c.addAll(STATIC); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (k) { return k !== CACHE; })
            .map(function (k) { return caches.delete(k); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // data.js — stale-while-revalidate: serve cache imediatamente, atualiza em bg
  if (url.pathname.endsWith("data.js")) {
    e.respondWith(
      caches.open(CACHE).then(function (cache) {
        return cache.match(req).then(function (cached) {
          const networkFetch = fetch(req).then(function (res) {
            if (res && res.ok) {
              // Notifica clientes que dados foram atualizados (apenas se havia cache anterior)
              if (cached) {
                res.clone().text().then(function (newText) {
                  cache.match(req).then(function (old) {
                    if (!old) return;
                    old.text().then(function (oldText) {
                      if (newText !== oldText) {
                        self.clients.matchAll().then(function (clients) {
                          clients.forEach(function (c) { c.postMessage({ type: "DATA_UPDATED" }); });
                        });
                      }
                    });
                  });
                });
              }
              cache.put(req, res.clone());
            }
            return res;
          }).catch(function () { return cached; });
          return cached || networkFetch;
        });
      })
    );
    return;
  }

  // Demais recursos — cache first, fallback network
  e.respondWith(
    caches.match(req).then(function (cached) {
      return cached || fetch(req).then(function (res) {
        if (res && res.ok && url.origin === self.location.origin) {
          caches.open(CACHE).then(function (c) { c.put(req, res.clone()); });
        }
        return res;
      });
    })
  );
});
