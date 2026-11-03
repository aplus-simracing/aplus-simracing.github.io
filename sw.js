/* APlus Lounge – Service Worker NUR für die Mitteilungen aufs Handy (Stufe 3, Roger 30.10./02.11.2026).
   - push: Mitteilung zeigen (Titel, Text, Logo, tag – mehrere Chat-Nachrichten im gleichen Kanal ersetzen sich: «Talk (3 neue
     Nachrichten)»), Ton nach Einstellung (silent), rote Zahl auf dem App-Symbol hochzählen (wo das Handy es kann).
   - Antippen: offene App nach vorne holen und die richtige Seite zeigen – sonst die App öffnen (oder die Webseite des Links).
   - pushsubscriptionchange: merken, damit sich die App beim nächsten Öffnen neu anmeldet.
   Absichtlich KEIN «fetch»-Teil und kein Zwischenspeicher: die App lädt immer die aktuelle Fassung vom Server. */
'use strict';
var DB = 'apl-push', ST = 'kv';
function idb() { return new Promise(function (ok, no) { var r = indexedDB.open(DB, 1); r.onupgradeneeded = function () { r.result.createObjectStore(ST); }; r.onsuccess = function () { ok(r.result); }; r.onerror = function () { no(r.error); }; }); }
function kv(k, v) {   // lesen (v weggelassen) oder schreiben
  return idb().then(function (db) {
    return new Promise(function (ok, no) {
      var t = db.transaction(ST, v === undefined ? 'readonly' : 'readwrite'), s = t.objectStore(ST), q = v === undefined ? s.get(k) : s.put(v, k);
      t.oncomplete = function () { db.close(); ok(v === undefined ? q.result : v); }; t.onerror = t.onabort = function () { db.close(); no(t.error); };
    });
  });
}
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

function zahlPlus(n) {   // rote Zahl: Zähler in IndexedDB (die App setzt ihn beim Öffnen auf die echte Zahl ungelesener Nachrichten)
  if (!(n > 0)) return Promise.resolve();
  return kv('zahl').then(function (z) { return kv('zahl', Math.min(9999, (+z || 0) + n)); })
    .then(function (z) { if (self.navigator && self.navigator.setAppBadge) return self.navigator.setAppBadge(z).catch(function () { }); })
    .catch(function () { });
}
var APPLE = /iPhone|iPad|iPod|Macintosh/.test((self.navigator && self.navigator.userAgent) || '');
var ROUTE = /^(c:[a-z0-9_-]{1,40}|m:[a-z]{0,12}\|(\d{4}-\d{2}-\d{2})?|notif)$/;
function istApp(c) {   // ein Fenster mit der App (nicht irgendeine andere Seite derselben Adresse)
  var b = self.registration.scope, u = String(c.url || '');
  return u.indexOf(b) === 0 && /^\/?(index\.html)?$/.test(u.slice(b.length).split(/[?#]/)[0]);
}

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { t: 'A Plus SimRacing Lounge', b: e.data ? String(e.data.text()).slice(0, 300) : '' }; }
  e.waitUntil(zeigen(d && typeof d === 'object' ? d : {}));
});
function zeigen(d) {
  var titel = String(d.t || 'A Plus SimRacing Lounge').slice(0, 80), text = String(d.b || '').slice(0, 600), tag = /^[\w:-]{1,64}$/.test(d.tag || '') ? d.tag : '';
  var n = Math.max(1, Math.min(999, +d.n || 1)), u = ROUTE.test(d.u || '') ? d.u : 'notif', w = /^https:\/\/[^\s"'<>]+$/.test(d.w || '') ? d.w : '';
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cl) {
    // App gerade offen und vorne: sie zeigt die Mitteilung selbst (ausser auf Apple-Geräten – dort muss jede Push sichtbar sein)
    var vorne = cl.filter(function (c) { return istApp(c) && c.visibilityState === 'visible' && c.focused; });
    if (vorne.length && !APPLE) { vorne.forEach(function (c) { try { c.postMessage({ typ: 'apl-push', d: { t: titel, b: text, u: u, typ: d.typ || '' } }); } catch (x) { } }); return; }
    var vorher = tag && self.registration.getNotifications ? self.registration.getNotifications({ tag: tag }) : Promise.resolve([]);
    return vorher.catch(function () { return []; }).then(function (alt) {
      var summe = n; if (d.typ === 'chat') alt.forEach(function (a) { summe += Math.max(0, +((a.data || {}).n) || 0); });
      var o = { body: text, icon: 'icon-192.png', badge: 'badge-96.png', silent: !!d.s, timestamp: Date.now(), data: { u: u, w: w, k: String(d.k || ''), n: summe, typ: String(d.typ || '') } };
      if (tag) { o.tag = tag; o.renotify = !!d.r; }
      if (d.typ === 'chat' && summe > 1) titel = titel + ' (' + summe + ' neue Nachrichten)';
      return self.registration.showNotification(titel, o);
    }).then(function () { return zahlPlus(+d.z || 0); });
  });
}

self.addEventListener('notificationclick', function (e) {
  var d = e.notification.data || {}; e.notification.close();
  e.waitUntil(oeffnen(d));
});
function oeffnen(d) {
  var u = ROUTE.test(d.u || '') ? d.u : 'notif';
  if (d.w && /^https:\/\/[^\s"'<>]+$/.test(d.w)) return self.clients.openWindow(d.w);   // «Antippen öffnet» eine Webseite
  var basis = self.registration.scope;
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cl) {
    var L = cl.filter(istApp);
    var c = L.filter(function (x) { return x.focused; })[0] || L.filter(function (x) { return x.visibilityState === 'visible'; })[0] || L[0];   // am liebsten die App, die gerade vorne ist
    if (c) { try { c.postMessage({ typ: 'apl-go', u: u }); } catch (x) { } return c.focus ? c.focus() : c; }
    return self.clients.openWindow(basis + '?go=' + encodeURIComponent(u));
  });
}

self.addEventListener('pushsubscriptionchange', function (e) {   // Push-Dienst hat das Abo erneuert/beendet → App meldet sich beim nächsten Öffnen neu an
  e.waitUntil(kv('neu', Date.now()).catch(function () { }));
});
