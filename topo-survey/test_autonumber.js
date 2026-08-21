// Έλεγχος αυτόματης αρίθμησης σήμανσης (autoNumber)
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
function autoNumber(features, cat) {
  const prefix = CAT_PREFIX[cat] || 'ΣΤ';
  let max = 0;
  features.forEach(f => {
    const m = (f.tag || '').match(new RegExp('^' + prefix + '(\\d+)$'));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return prefix + (max + 1);
}

let ok = true;
function check(name, cond, detail) { if (!cond) ok = false; console.log((cond ? 'OK ' : 'XX ') + name + (detail ? '  ' + detail : '')); }

// 1) κενή λίστα -> Π1
check('κενή -> Π1', autoNumber([], 'Πασσαλος / σημείο ελέγχου') === 'Π1');

// 2) υπάρχοντες πασσάλοι Π1,Π2 -> Π3
let feats = [{ tag: 'Π1' }, { tag: 'Π2' }];
check('Π1,Π2 -> Π3', autoNumber(feats, 'Πασσαλος / σημείο ελέγχου') === 'Π3', autoNumber(feats, 'Πασσαλος / σημείο ελέγχου'));

// 3) διαφορετικές κατηγορίες δεν μπερδεύονται: Σ1 δεν επηρεάζει Π
feats = [{ tag: 'Σ1' }, { tag: 'Π2' }, { tag: 'Σ3' }];
check('με Σ1,Σ3 -> Π3', autoNumber(feats, 'Πασσαλος / σημείο ελέγχου') === 'Π3', autoNumber(feats, 'Πασσαλος / σημείο ελέγχου'));
check('με Σ1,Σ3 -> Σ4', autoNumber(feats, 'Σύνορο οικοπέδου') === 'Σ4', autoNumber(feats, 'Σύνορο οικοπέδου'));

// 4) μη αριθμητικά tags αγνοούνται
feats = [{ tag: 'Π1' }, { tag: 'όνομα' }, { tag: 'Π5' }];
check('Π1,Π5 -> Π6 (αγνοεί μη-αριθμητικά)', autoNumber(feats, 'Πασσαλος / σημείο ελέγχου') === 'Π6', autoNumber(feats, 'Πασσαλος / σημείο ελέγχου'));

// 5) άγνωστη κατηγορία -> ΣΤ1
check('άγνωστη -> ΣΤ1', autoNumber([], 'ΧΧ') === 'ΣΤ1');

console.log(ok ? '\nPASS: Αυτόματη αρίθμηση σήμανσης εντάξει.' : '\nFAIL');
process.exit(ok ? 0 : 1);
