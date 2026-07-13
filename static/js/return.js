// return.js
// ── RETURN MODAL ──────────────────────────────────────────────────────────────
document.getElementById('btn-return').addEventListener('click', openReturnModal);
document.getElementById('btn-return-close').addEventListener('click', closeReturnModal);
document.getElementById('btn-return-exit').addEventListener('click', closeReturnModal);

const RETURN_DEFAULT_MSG = 'Please enter the employee number of the person-in-charge.';

function closeReturnModal() {
  document.getElementById('modal-return').style.display = 'none';
}

function resetReturnForm() {
  document.getElementById('return-error').textContent = '';
  document.getElementById('return-serial').value = '';
  document.getElementById('return-datetime').value = '';
  document.getElementById('return-text-display').textContent = RETURN_DEFAULT_MSG;
  document.getElementById('return-pic').value = '';
  document.getElementById('return-pic').readOnly = true;
}

function openReturnModal() {
  document.getElementById('user-menu-dropdown').classList.remove('open');
  resetReturnForm();
  document.getElementById('modal-return').style.display = 'flex';
  document.getElementById('return-serial').focus();
}

function formatReturnDate(v) {
  if (!v) return '–';
  return String(v).replace('T', ' ').slice(0, 19);
}

// ── SERIAL SCAN ────────────────────────────────────────────────────────────────
document.getElementById('return-serial').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); scanReturnSerial(); }
});
document.getElementById('return-serial').addEventListener('blur', scanReturnSerial);

async function scanReturnSerial() {
  const err    = document.getElementById('return-error');
  const serial = document.getElementById('return-serial').value.trim();
  err.textContent = '';
  if (!serial) return;

  try {
    const res  = await fetch('/api/return/lookup/' + encodeURIComponent(serial));
    const json = await res.json();
    if (!json.ok) {
      document.getElementById('return-text-display').textContent = 'Serial number not found.';
      document.getElementById('return-datetime').value = '';
      err.textContent = json.error || 'Serial number not found.';
      return;
    }
    const r = json.row;
    document.getElementById('return-datetime').value = formatReturnDate(r.repaired_datetime || r.faendorse_datetime);
    document.getElementById('return-text-display').textContent =
`REPAIR SUMMARY:

Failure Cause: ${r.failure_cause || '–'}
Affected Component: ${r.affected_comp || '–'}
Action Taken: ${r.action_taken || '–'}
Repairer: ${r.repairer || '–'}
Repaired Date: ${formatReturnDate(r.repaired_datetime)}`;

    document.getElementById('return-pic').value = r.repairer || '';
  } catch (e) {
    err.textContent = 'Could not reach server: ' + e.message;
  }
}

// ── PERSON-IN-CHARGE "Change" toggle ──────────────────────────────────────────
document.getElementById('btn-return-pic-change').addEventListener('click', () => {
  const inp = document.getElementById('return-pic');
  inp.readOnly = !inp.readOnly;
  if (!inp.readOnly) inp.focus();
  document.getElementById('return-text-display').textContent = inp.readOnly
    ? RETURN_DEFAULT_MSG
    : 'Enter the employee number of the person returning this unit.';
});

// ── SUBMIT ────────────────────────────────────────────────────────────────────
document.getElementById('btn-return-submit').addEventListener('click', async () => {
  const err = document.getElementById('return-error');
  err.textContent = '';

  const serial   = document.getElementById('return-serial').value.trim();
  const returner = document.getElementById('return-pic').value.trim();

  if (!serial)   { err.textContent = 'Please scan a valid serial number.'; return; }
  if (!returner) { err.textContent = 'Please enter the employee number of the person-in-charge.'; return; }

  const payload = { serial_num: serial, returner: returner };

  const res  = await fetch('/api/return/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (json.ok) {
    closeReturnModal();
    if (typeof loadAndRender === 'function') loadAndRender();
  } else {
    err.textContent = json.error || 'Failed to return unit.';
  }
});