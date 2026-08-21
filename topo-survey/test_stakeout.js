// Έλεγχος: bearing (αζιμούθιο) + nmeaToDec
const toRad = d => d * Math.PI / 180, toDeg = r => r * 180 / Math.PI;
function bearing(a, b) {
  const la1 = toRad(a[0]), la2 = toRad(b[0]);
  const dLon = toRad(b[1] - a[1]);
  const y = Math.sin(dLon) * Math.cos(la2);
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon);
  let brg = toDeg(Math.atan2(y, x));
  return (brg + 360) % 360;
}
function nmeaToDec(val, hem) {
  if (!val || !hem) return NaN;
  const deg = Math.floor(parseFloat(val) / 100);
  const min = parseFloat(val) - deg * 100;
  let d = deg + min / 60;
  if (hem === 'S' || hem === 'W') d = -d;
  return d;
}
function haversine(a, b) {
  const R = 6371008.8;
  const dLat = toRad(b[0] - a[0]), dLon = toRad(b[1] - a[1]);
  const la1 = toRad(a[0]), la2 = toRad(b[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

let ok = true;
function check(name, cond, detail) { if (!cond) ok = false; console.log((cond ? 'OK ' : 'XX ') + name + (detail ? '  ' + detail : '')); }

// 1) Από ίδιο σημείο προς τα βόρεια -> 0°, ανατολικά -> 90°
const O = [38.0, 23.7];
check('βορράς -> 0°', Math.abs(bearing(O, [38.01, 23.7]) - 0) < 0.5, bearing(O, [38.01, 23.7]).toFixed(1));
check('ανατολικά -> 90°', Math.abs(bearing(O, [38.0, 23.8]) - 90) < 0.5, bearing(O, [38.0, 23.8]).toFixed(1));
check('νότος -> 180°', Math.abs(bearing(O, [37.99, 23.7]) - 180) < 0.5, bearing(O, [37.99, 23.7]).toFixed(1));
check('δύση -> 270°', Math.abs(bearing(O, [38.0, 23.6]) - 270) < 0.5, bearing(O, [38.0, 23.6]).toFixed(1));

// 2) συμμετρία: bearing A->B και B->A διαφέρουν κατά ~180°
const b1 = bearing([38.0, 23.7], [38.005, 23.71]);
const b2 = bearing([38.005, 23.71], [38.0, 23.7]);
let diff = Math.abs(b1 - b2); if (diff > 180) diff = 360 - diff;
check('αντίθετη φορά (~180°)', Math.abs(diff - 180) < 1, diff.toFixed(1));

// 3) nmeaToDec: 3809.1234 N = 38° 9.1234' = 38.15206..., 02344.5678 E
const lat = nmeaToDec('3809.1234', 'N');
const lon = nmeaToDec('02344.5678', 'E');
check('nmea lat N σωστό', Math.abs(lat - (38 + 9.1234 / 60)) < 1e-4, lat.toFixed(6));
check('nmea lon E σωστό', Math.abs(lon - (23 + 44.5678 / 60)) < 1e-4, lon.toFixed(6));
check('nmea S αρνητικό', nmeaToDec('3809.1234', 'S') < 0);
check('nmea W αρνητικό', nmeaToDec('02344.5678', 'W') < 0);

// 4) ενσωμάτωση: απόσταση + αζιμούθιο συνεπή
const dist = haversine([38.0, 23.7], [38.005, 23.71]);
check('απόσταση λογική', dist > 500 && dist < 2000, dist.toFixed(0) + ' m');

console.log(ok ? '\nPASS: Stakeout/ΝΜΕΑ μαθηματικά εντάξει.' : '\nFAIL');
process.exit(ok ? 0 : 1);
