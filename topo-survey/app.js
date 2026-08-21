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
function saveModal() {
  if (!editing) return;
  const id = 'f' + Date.now() + Math.floor(Math.random() * 1000);
  const rec = {
    id, type: editing.type, coords: editing.coords,
    name: document.getElementById('fName').value.trim() || ('Στοιχείο ' + (features.length + 1)),
    cat: document.getElementById('fCat').value,
    note: document.getElementById('fNote').value.trim(),
    photo: document.getElementById('modal').dataset.photo || '',
    ts: Date.now()
  };
  dbPut(rec).then(() => { features.push(rec); renderFeatures(); renderAll(); closeModal(); toast('Αποθηκεύτηκε'); });
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
      '<div class="factions"><button data-edit="' + f.id + '">Επεξεργασία</button><button data-center="' + f.id + '">Κέντρο</button></div></div>';
  }).join('');
  body.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openEditor(b.dataset.edit));
  body.querySelectorAll('[data-center]').forEach(b => b.onclick = () => {
    const f = features.find(x => x.id === b.dataset.center);
    if (f) map.setView(f.coords[0], Math.max(map.getZoom(), 18));
  });
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
  let out = 'KWS,PX,PY,Z,ONOMA,KATHGORIA,SIMEIOSI,TYPOS,SEQ,LAT,LON\n';
  features.forEach(f => {
    f.coords.forEach((c, i) => {
      const e = wgs84ToEgsa87(c[0], c[1]);
      out += (e ? e.easting.toFixed(3) : '') + ',' + (e ? e.northing.toFixed(3) : '') + ',,' +
        '"' + csv(f.name) + '","' + csv(f.cat) + '","' + csv(f.note) + '",' + f.type + ',' + (i + 1) + ',' +
        fmt(c[0], 8) + ',' + fmt(c[1], 8) + '\n';
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
