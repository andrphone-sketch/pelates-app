/* Κροκί Τοπογραφικού — PWA εφαρμογή επί τόπου (offline-first) */
'use strict';

// ---------- Βάση (IndexedDB) ----------
const DB_NAME = 'topo-survey';
const STORE = 'features';
let db;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}
function dbAll() {
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    tx.onsuccess = () => res(tx.result || []);
    tx.onerror = () => rej(tx.error);
  });
}
function dbPut(rec) {
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite').objectStore(STORE).put(rec);
    tx.onsuccess = () => res(); tx.onerror = () => rej(tx.error);
  });
}
function dbDel(id) {
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
    tx.onsuccess = () => res(); tx.onerror = () => rej(tx.error);
  });
}
function dbClear() {
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite').objectStore(STORE).clear();
    tx.onsuccess = () => res(); tx.onerror = () => rej(tx.error);
  });
}

// ---------- Χάρτης ----------
let map, tileLayer, gpsMarker, gpsCircle, drawLayer, featLayer;
let features = [];
const mode = { current: 'pan', drawing: null, vertices: [] };
let watchId = null;
let gpsFix = null; // { lat, lon, acc, ts }

function fmt(n, d = 6) { return Number(n).toFixed(d); }

// ---------- Γεωμετρία (αποστάσεις / εμβαδό) ----------
// Haversine: απόσταση σε μέτρα μεταξύ δύο [lat,lon]
function haversine(a, b) {
  const R = 6371008.8; // μέσος ακτίνας γης (m)
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
  const la1 = toRad(a[0]), la2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
// Συνολικό μήκος πολυγραμμής (m). Αν closed=true, προσθέτει και την πλευρά που κλείνει το σχήμα.
function polylineLength(coords, closed = false) {
  let s = 0;
  const n = closed ? coords.length : coords.length - 1;
  for (let i = 1; i <= n; i++) s += haversine(coords[i - 1], coords[i % coords.length]);
  return s;
}
// Εμβαδόν πολυγώνου σε m² μέσω shoelace σε ΕΓΣΑ87 (προβολικό → ευθύγραμμο)
function polygonArea(coords) {
  const p = coords.map(c => { const e = wgs84ToEgsa87(c[0], c[1]); return [e.easting, e.northing]; });
  let A = 0;
  for (let i = 0; i < p.length; i++) {
    const j = (i + 1) % p.length;
    A += p[i][0] * p[j][1] - p[j][0] * p[i][1];
  }
  return Math.abs(A / 2);
}
// μορφοποίηση (ελληνικό δεκαδικό, χιλιάδες)
function fmtNum(n, d = 2) {
  return Number(n).toLocaleString('el-GR', { minimumFractionDigits: d, maximumFractionDigits: d });
}
// Αρχική φορά (initial bearing / αζιμούθιο) σε μοίρες 0-360 (Β=0, Α=90, Ν=180, Δ=270)
function bearing(a, b) {
  const toRad = d => d * Math.PI / 180, toDeg = r => r * 180 / Math.PI;
  const la1 = toRad(a[0]), la2 = toRad(b[0]);
  const dLon = toRad(b[1] - a[1]);
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  let brg = toDeg(Math.atan2(y, x));
  return (brg + 360) % 360;
}
// διανυσματική απόσταση από το τρέχον GPS προς το στόχο
function toTarget(from, target) {
  return { dist: haversine(from, target), brg: bearing(from, target) };
}

function initMap() {
  map = L.map('map', { zoomControl: true, attributionControl: true });
  // Ελλάδα κέντρο (Αθήνα) ως προεπιλογή — προσαρμόζεται όταν έρθει GPS
  map.setView([38.0, 23.7], 16);
  tileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 20, attribution: '© OpenStreetMap'
  }).addTo(map);
  drawLayer = L.layerGroup().addTo(map);
  featLayer = L.layerGroup().addTo(map);
}

// ---------- GPS ----------
function setGpsStatus(state, text) {
  const el = document.getElementById('gpsStatus');
  el.className = 'tb-gps ' + state;
  document.getElementById('gpsText').textContent = text;
}

function startGPS() {
  if (!('geolocation' in navigator)) { setGpsStatus('err', 'GPS: μη υποστηρίζεται'); return; }
  if (watchId !== null) return;
  setGpsStatus('', 'GPS: αναζήτηση…');
  watchId = navigator.geolocation.watchPosition(onFix, onGpsErr, {
    enableHighAccuracy: true, maximumAge: 0, timeout: 30000
  });
  document.getElementById('gpsBtn').classList.add('active');
}
function stopGPS() {
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  document.getElementById('gpsBtn').classList.remove('active');
  setGpsStatus('', 'GPS: ανενεργό');
  document.getElementById('fixBanner').classList.add('hidden');
  if (gpsMarker) { map.removeLayer(gpsMarker); gpsMarker = null; }
  if (gpsCircle) { map.removeLayer(gpsCircle); gpsCircle = null; }
}
function onFix(p) {
  const lat = p.coords.latitude, lon = p.coords.longitude, acc = p.coords.accuracy;
  gpsFix = { lat, lon, acc, ts: Date.now() };
  setGpsStatus('fix', 'GPS ±' + acc.toFixed(0) + 'm');
  if (!gpsMarker) {
    gpsMarker = L.circleMarker([lat, lon], { radius: 7, color: '#1565c0', fillColor: '#42a5f5', fillOpacity: 1, weight: 3 }).addTo(map);
    gpsCircle = L.circle([lat, lon], { radius: acc, color: '#1565c0', fillColor: '#1565c0', fillOpacity: 0.08, weight: 1 }).addTo(map);
    map.setView([lat, lon], Math.max(map.getZoom(), 18));
  } else {
    gpsMarker.setLatLng([lat, lon]);
    gpsCircle.setLatLng([lat, lon]).setRadius(acc);
  }
  const e = wgs84ToEgsa87(lat, lon);
  document.getElementById('fixText').innerHTML =
    'Εδώ: ' + fmt(lat,5) + ', ' + fmt(lon,5) + (e ? '<br>ΕΓΣΑ87 X=' + e.easting.toFixed(2) + ' Y=' + e.northing.toFixed(2) : '');
  document.getElementById('fixBanner').classList.remove('hidden');
  updateStakeout();
}
function onGpsErr(err) {
  let msg = 'GPS: σφάλμα';
  if (err.code === 1) msg = 'GPS: άρνηση πρόσβασης';
  else if (err.code === 2) msg = 'GPS: δεν βρέθηκε';
  else if (err.code === 3) msg = 'GPS: χρόνος εκτέλεσης';
  setGpsStatus('err', msg);
}

// ---------- Σχεδίαση ----------
function setMode(m) {
  mode.current = m;
  document.querySelectorAll('.tool[data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === m));
  const drawing = (m === 'line' || m === 'polygon');
  document.getElementById('drawBar').classList.toggle('hidden', !drawing);
  document.getElementById('measureBar').classList.toggle('hidden', m !== 'measure');
  if (drawing || m === 'measure') cancelDraw();
  map.getContainer().style.cursor = (m === 'pan' || m === 'point') ? '' : 'crosshair';
}

function addVertexAt(lat, lon) {
  if (mode.current !== 'line' && mode.current !== 'polygon' && mode.current !== 'measure') return;
  mode.vertices.push([lat, lon]);
  redrawDraft();
}
function redrawDraft() {
  drawLayer.clearLayers();
  const pts = mode.vertices;
  pts.forEach((pt, i) => {
    L.circleMarker(pt, { radius: 5, color: '#fff', fillColor: '#ff9800', fillOpacity: 1, weight: 2 }).addTo(drawLayer)
      .bindTooltip('' + (i + 1), { permanent: true, direction: 'top', className: '' });
  });
  if (mode.current === 'line' && pts.length >= 2) {
    L.polyline(pts, { color: '#ff9800', weight: 3, dashArray: '6 6' }).addTo(drawLayer);
  } else if (mode.current === 'polygon' && pts.length >= 2) {
    L.polygon(pts, { color: '#ff9800', weight: 3, fillColor: '#ff9800', fillOpacity: 0.15, dashArray: '6 6' }).addTo(drawLayer);
  } else if (mode.current === 'measure') {
    if (pts.length >= 2) L.polyline(pts, { color: '#00bfa5', weight: 3 }).addTo(drawLayer);
    updateMeasureReadout();
  }
}
function updateMeasureReadout() {
  const pts = mode.vertices;
  const isClosed = pts.length >= 3;
  const len = polylineLength(pts, isClosed);
  let area = null;
  if (isClosed) area = polygonArea(pts);
  document.getElementById('measureLen').textContent = (isClosed ? 'Περίμετρος: ' : 'Μήκος: ') + fmtNum(len) + ' m';
  document.getElementById('measureArea').textContent = area !== null ? 'Εμβαδόν: ' + fmtNum(area) + ' m²' : 'Εμβαδόν: — (χρειάζονται ≥3 σημεία)';
}
function undoVertex() { mode.vertices.pop(); redrawDraft(); }
function cancelDraw() {
  mode.vertices = []; mode.drawing = null; drawLayer.clearLayers();
}
function finishDraw() {
  const v = mode.vertices;
  if (mode.current === 'line' && v.length < 2) { toast('Χρειάζονται ≥2 σημεία'); return; }
  if (mode.current === 'polygon' && v.length < 3) { toast('Χρειάζονται ≥3 σημεία'); return; }
  openModal(mode.current, { coords: v.slice() });
}

// tap on map
function onMapClick(e) {
  if (mode.current === 'point') {
    openModal('point', { coords: [[e.latlng.lat, e.latlng.lng]] });
  } else if (mode.current === 'line' || mode.current === 'polygon') {
    addVertexAt(e.latlng.lat, e.latlng.lng);
  } else if (mode.current === 'measure') {
    addVertexAt(e.latlng.lat, e.latlng.lng);
  }
}

// ---------- Μέτρηση: αποθήκευση ----------
function saveMeasure() {
  const v = mode.vertices;
  if (v.length < 2) { toast('Χρειάζονται ≥2 σημεία'); return; }
  const type = v.length >= 3 ? 'polygon' : 'line';
  const isClosed = v.length >= 3;
  const len = polylineLength(v, isClosed);
  const area = isClosed ? polygonArea(v) : null;
  editing = { type, coords: v.slice(), measure: { length: len, area } };
  // ανοίγουμε το modal με προσυμπληρωμένο όνομα
  document.getElementById('modalTitle').textContent = isClosed ? 'Μέτρηση πολυγώνου' : 'Μέτρηση γραμμής';
  document.getElementById('fName').value = (isClosed ? 'Εμβαδόν ' : 'Μήκος ') + fmtNum(isClosed ? area : len) + ' m' + (isClosed ? '²' : '');
  document.getElementById('fCat').value = isClosed ? 'Άλλο' : 'Δρόμος';
  document.getElementById('fNote').value = 'Μήκος: ' + fmtNum(len) + ' m' + (area !== null ? ' | Εμβαδόν: ' + fmtNum(area) + ' m²' : '');
  document.getElementById('fPhoto').value = '';
  document.getElementById('photoPreview').classList.add('hidden');
  let html = 'Μήκος: <b>' + fmtNum(len) + ' m</b>';
  if (area !== null) html += '<br>Εμβαδόν: <b>' + fmtNum(area) + ' m²</b>';
  html += '<br><br>Κορυφές:<br>';
  const es = v.map(c => wgs84ToEgsa87(c[0], c[1]));
  v.forEach((c, i) => {
    html += '#' + (i + 1) + ' Φ=' + fmt(c[0], 6) + ' Λ=' + fmt(c[1], 6);
    if (es[i]) html += ' | X=' + es[i].easting.toFixed(2) + ' Y=' + es[i].northing.toFixed(2);
    html += '<br>';
  });
  document.getElementById('modalCoords').innerHTML = html;
  document.getElementById('modal').dataset.photo = '';
  document.getElementById('modal').classList.remove('hidden');
  // κρύψε το measure bar προσωρινά
  document.getElementById('measureBar').classList.add('hidden');
}

// ---------- Modal χαρακτηριστικών ----------
let editing = null; // { type, coords }
function openModal(type, data) {
  editing = { type, coords: data.coords };
  document.getElementById('modalTitle').textContent =
    type === 'point' ? 'Σημείο' : (type === 'line' ? 'Γραμμή' : 'Πολύγωνο');
  document.getElementById('fName').value = '';
  document.getElementById('fCat').value = 'Άλλο';
  document.getElementById('fNote').value = '';
  document.getElementById('fPhoto').value = '';
  document.getElementById('photoPreview').classList.add('hidden');
  // συντεταγμένες
  let html = '';
  const es = data.coords.map(c => wgs84ToEgsa87(c[0], c[1]));
  data.coords.forEach((c, i) => {
    html += (data.coords.length > 1 ? ('#' + (i + 1) + ' ') : '') +
      'Φ=' + fmt(c[0], 6) + ' Λ=' + fmt(c[1], 6);
    if (es[i]) html += ' | X=' + es[i].easting.toFixed(2) + ' Y=' + es[i].northing.toFixed(2);
    html += '<br>';
  });
  document.getElementById('modalCoords').innerHTML = html;
  document.getElementById('modal').dataset.photo = '';
  document.getElementById('modal').classList.remove('hidden');
}
function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  editing = null;
  if (mode.current === 'line' || mode.current === 'polygon') cancelDraw();
}
// Αυτόματη αρίθμηση σήμανσης: για πασσάλους Π1,Π2... αλλιώς τρέχων αριθμός ανά κατηγορία
const CAT_PREFIX = {
  'Πασσαλος / σημείο ελέγχου': 'Π',
  'Σύνορο οικοπέδου': 'Σ',
  'Κτίσμα': 'Κ',
  'Δρόμος': 'Δ',
  'Όριο ρέματος': 'Ρ',
  'Δέντρο / εμπόδιο': 'ΔΕ',
  'Φρεάτιο / δίκτυο': 'Φ',
  'Άλλο': 'ΣΤ'
};
function autoNumber(cat) {
  const prefix = CAT_PREFIX[cat] || 'ΣΤ';
  let max = 0;
  features.forEach(f => {
    const m = (f.tag || '').match(new RegExp('^' + prefix + '(\\d+)$'));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return prefix + (max + 1);
}
function saveModal() {
  if (!editing) return;
  const cat = document.getElementById('fCat').value;
  let name = document.getElementById('fName').value.trim();
  if (!name) name = autoNumber(cat); // αυτόματη αρίθμηση αν δεν δοθεί όνομα
  const id = editing.id || ('f' + Date.now() + Math.floor(Math.random() * 1000));
  // διατήρησε τον αριθμό σήμανσης αν επεξεργάζεσαι υπάρχον στοιχείο, αλλιώς το όνομα είναι ο νέος αριθμός
  const tag = editing.id ? (editing.tag || name) : name;
  const rec = {
    id, type: editing.type, coords: editing.coords,
    name, tag,
    cat,
    note: document.getElementById('fNote').value.trim(),
    photo: document.getElementById('modal').dataset.photo || '',
    ts: Date.now()
  };
  dbPut(rec).then(() => {
    const i = features.findIndex(x => x.id === id);
    if (i >= 0) features[i] = rec; else features.push(rec);
    renderFeatures(); renderAll(); closeModal(); toast('Αποθηκεύτηκε: ' + name);
  });
}

// φωτογραφία -> data URL
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('fPhoto').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      document.getElementById('modal').dataset.photo = r.result;
      document.getElementById('photoImg').src = r.result;
      document.getElementById('photoPreview').classList.remove('hidden');
    };
    r.readAsDataURL(file);
  });
  document.getElementById('photoDel').addEventListener('click', () => {
    document.getElementById('modal').dataset.photo = '';
    document.getElementById('photoPreview').classList.add('hidden');
    document.getElementById('fPhoto').value = '';
  });
});

// ---------- Απεικόνιση στο χάρτη και λίστα ----------
const CAT_COLOR = {
  'Σύνορο οικοπέδου': '#d32f2f',
  'Κτίσμα': '#6a1b9a',
  'Δρόμος': '#455a64',
  'Όριο ρέματος': '#0277bd',
  'Δέντρο / εμπόδιο': '#2e7d32',
  'Πασσαλος / σημείο ελέγχου': '#f9a825',
  'Φρεάτιο / δίκτυο': '#00838f',
  'Άλλο': '#1565c0'
};
function renderAll() {
  featLayer.clearLayers();
  features.forEach(f => {
    const color = CAT_COLOR[f.cat] || '#1565c0';
    if (f.type === 'point') {
      const m = L.circleMarker(f.coords[0], { radius: 7, color: '#fff', fillColor: color, fillOpacity: 1, weight: 2 });
      m.bindPopup(popupHtml(f)); m.addTo(featLayer);
      m.on('click', () => openEditor(f.id));
      // ετικέτα αρίθμησης πάνω από τον πασσαλο/σημείο
      if (f.tag) L.marker(f.coords[0], { icon: L.divIcon({ className: '', html: '<div class="num-badge">' + esc(f.tag) + '</div>', iconSize: [20, 20], iconAnchor: [10, 22] }), interactive: false }).addTo(featLayer);
    } else if (f.type === 'line') {
      const p = L.polyline(f.coords, { color, weight: 4 });
      p.bindPopup(popupHtml(f)); p.addTo(featLayer);
      f.coords.forEach(c => L.circleMarker(c, { radius: 4, color: '#fff', fillColor: color, fillOpacity: 1, weight: 1 }).addTo(featLayer).on('click', () => openEditor(f.id)));
    } else {
      const p = L.polygon(f.coords, { color, weight: 4, fillColor: color, fillOpacity: 0.12 });
      p.bindPopup(popupHtml(f)); p.addTo(featLayer);
      f.coords.forEach(c => L.circleMarker(c, { radius: 4, color: '#fff', fillColor: color, fillOpacity: 1, weight: 1 }).addTo(featLayer).on('click', () => openEditor(f.id)));
    }
  });
}
function popupHtml(f) {
  const e0 = wgs84ToEgsa87(f.coords[0][0], f.coords[0][1]);
  let s = '<b>' + esc(f.name) + '</b><br>' + esc(f.cat);
  if (f.measure) {
    s += '<br>Μήκος: ' + fmtNum(f.measure.length) + ' m';
    if (f.measure.area !== null && f.measure.area !== undefined) s += '<br>Εμβαδόν: ' + fmtNum(f.measure.area) + ' m²';
  }
  s += (e0 ? '<br>X=' + e0.easting.toFixed(2) + ' Y=' + e0.northing.toFixed(2) : '') +
    (f.note ? '<br><i>' + esc(f.note) + '</i>' : '');
  return s;
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function openEditor(id) {
  const f = features.find(x => x.id === id);
  if (!f) return;
  // φόρτωσε στο modal για επεξεργασία/διαγραφή
  editing = { type: f.type, coords: f.coords, id: f.id };
  document.getElementById('modalTitle').textContent = f.name;
  document.getElementById('fName').value = f.name;
  document.getElementById('fCat').value = f.cat;
  document.getElementById('fNote').value = f.note || '';
  editing.tag = f.tag || f.name; // διατήρησε τον αριθμό σήμανσης
  document.getElementById('modal').dataset.photo = f.photo || '';
  if (f.photo) { document.getElementById('photoImg').src = f.photo; document.getElementById('photoPreview').classList.remove('hidden'); }
  else document.getElementById('photoPreview').classList.add('hidden');
  let html = '';
  const es = f.coords.map(c => wgs84ToEgsa87(c[0], c[1]));
  f.coords.forEach((c, i) => {
    html += (f.coords.length > 1 ? ('#' + (i + 1) + ' ') : '') + 'Φ=' + fmt(c[0], 6) + ' Λ=' + fmt(c[1], 6);
    if (es[i]) html += ' | X=' + es[i].easting.toFixed(2) + ' Y=' + es[i].northing.toFixed(2);
    html += '<br>';
  });
  document.getElementById('modalCoords').innerHTML = html;
  document.getElementById('modal').classList.remove('hidden');
}
function deleteFeature() {
  if (!editing || !editing.id) { closeModal(); return; }
  const id = editing.id;
  dbDel(id).then(() => { features = features.filter(x => x.id !== id); renderFeatures(); renderAll(); closeModal(); toast('Διαγράφηκε'); });
}

// ---------- Λίστα πλευρικού πίνακα ----------
function renderFeatures() {
  const body = document.getElementById('panelBody');
  if (!features.length) { body.innerHTML = '<p style="color:#888;text-align:center;margin-top:20px">Δεν υπάρχουν στοιχεία ακόμα.</p>'; return; }
  body.innerHTML = features.map(f => {
    const e0 = wgs84ToEgsa87(f.coords[0][0], f.coords[0][1]);
    const kind = f.type === 'point' ? 'Σημείο' : (f.type === 'line' ? 'Γραμμή (' + f.coords.length + ')' : 'Πολύγωνο (' + f.coords.length + ')');
    return '<div class="feat"><div class="ftitle"><span>' + esc(f.name) + '</span><span>' + kind + '</span></div>' +
      '<div class="fmeta">' + esc(f.cat) + (e0 ? '<br>X=' + e0.easting.toFixed(2) + ' Y=' + e0.northing.toFixed(2) : '') + '</div>' +
      (f.photo ? '<img class="thumb" src="' + f.photo + '">' : '') +
      '<div class="factions"><button data-edit="' + f.id + '">Επεξεργασία</button><button data-center="' + f.id + '">Κέντρο</button>' +
      (f.type === 'point' ? '<button data-stake="' + f.id + '">📍 Stakeout</button>' : '') + '</div></div>';
  }).join('');
  body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditor(b.dataset.edit));
  body.querySelectorAll('[data-center]').forEach(b => b.onclick = () => {
    const f = features.find(x => x.id === b.dataset.center);
    if (f) map.setView(f.coords[0], Math.max(map.getZoom(), 18));
  });
  body.querySelectorAll('[data-stake]').forEach(b => b.onclick = () => startStakeout(b.dataset.stake));
}

// ---------- Εξαγωγές ----------
function download(name, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function stamp() { return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'); }

// CSV σε ΕΓΣΑ87 (ένα σημείο ανά γραμμή, με τύπο χαρακτηριστικού)
function exportCSV() {
  let out = 'KWS,PX,PY,Z,ONOMA,KATHGORIA,SIMEIOSI,TYPOS,SEQ,LAT,LON,SHMANSI\n';
  features.forEach(f => {
    f.coords.forEach((c, i) => {
      const e = wgs84ToEgsa87(c[0], c[1]);
      out += (e ? e.easting.toFixed(3) : '') + ',' + (e ? e.northing.toFixed(3) : '') + ',,' +
        '"' + csv(f.name) + '","' + csv(f.cat) + '","' + csv(f.note) + '",' + f.type + ',' + (i + 1) + ',' +
        fmt(c[0], 8) + ',' + fmt(c[1], 8) + ',"' + csv(f.tag || '') + '"\n';
    });
  });
  download('kroki_EGSA87_' + stamp() + '.csv', out, 'text/csv;charset=utf-8');
  toast('Εξαγωγή CSV (ΕΓΣΑ87)');
}
function csv(s) { return String(s).replace(/"/g, '""'); }

function exportKML() {
  let k = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Kroki</name>';
  features.forEach(f => {
    if (f.type === 'point') {
      const e = wgs84ToEgsa87(f.coords[0][0], f.coords[0][1]);
      k += '<Placemark><name>' + esc(f.name) + '</name><Point><coordinates>' +
        fmt(f.coords[0][1], 8) + ',' + fmt(f.coords[0][0], 8) + ',0</coordinates></Point>' +
        (e ? '<ExtendedData><Data name="EGSA87"><value>X=' + e.easting.toFixed(2) + ' Y=' + e.northing.toFixed(2) + '</value></Data></ExtendedData>' : '') +
        '</Placemark>';
    } else {
      const coords = f.coords.map(c => fmt(c[1], 8) + ',' + fmt(c[0], 8) + ',0').join(' ');
      k += '<Placemark><name>' + esc(f.name) + '</name><' + (f.type === 'line' ? 'LineString' : 'Polygon') + '><' +
        (f.type === 'line' ? 'coordinates' : 'outerBoundaryIs><LinearRing><coordinates') + '>' + coords +
        (f.type === 'line' ? '</coordinates>' : '</coordinates></LinearRing></outerBoundaryIs>') + '</' +
        (f.type === 'line' ? 'LineString' : 'Polygon') + '></Placemark>';
    }
  });
  k += '</Document></kml>';
  download('kroki_' + stamp() + '.kml', k, 'application/vnd.google-earth.kml+xml');
  toast('Εξαγωγή KML');
}
function exportGeoJSON() {
  const gj = { type: 'FeatureCollection', features: features.map(f => ({
    type: 'Feature',
    geometry: f.type === 'point' ? { type: 'Point', coordinates: [f.coords[0][1], f.coords[0][0]] }
      : { type: f.type === 'line' ? 'LineString' : 'Polygon', coordinates: f.type === 'polygon' ? [f.coords.map(c => [c[1], c[0]])] : f.coords.map(c => [c[1], c[0]]) },
    properties: { name: f.name, cat: f.cat, note: f.note, photo: f.photo ? '[image]' : '', ts: f.ts }
  })) };
  download('kroki_' + stamp() + '.geojson', JSON.stringify(gj, null, 2), 'application/geo+json');
  toast('Εξαγωγή GeoJSON');
}

// ---------- Stakeout ----------
let stake = null; // { id, name, target:[lat,lon], marker, line }
function startStakeout(id) {
  const f = features.find(x => x.id === id);
  if (!f || f.type !== 'point') { toast('Το stakeout είναι για σημεία'); return; }
  const target = f.coords[0];
  if (stake && stake.marker) map.removeLayer(stake.marker);
  if (stake && stake.line) map.removeLayer(stake.line);
  stake = { id, name: f.name, target, marker: null, line: null };
  document.getElementById('panel').classList.add('hidden');
  document.getElementById('stkTitle').textContent = 'Stakeout: ' + f.name;
  document.getElementById('stakeout').classList.remove('hidden');
  if (gpsFix) updateStakeout(); else toast('Ενεργοποίησε το GPS για stakeout');
}
function stopStakeout() {
  if (stake && stake.marker) map.removeLayer(stake.marker);
  if (stake && stake.line) map.removeLayer(stake.line);
  stake = null;
  document.getElementById('stakeout').classList.add('hidden');
}
function updateStakeout() {
  if (!stake || !gpsFix) return;
  const from = [gpsFix.lat, gpsFix.lon];
  const t = toTarget(from, stake.target);
  const arrow = document.getElementById('stkArrow');
  arrow.style.transform = 'rotate(' + t.brg + 'deg)';
  const d = t.dist;
  const distTxt = d >= 1000 ? fmtNum(d / 1000) + ' km' : fmtNum(d) + ' m';
  document.getElementById('stkInfo').innerHTML =
    'Απόσταση: <b>' + distTxt + '</b><br>Αζιμούθιο: <b>' + fmtNum(t.brg, 1) + '°</b>' +
    (gpsFix.acc ? '<br>Ακρίβεια GPS: ±' + gpsFix.acc.toFixed(0) + ' m' : '');
  // ενημέρωση χάρτη: γραμμή από GPS -> στόχο
  if (stake.line) map.removeLayer(stake.line);
  stake.line = L.polyline([from, stake.target], { color: '#e65100', weight: 2, dashArray: '4 6' }).addTo(map);
  if (!stake.marker) {
    stake.marker = L.circleMarker(stake.target, { radius: 9, color: '#fff', fillColor: '#e65100', fillOpacity: 1, weight: 3 }).addTo(map)
      .bindTooltip('Στόχος: ' + stake.name, { permanent: true });
  }
}

// ---------- Εισαγωγή KML (για σύγκριση) ----------
let kmlLayer = null;
function importKML(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const txt = r.result;
      const xml = new DOMParser().parseFromString(txt, 'text/xml');
      if (xml.querySelector('parsererror')) throw new Error('Μη έγκυρο KML');
      const pts = [], lines = [], polys = [];
      // Placemarks με Point
      xml.querySelectorAll('Point').forEach(p => {
        const c = p.querySelector('coordinates');
        if (c) { const [lon, lat] = c.textContent.trim().split(',').map(Number); if (!isNaN(lat)) pts.push([lat, lon]); }
      });
      // LineStrings / Polygons (παίρνουμε τις συντεταγμένες)
      const grab = (sel, bucket, closed) => {
        xml.querySelectorAll(sel).forEach(el => {
          const c = el.querySelector('coordinates');
          if (!c) return;
          const arr = c.textContent.trim().split(/\s+/).map(s => s.split(',').map(Number)).filter(a => a.length >= 2 && !isNaN(a[0]) && !isNaN(a[1])).map(a => [a[1], a[0]]);
          if (arr.length) bucket.push(arr);
        });
      };
      grab('LineString', lines, false);
      grab('LinearRing', polys, true);
      if (kmlLayer) map.removeLayer(kmlLayer);
      kmlLayer = L.layerGroup().addTo(map);
      pts.forEach(p => L.circleMarker(p, { radius: 5, color: '#fff', fillColor: '#9c27b0', fillOpacity: 1, weight: 2 }).addTo(kmlLayer));
      lines.forEach(l => L.polyline(l, { color: '#9c27b0', weight: 3, dashArray: '5 5' }).addTo(kmlLayer));
      polys.forEach(p => L.polygon(p, { color: '#9c27b0', weight: 3, fillColor: '#9c27b0', fillOpacity: 0.12, dashArray: '5 5' }).addTo(kmlLayer));
      const n = pts.length + lines.length + polys.length;
      if (n) {
        map.fitBounds(kmlLayer.getBounds());
        toast('Εισήχθησαν ' + n + ' στοιχεία KML (μωβ)');
      } else toast('Δεν βρέθηκαν συντεταγμένες στο KML');
    } catch (e) { toast('Σφάλμα KML: ' + e.message); }
  };
  r.readAsText(file);
}

// ---------- Εξωτερικός GNSS μέσω Bluetooth (Web Bluetooth) ----------
let btDev = null, btChar = null, btBuf = '', btFix = null;
function setBtStatus(txt) {
  const btn = document.getElementById('btnBt');
  btn.textContent = '🔵 ' + txt;
}
async function connectGNSS() {
  if (!('bluetooth' in navigator)) { toast('Το Bluetooth δεν υποστηρίζεται (χρειάζεται HTTPS + Chrome)'); return; }
  try {
    setBtStatus('Αναζήτηση…');
    const device = await navigator.bluetooth.requestDevice({
      // Φίλτρο για συσκευές που δημοσιεύουν NUS (Emlid/πολλοί GNSS) ή γενικό
      optionalServices: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e', '0000180a-0000-1000-8000-00805f9b34fb']
    });
    btDev = device;
    setBtStatus('Σύνδεση… ' + (device.name || ''));
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('6e400001-b5a3-f393-e0a9-e50e24dcca9e');
    btChar = await service.getCharacteristic('6e400003-b5a3-f393-e0a9-e50e24dcca9e'); // RX (NMEA out)
    await btChar.startNotifications();
    btChar.addEventListener('characteristicvaluechanged', onBtData);
    device.addEventListener('gattserverdisconnected', () => { setBtStatus('Αποσυνδέθηκε'); btDev = null; btChar = null; });
    setBtStatus('Συνδεδεμένο: ' + (device.name || 'GNSS'));
    toast('GNSS συνδέθηκε. Περιμένω NMEA…');
  } catch (e) {
    setBtStatus('Σύνδεση GNSS (Bluetooth)');
    toast('Bluetooth: ' + (e.message || e));
  }
}
function onBtData(ev) {
  const v = new Uint8Array(ev.target.value.buffer);
  btBuf += String.fromCharCode.apply(null, v);
  let idx;
  while ((idx = btBuf.indexOf('\n')) >= 0) {
    const line = btBuf.slice(0, idx).trim();
    btBuf = btBuf.slice(idx + 1);
    if (line.startsWith('$')) parseNMEA(line);
  }
}
function parseNMEA(line) {
  // RMC δίνει θέση + ταχύτητα, GGA δίνει θέση + ακρίβεια
  const parts = line.split(',');
  if (parts[0] === '$GNRMC' || parts[0] === '$GPRMC') {
    if (parts[2] !== 'A') return; // V = void
    const lat = nmeaToDec(parts[3], parts[4]), lon = nmeaToDec(parts[5], parts[6]);
    if (isNaN(lat) || isNaN(lon)) return;
    btFix = { lat, lon, acc: gpsFix ? gpsFix.acc : 5, ts: Date.now(), src: 'bt' };
    applyExternalFix(btFix);
  } else if (parts[0] === '$GNGGA' || parts[0] === '$GPGGA') {
    const lat = nmeaToDec(parts[2], parts[3]), lon = nmeaToDec(parts[4], parts[5]);
    if (isNaN(lat) || isNaN(lon)) return;
    const hdop = parseFloat(parts[8]); const sats = parseInt(parts[7], 10);
    const acc = (!isNaN(hdop) && hdop > 0) ? hdop * 5 : (gpsFix ? gpsFix.acc : 5); // χονδρική εκτίμηση ακρίβειας
    btFix = { lat, lon, acc, sats, ts: Date.now(), src: 'bt' };
    applyExternalFix(btFix);
  }
}
function nmeaToDec(val, hem) {
  if (!val || !hem) return NaN;
  const deg = Math.floor(parseFloat(val) / 100);
  const min = parseFloat(val) - deg * 100;
  let d = deg + min / 60;
  if (hem === 'S' || hem === 'W') d = -d;
  return d;
}
function applyExternalFix(f) {
  // χρησιμοποιούμε το BT fix σαν το GPS fix (προτεραιότητα εξωτερικού δέκτη)
  gpsFix = f;
  setGpsStatus('fix', (f.src === 'bt' ? 'GNSS(BT) ±' : 'GPS ±') + (f.acc ? f.acc.toFixed(0) : '?') + 'm' + (f.sats ? ' ' + f.sats + 'δ' : ''));
  if (!gpsMarker) {
    gpsMarker = L.circleMarker([f.lat, f.lon], { radius: 7, color: '#1565c0', fillColor: '#42a5f5', fillOpacity: 1, weight: 3 }).addTo(map);
    gpsCircle = L.circle([f.lat, f.lon], { radius: f.acc || 5, color: '#1565c0', fillColor: '#1565c0', fillOpacity: 0.08, weight: 1 }).addTo(map);
    map.setView([f.lat, f.lon], Math.max(map.getZoom(), 18));
  } else {
    gpsMarker.setLatLng([f.lat, f.lon]);
    gpsCircle.setLatLng([f.lat, f.lon]).setRadius(f.acc || 5);
  }
  const e = wgs84ToEgsa87(f.lat, f.lon);
  document.getElementById('fixText').innerHTML =
    (f.src === 'bt' ? 'GNSS(BT): ' : 'Εδώ: ') + fmt(f.lat, 6) + ', ' + fmt(f.lon, 6) +
    (e ? '<br>ΕΓΣΑ87 X=' + e.easting.toFixed(2) + ' Y=' + e.northing.toFixed(2) : '');
  document.getElementById('fixBanner').classList.remove('hidden');
  updateStakeout();
}

// ---------- Toast ----------
let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2200);
}

// ---------- Πλοήγηση / wiring ----------
function wire() {
  document.querySelectorAll('.tool[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  document.getElementById('gpsBtn').onclick = () => { watchId === null ? startGPS() : stopGPS(); };
  document.getElementById('dropGpsBtn').onclick = () => {
    if (gpsFix) openModal('point', { coords: [[gpsFix.lat, gpsFix.lon]] });
    else toast('Δεν υπάρχει διαθέσιμο GPS');
  };
  document.getElementById('undoVertex').onclick = undoVertex;
  document.getElementById('finishDraw').onclick = finishDraw;
  document.getElementById('cancelDraw').onclick = cancelDraw;
  document.getElementById('measureUndo').onclick = undoVertex;
  document.getElementById('measureSave').onclick = saveMeasure;
  document.getElementById('measureCancel').onclick = () => setMode('pan');
  document.getElementById('modalSave').onclick = saveModal;
  document.getElementById('modalDelete').onclick = deleteFeature;
  document.getElementById('modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  document.getElementById('listBtn').onclick = () => {
    document.getElementById('panelTitle').textContent = 'Στοιχεία (' + features.length + ')';
    renderFeatures(); document.getElementById('panel').classList.remove('hidden');
  };
  document.getElementById('panelClose').onclick = () => document.getElementById('panel').classList.add('hidden');
  document.getElementById('exportBtn').onclick = () => document.getElementById('sheet').classList.remove('hidden');
  document.getElementById('sheetClose').onclick = () => document.getElementById('sheet').classList.add('hidden');
  document.getElementById('sheet').addEventListener('click', e => { if (e.target.id === 'sheet') e.target.classList.add('hidden'); });
  document.getElementById('expCsv').onclick = exportCSV;
  document.getElementById('expKml').onclick = exportKML;
  document.getElementById('expGeojson').onclick = exportGeoJSON;
  document.getElementById('clearAll').onclick = () => {
    if (confirm('Να διαγραφούν ΟΛΑ τα στοιχεία;')) {
      dbClear().then(() => { features = []; renderFeatures(); renderAll(); document.getElementById('sheet').classList.add('hidden'); toast('Άδειασμα'); });
    }
  };
  document.getElementById('menuBtn').onclick = () => document.getElementById('sheet').classList.remove('hidden');
  document.getElementById('impKml').onclick = () => { document.getElementById('sheet').classList.add('hidden'); document.getElementById('kmlInput').click(); };
  document.getElementById('kmlInput').onchange = e => { if (e.target.files[0]) importKML(e.target.files[0]); e.target.value = ''; };
  document.getElementById('btnBt').onclick = connectGNSS;
  document.getElementById('stkClose').onclick = stopStakeout;
  document.getElementById('stkDone').onclick = stopStakeout;
  document.getElementById('stkCenter').onclick = () => { if (stake) map.setView(stake.target, Math.max(map.getZoom(), 19)); };
}

// ---------- Εκκίνηση ----------
async function boot() {
  initMap();
  map.on('click', onMapClick);
  wire();
  try { await openDB(); features = await dbAll(); renderAll(); }
  catch (e) { console.error(e); toast('Σφάλμα βάσης'); }
  setMode('pan');
  setGpsStatus('', 'GPS: ανενεργό');
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {/* offline δεν είναι κρίσιμο */});
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
