// Έλεγχος παραγωγής DXF (δομή + σωστές ΕΓΣΑ87 τιμές)
const path = require('path');
const proj4 = require(path.join(__dirname, 'vendor', 'proj4.js'));
proj4.defs('EPSG:2100',
  '+proj=tmerc +lat_0=0 +lon_0=24 +k=0.9996 +x_0=500000 +y_0=0 ' +
  '+ellps=GRS80 +towgs84=-199.87,74.79,246.62,0,0,0,0 +units=m +no_defs');
const wgs84ToEgsa87 = (lat, lon) => { const [e, n] = proj4('EPSG:4326', 'EPSG:2100', [lon, lat]); return { easting: e, northing: n }; };
const dxfPair = (code, val) => code + '\n' + val + '\n';

function buildDXF(features) {
  let s = '0\nSECTION\n2\nENTITIES\n';
  features.forEach(f => {
    if (f.type === 'point') {
      const e = wgs84ToEgsa87(f.coords[0][0], f.coords[0][1]);
      if (!e) return;
      s += '0\nPOINT\n8\n0\n' + dxfPair(10, e.easting.toFixed(3)) + dxfPair(20, e.northing.toFixed(3)) + dxfPair(30, '0');
    } else if (f.type === 'line') {
      const pts = f.coords.map(c => wgs84ToEgsa87(c[0], c[1])).filter(Boolean);
      for (let i = 1; i < pts.length; i++) {
        s += '0\nLINE\n8\n0\n' + dxfPair(10, pts[i - 1].easting.toFixed(3)) + dxfPair(20, pts[i - 1].northing.toFixed(3)) + dxfPair(30, '0') +
          dxfPair(11, pts[i].easting.toFixed(3)) + dxfPair(21, pts[i].northing.toFixed(3)) + dxfPair(31, '0');
      }
    } else if (f.type === 'polygon') {
      const pts = f.coords.map(c => wgs84ToEgsa87(c[0], c[1])).filter(Boolean);
      if (pts.length < 3) return;
      s += '0\nLWPOLYLINE\n8\n0\n' + dxfPair(90, pts.length) + '70\n1\n';
      pts.forEach(p => { s += dxfPair(10, p.easting.toFixed(3)) + dxfPair(20, p.northing.toFixed(3)); });
    }
  });
  s += '0\nENDSEC\n0\nEOF\n';
  return s;
}

let ok = true;
function check(name, cond, detail) { if (!cond) ok = false; console.log((cond ? 'OK ' : 'XX ') + name + (detail ? '  ' + detail : '')); }

// Σημείο Σύνταγμα
const feat = [{ type: 'point', coords: [[37.9755, 23.7342]] }];
const dxf = buildDXF(feat);
check('DXF αρχίζει με SECTION/ENTITIES', dxf.startsWith('0\nSECTION\n2\nENTITIES'));
check('DXF περιέχει POINT', dxf.includes('0\nPOINT'));
check('DXF περιέχει X=476506.012', dxf.includes('476506.012'), dxf.split('\n').find(l => l === '476506.012') ? 'βρέθηκε' : 'λείπει');
check('DXF τελειώνει με ENDSEC/EOF', dxf.trim().endsWith('0\nEOF'));

// Γραμμή -> 1 LINE
const line = buildDXF([{ type: 'line', coords: [[37.976, 23.734], [37.977, 23.735]] }]);
check('γραμμή -> 1 LINE entity', (line.match(/0\nLINE/g) || []).length === 1);

// Πολύγωνο -> LWPOLYLINE κλειστό (group 70 = 1)
const poly = buildDXF([{ type: 'polygon', coords: [[37.97, 23.73], [37.97, 23.74], [37.98, 23.74], [37.98, 23.73]] }]);
check('πολύγωνο -> LWPOLYLINE', poly.includes('0\nLWPOLYLINE'));
check('πολύγωνο κλειστό (70\\n1)', poly.includes('70\n1'), poly.includes('70\n1') ? 'ναι' : 'όχι');
check('πολύγωνο 90=4 κορυφές', poly.includes('90\n4'));

// έγκυρη δομή: οι κωδικοί είναι αριθμοί
const codes = (dxf.match(/^\d+$/gm) || []);
check('οι κωδικοί DXF είναι αριθμοί', codes.length > 0 && codes.every(c => !isNaN(c)));

console.log(ok ? '\nPASS: Το DXF παράγεται σωστά (ΕΓΣΑ87).' : '\nFAIL');
process.exit(ok ? 0 : 1);
