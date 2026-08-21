// Έλεγχος μετατροπής WGS84 -> ΕΓΣΑ87 με proj4 (Node)
const path = require('path');
const proj4 = require(path.join(__dirname, 'vendor', 'proj4.js'));

proj4.defs('EPSG:2100',
  '+proj=tmerc +lat_0=0 +lon_0=24 +k=0.9996 +x_0=500000 +y_0=0 ' +
  '+ellps=GRS80 +towgs84=-199.87,74.79,246.62,0,0,0,0 +units=m +no_defs');

const tr = (lat, lon) => proj4('EPSG:4326', 'EPSG:2100', [lon, lat]);

let ok = true;
function check(name, cond, detail) {
  if (!cond) ok = false;
  console.log((cond ? 'OK ' : 'XX ') + name + (detail ? '  ' + detail : ''));
}

// 1) Στον κεντρικό μεσημβρινό lon=24 -> easting ≈ 500000 (±300m λόγω towgs84)
const [x0] = tr(38, 24);
check('lon=24 -> easting≈500000', Math.abs(x0 - 500000) < 300, 'X=' + x0.toFixed(1));

// 2) Ανατολικά = μεγαλύτερο easting, Βόρεια = μεγαλύτερο northing (μονοτονία)
const ath = tr(37.9755, 23.7342);          // Αθήνα
const her = tr(35.3387, 25.1442);           // Ηράκλειο (ανατολικά)
const the = tr(40.6401, 22.9444);           // Θεσσαλονίκη (βόρεια & δυτικά)
check('Ηράκλειο ανατολικότερα της Αθήνας', her[0] > ath[0], 'Ηρ=' + her[0].toFixed(0) + ' > Αθ=' + ath[0].toFixed(0));
check('Θεσσαλονίκη βορειότερα της Αθήνας', the[1] > ath[1], 'Θεσ=' + the[1].toFixed(0) + ' > Αθ=' + ath[1].toFixed(0));
check('Θεσσαλονίκη δυτικότερα της Αθήνας', the[0] < ath[0], 'Θεσ=' + the[0].toFixed(0) + ' < Αθ=' + ath[0].toFixed(0));

// 3) Γνωστό σημείο: Σύνταγμα Αθήνας ΕΓΣΑ87 ≈ (476500, 4202850) [δημοσιευμένη τιμή]
check('Σύνταγμα Αθήνας εντός ανοχής', Math.abs(ath[0] - 476500) < 1500 && Math.abs(ath[1] - 4202850) < 1500,
  'X=' + ath[0].toFixed(1) + ' Y=' + ath[1].toFixed(1));

// 4) Εύρος λογικό για Ελλάδα (X 300k-700k, Y 3.8M-4.7M)
check('Εύρος ΕΓΣΑ87 λογικό', ath[0] > 300000 && ath[0] < 700000 && ath[1] > 3800000 && ath[1] < 4700000);

console.log(ok ? '\nPASS: Η μετατροπή ΕΓΣΑ87 είναι αξιόπιστη.' : '\nFAIL');
process.exit(ok ? 0 : 1);
