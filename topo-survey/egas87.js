// Μετατροπή WGS84 (GPS) -> ΕΓΣΑ87 (Ελληνικό Γεωδαιτικό Σύστημα Αναφοράς 1987, ΕΓΣΑ'87)
// Το ΕΓΣΑ87 είναι το επίσημο σύστημα αναφοράς στην Ελλάδα για πολεοδομίες/οικοδομικές άδειες.
// Ορίζεται ως Transverse Mercator ζώνης 34N (κεντρικό μεσημβρινό 24°), με ελλειψοειδές GRS80
// και παράμετροι μετατόπισης (towgs84) για τη σύνδεση με το WGS84.
window.EGSA87_DEF =
  '+proj=tmerc +lat_0=0 +lon_0=24 +k=0.9996 +x_0=500000 +y_0=0 ' +
  '+ellps=GRS80 +towgs84=-199.87,74.79,246.62,0,0,0,0 +units=m +no_defs';

if (window.proj4) {
  window.proj4.defs('EPSG:2100', window.EGSA87_DEF);
}

// lat, lon (δεκαδικές μοίρες) -> { easting, northing } σε μέτρα (ΕΓΣΑ87)
// Επιστρέφει null αν δεν υπάρχει proj4.
function wgs84ToEgsa87(lat, lon) {
  if (!window.proj4) return null;
  const [easting, northing] = window.proj4('EPSG:4326', 'EPSG:2100', [lon, lat]);
  return { easting, northing };
}
window.wgs84ToEgsa87 = wgs84ToEgsa87;
