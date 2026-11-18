// Always loads the live site (nothing is cached), so new registrations and updates show immediately.
self.addEventListener('install', function(){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ e.waitUntil(self.clients.claim()); });
self.addEventListener('fetch', function(e){
  if (e.request.method !== 'GET') return;
  e.respondWith(fetch(e.request).catch(function(){
    return new Response('<h2 style="font-family:sans-serif;padding:24px">No internet. Please connect and reopen the app.</h2>', {headers:{'Content-Type':'text/html'}});
  }));
});
