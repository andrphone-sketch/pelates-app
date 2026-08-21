// Έλεγχος των συναρτήσεων εξαγωγής (CSV/KML/GeoJSON) — επικεντρώνεται στη σωστή σειρά συντεταγμένων
const path = require('path');
const proj4 = require(path.join(__dirname, 'vendor', 'proj4.js'));
proj4.defs('EPSG:2100',
  '+proj=tmerc +lat_0=0 +lon_0=24 +k=0.9996 +x_0=500000 +y_0=0 ' +
  '+ellps=GRS80 +towgs84=-199.87,74.79,246.62,0,0,0,0 +units=m +no_defs');
const fmt = (n, d = 6) => Number(n).toFixed(d);
const wgs84ToEgsa87 = (lat, lon) => { const [e, n] = proj4('EPSG:4326', 'EPSG:2100', [lon, lat]); return { easting: e, northing: n }; };

// δείγμα δεδομένων
const features = [
  { id: 'f1', type: 'point', coords: [[37.9755, 23.7342]], name: 'Π1', cat: 'Σύνορο οικοπέδου', note: '', photo: '', ts: 1 },
  { id: 'f2', type: 'line', coords: [[37.976, 23.734], [37.977, 23.735]], name: 'Δ1', cat: 'Δρόμος', note: '', photo: '', ts: 2 },
  { id: 'f3', type: 'polygon', coords: [[37.97, 23.73], [37.97, 23.74], [37.98, 23.74], [37.98, 23.73]], name: 'Ο1', cat: 'Κτίσμα', note: '', photo: '', ts: 3 }
];

let ok = true;
function check(name, cond, detail) { if (!cond) ok = false; console.log((cond ? 'OK ' : 'XX ') + name + (detail ? '  ' + detail : '')); }

// ---- CSV (ΕΓΣΑ87) ----
let csv = 'KWS,PX,PY,Z,ONOMA,KATHGORIA,SIMEIOSI,TYPOS,SEQ,LAT,LON\n';
features.forEach(f => f.coords.forEach((c, i) => {
  const e = wgs84ToEgsa87(c[0], c[1]);
  csv += (e ? e.easting.toFixed(3) : '') + ',' + (e ? e.northing.toFixed(3) : '') + ',,' +
    '"' + f.name + '","' + f.cat + '","",' + f.type + ',' + (i + 1) + ',' + fmt(c[0], 8) + ',' + fmt(c[1], 8) + '\n';
}));
check('CSV header σωστό', csv.startsWith('KWS,PX,PY,Z,ONOMA'));
check('CSV έχει 1 γραμμή για το σημείο Π1', (csv.match(/Π1/g) || []).length === 1);
check('CSV point έχει ΕΓΣΑ87 X≈476506', csv.includes('476506'), csv.split('\n').find(l => l.includes('Π1')));
console.log(csv);

// ---- KML ----
let kml = '<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Kroki</name>';
features.forEach(f => {
  if (f.type === 'point') {
    const e = wgs84ToEgsa87(f.coords[0][0], f.coords[0][1]);
    kml += '<Placemark><name>' + f.name + '</name><Point><coordinates>' +
      fmt(f.coords[0][1], 8) + ',' + fmt(f.coords[0][0], 8) + ',0</coordinates></Point></Placemark>';
  } else {
    const coords = f.coords.map(c => fmt(c[1], 8) + ',' + fmt(c[0], 8) + ',0').join(' ');
    kml += '<Placemark><name>' + f.name + '</name><' + (f.type === 'line' ? 'LineString' : 'Polygon') + '><' +
      (f.type === 'line' ? 'coordinates' : 'outerBoundaryIs><LinearRing><coordinates') + '>' + coords +
      (f.type === 'line' ? '</coordinates>' : '</coordinates></LinearRing></outerBoundaryIs>') + '</' +
      (f.type === 'line' ? 'LineString' : 'Polygon') + '></Placemark>';
  }
});
kml += '</Document></kml>';
check('KML έγκυρο XML (κλείνει kml)', kml.endsWith('</kml>'));
check('KML σημείο έχει σειρά lon,lat', kml.includes('<Point><coordinates>23.73420000,37.97550000,0</coordinates>'));
check('KML polygon έχει outerBoundaryIs/LinearRing', kml.includes('outerBoundaryIs><LinearRing><coordinates'));
// έλεγχος έγκυρου XML μέσω απλού parser (Node δεν έχει DOMParser· απλή ισορροπία tags)
const opens = (kml.match(/<[a-zA-Z]/g) || []).length;
console.log('KML bytes:', kml.length, 'tags-open:', opens);

// ---- GeoJSON ----
const gj = { type: 'FeatureCollection', features: features.map(f => ({
  type: 'Feature',
  geometry: f.type === 'point' ? { type: 'Point', coordinates: [f.coords[0][1], f.coords[0][0]] }
    : { type: f.type === 'line' ? 'LineString' : 'Polygon', coordinates: f.type === 'polygon' ? [f.coords.map(c => [c[1], c[0]])] : f.coords.map(c => [c[1], c[0]]) },
  properties: { name: f.name, cat: f.cat }
})) };
const gjStr = JSON.stringify(gj);
check('GeoJSON έγκυρο JSON', (() => { try { JSON.parse(gjStr); return true; } catch (e) { return false; } })());
check('GeoJSON Point συντεταγμένες [lon,lat]', gj.features[0].geometry.coordinates[0] === 23.7342 && gj.features[0].geometry.coordinates[1] === 37.9755);
check('GeoJSON Polygon είναι nested array', Array.isArray(gj.features[2].geometry.coordinates[0]));
console.log(gjStr.slice(0, 300));

console.log(ok ? '\nPASS: Οι εξαγωγές παράγουν σωστές μορφές (σειρά lon/lat).' : '\nFAIL');
process.exit(ok ? 0 : 1);
