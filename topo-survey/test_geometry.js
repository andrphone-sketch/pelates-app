// Έλεγχος γεωμετρίας: Haversine (μήκος) + shoelace σε ΕΓΣΑ87 (εμβαδόν)
const path = require('path');
const proj4 = require(path.join(__dirname, 'vendor', 'proj4.js'));
proj4.defs('EPSG:2100',
  '+proj=tmerc +lat_0=0 +lon_0=24 +k=0.9996 +x_0=500000 +y_0=0 ' +
  '+ellps=GRS80 +towgs84=-199.87,74.79,246.62,0,0,0,0 +units=m +no_defs');
const wgs84ToEgsa87 = (lat, lon) => { const [e, n] = proj4('EPSG:4326', 'EPSG:2100', [lon, lat]); return { easting: e, northing: n }; };
const toRad = d => d * Math.PI / 180;
function haversine(a, b) {
  const R = 6371008.8;
  const dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
  const la1 = toRad(a[0]), la2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function polylineLength(coords, closed = false) {
  let s = 0;
  const n = closed ? coords.length : coords.length - 1;
  for (let i = 1; i <= n; i++) s += haversine(coords[i - 1], coords[i % coords.length]);
  return s;
}
function polygonArea(coords) {
  const p = coords.map(c => { const e = wgs84ToEgsa87(c[0], c[1]); return [e.easting, e.northing]; });
  let A = 0;
  for (let i = 0; i < p.length; i++) { const j = (i + 1) % p.length; A += p[i][0] * p[j][1] - p[j][0] * p[i][1]; }
  return Math.abs(A / 2);
}

let ok = true;
function check(name, cond, detail) { if (!cond) ok = false; console.log((cond ? 'OK ' : 'XX ') + name + (detail ? '  ' + detail : '')); }

// 1) Δύο σημεία 0.001° γεωγραφικού πλάτους ~ 111.32 m βόρεια (κοντά στον ισημερινό/Ελλάδα)
const d1 = haversine([38.0, 23.7], [38.001, 23.7]);
check('0.001° lat ≈ 111.3 m', Math.abs(d1 - 111.32) < 2, d1.toFixed(2) + ' m');

// 2) Τετράγωνο 100m x 100m στην Αθήνα -> μήκος πλευράς ~100m, εμβαδόν ~10000 m²
// κατασκευάζουμε τετράγωνο σε ΕΓΣΑ87 και επιστρέφουμε σε lat/lon
const sq100 = [];
const base = wgs84ToEgsa87(38.0, 23.7);
const corners = [[base.easting, base.northing], [base.easting + 100, base.northing], [base.easting + 100, base.northing + 100], [base.easting, base.northing + 100]];
corners.forEach(c => {
  const [lon, lat] = proj4('EPSG:2100', 'EPSG:4326', [c[0], c[1]]);
  sq100.push([lat, lon]);
});
const side1 = haversine(sq100[0], sq100[1]);
const side2 = haversine(sq100[1], sq100[2]);
const area = polygonArea(sq100);
check('πλευρά τετραγώνου ≈ 100 m', Math.abs(side1 - 100) < 1 && Math.abs(side2 - 100) < 1, side1.toFixed(2) + ' / ' + side2.toFixed(2) + ' m');
check('εμβαδόν τετραγώνου ≈ 10000 m²', Math.abs(area - 10000) < 50, area.toFixed(1) + ' m²');

// 3) γραμμή ίδια απόσταση και με τις δύο κατευθύνσεις
const ab = haversine([38.0, 23.7], [38.005, 23.71]);
const ba = haversine([38.005, 23.71], [38.0, 23.7]);
check('συμμετρία απόστασης', Math.abs(ab - ba) < 1e-6, ab.toFixed(2) + ' / ' + ba.toFixed(2));

// 4) polylineLength αθροίζει
const pl = polylineLength(sq100, true);
check('περίμετρος τετραγώνου ≈ 400 m', Math.abs(pl - 400) < 5, pl.toFixed(2) + ' m');

console.log(ok ? '\nPASS: Μετρήσεις μήκους/εμβαδού αξιόπιστες.' : '\nFAIL');
process.exit(ok ? 0 : 1);
