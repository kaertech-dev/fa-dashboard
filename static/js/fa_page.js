// fa_page.js
// ── FAILURE ANALYSIS MODAL ────────────────────────────────────────────────────
document.getElementById('btn-failure-analysis').addEventListener('click', openFaModal);
document.getElementById('btn-fa-close').addEventListener('click', closeFaModal);
document.getElementById('btn-fa-exit').addEventListener('click', closeFaModal);

const FA_TEXT_FIELDS = ['fa-failure-cause', 'fa-affected-comp'];
const FA_SELECT_FIELDS = ['fa-proposed-action', 'fa-defect-cat', 'fa-class'];

function closeFaModal() {
  document.getElementById('modal-fa').style.display = 'none';
}

function resetFaForm() {
  document.getElementById('fa-error').textContent = '';
  document.getElementById('fa-serial').value = '';
  document.getElementById('fa-datetime').value = '';
  document.getElementById('fa-text-display').textContent = 'Scan a serial number to load UUT details…';
  FA_TEXT_FIELDS.forEach(id => document.getElementById(id).value = '');
  FA_SELECT_FIELDS.forEach(id => document.getElementById(id).value = '');
  document.getElementById('fa-pic').value = '';
  document.getElementById('fa-pic').readOnly = true;
}

async function openFaModal() {
  document.getElementById('user-menu-dropdown').classList.remove('open');
  resetFaForm();
  document.getElementById('modal-fa').style.display = 'flex';
  await loadFaOptions();
  document.getElementById('fa-serial').focus();
}

async function loadFaOptions() {
  try {
    const res  = await fetch('/api/failure_analysis/options');
    const json = await res.json();
    if (json.ok) {
      fillFaSelect('fa-proposed-action', json.proposed_action);
      fillFaSelect('fa-defect-cat', json.defect_cat);
    }
  } catch (e) {
    // Non-fatal — user can still type free values if selects stay empty.
  }
}

function fillFaSelect(id, vals) {
  const sel = document.getElementById(id);
  const current = sel.value;
  while (sel.options.length > 1) sel.remove(1);
  vals.forEach(v => sel.add(new Option(v, v)));
  sel.value = current;
}

// Ensure a value exists as an <option> even if it wasn't in the distinct list yet
function ensureOption(selectId, value) {
  if (!value) return;
  const sel = document.getElementById(selectId);
  const exists = Array.from(sel.options).some(o => o.value === value);
  if (!exists) sel.add(new Option(value, value));
  sel.value = value;
}

function formatDate(v) {
  if (!v) return '–';
  return String(v).replace('T', ' ').slice(0, 19);
}

// ── SERIAL SCAN ────────────────────────────────────────────────────────────────
document.getElementById('fa-serial').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); scanFaSerial(); }
});
document.getElementById('fa-serial').addEventListener('blur', scanFaSerial);

async function scanFaSerial() {
  const err    = document.getElementById('fa-error');
  const serial = document.getElementById('fa-serial').value.trim();
  err.textContent = '';
  if (!serial) return;

  try {
    const res  = await fetch('/api/failure_analysis/lookup/' + encodeURIComponent(serial));
    const json = await res.json();
    if (!json.ok) {
      document.getElementById('fa-text-display').textContent = 'Serial number not found.';
      document.getElementById('fa-datetime').value = '';
      err.textContent = json.error || 'Serial number not found.';
      return;
    }
    const r = json.row;

    document.getElementById('fa-datetime').value = formatDate(r.faendorse_datetime);
    document.getElementById('fa-text-display').textContent =
`UUT DETAILS:

Product: ${r.product || '–'}
Model: ${r.model || '–'}
PO: ${r.po_num || '–'}
Station: ${r.station || '–'}
Test Failure: ${r.test_failure || '–'}
Endorsed By: ${r.prod_endorser || '–'}
Endorsement Date & Time: ${formatDate(r.faendorse_datetime)}`;

    // Pre-fill editable fields with whatever's already on record (if this FA is in progress)
    document.getElementById('fa-failure-cause').value = r.failure_cause || '';
    document.getElementById('fa-affected-comp').value = r.affected_comp || '';
    document.getElementById('fa-pic').value = r.fa_pic || '';
    ensureOption('fa-proposed-action', r.proposed_action);
    ensureOption('fa-defect-cat', r.defect_cat);
    document.getElementById('fa-class').value = r.fa_class ? String(r.fa_class) : '';
  } catch (e) {
    err.textContent = 'Could not reach server: ' + e.message;
  }
}

// ── FA PIC "Change" toggle ────────────────────────────────────────────────────
document.getElementById('btn-fa-pic-change').addEventListener('click', () => {
  const inp = document.getElementById('fa-pic');
  inp.readOnly = !inp.readOnly;
  if (!inp.readOnly) inp.focus();
});

// ── SUBMIT ────────────────────────────────────────────────────────────────────
document.getElementById('btn-fa-submit').addEventListener('click', async () => {
  const err = document.getElementById('fa-error');
  err.textContent = '';

  const serial  = document.getElementById('fa-serial').value.trim();
  const faClass = document.getElementById('fa-class').value;
  if (!serial)  { err.textContent = 'Please scan a valid serial number.'; return; }
  if (!['1','2','3','4'].includes(faClass)) { err.textContent = 'FA Class must be 1, 2, 3, or 4.'; return; }

  const payload = {
    serial_num: serial,
    failure_cause:   document.getElementById('fa-failure-cause').value.trim(),
    affected_comp:   document.getElementById('fa-affected-comp').value.trim(),
    fa_pic:          document.getElementById('fa-pic').value.trim(),
    proposed_action: document.getElementById('fa-proposed-action').value,
    defect_cat:      document.getElementById('fa-defect-cat').value,
    fa_class:        faClass,
  };

  const res  = await fetch('/api/failure_analysis/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (json.ok) {
    closeFaModal();
    if (typeof loadAndRender === 'function') loadAndRender(); // refresh table/charts
  } else {
    err.textContent = json.error || 'Failed to update failure analysis.';
  }
});