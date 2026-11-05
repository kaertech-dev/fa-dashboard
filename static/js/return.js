// return.js
// ── RETURN MODAL ──────────────────────────────────────────────────────────────
document.getElementById('btn-return').addEventListener('click', openReturnModal);
document.getElementById('btn-return-close').addEventListener('click', closeReturnModal);
document.getElementById('btn-return-exit').addEventListener('click', closeReturnModal);

const RETURN_DEFAULT_MSG = 'Please enter the employee number of the person-in-charge.';
let returnPicRetained = false;
let returnScannedSerial = '';
let returnAlreadySubmitted = false;

function closeReturnModal() {
  document.getElementById('modal-return').style.display = 'none';
}

function clearReturnSerial() {
  document.getElementById('return-error').textContent = '';
  document.getElementById('return-serial').value = '';
  document.getElementById('return-datetime').value = '';
  document.getElementById('return-text-display').textContent = RETURN_DEFAULT_MSG;
}

function resetReturnForm() {
  clearReturnSerial();
  returnScannedSerial = '';
  returnAlreadySubmitted = false;
  returnPicRetained = false;
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
document.getElementById('return-serial').addEventListener('input', () => {
  returnScannedSerial = '';
  returnAlreadySubmitted = false;
});

async function scanReturnSerial() {
  const err    = document.getElementById('return-error');
  const serial = document.getElementById('return-serial').value.trim();
  err.textContent = '';
  if (!serial) return;
  if (returnScannedSerial === serial) return;

  try {
    const res  = await fetch(APP_ROOT + '/api/return/lookup/' + encodeURIComponent(serial));
    const json = await res.json();
    if (!json.ok) {
      document.getElementById('return-text-display').textContent = 'Serial number not found.';
      return;
    } else if (!json.row) {
      document.getElementById('return-datetime').value = '';
      err.textContent = json.error || 'Serial number not found.';
      return;
    }
    const r = json.row;
    returnScannedSerial = serial;
    returnAlreadySubmitted = Boolean(
      r.returned_datetime || Number(r.farepair_status) === 4
    );
    document.getElementById('return-datetime').value = formatReturnDate(r.repaired_datetime || r.faendorse_datetime);
    document.getElementById('return-text-display').textContent =
    `UUT DETAILS:
    Product: ${r.product || '–'}
    Model: ${r.model || '–'}
    PO: ${r.po_num || '–'}
    Station: ${r.station || '–'}
    Test Failure: ${r.test_failure || '–'}
    Endorsed By: ${r.prod_endorser || '–'}
    Endorsement Date & Time: ${formatReturnDate(r.faendorse_datetime)}

FA FINDINGS:
    Failure Cause: ${r.failure_cause || '–'}
    Affected Component: ${r.affected_comp || '–'}
    Proposed Action: ${r.proposed_action || '–'}
    Defect Category: ${r.defect_cat || '–'}
    FA Class: ${r.fa_class || '–'}
    FA PIC: ${r.fa_pic || '–'}

REPAIR SUMMARY:
    Action Taken: ${r.action_taken || '–'}
    Repairer: ${r.repairer || '–'}
    Repaired Date: ${formatReturnDate(r.repaired_datetime)}`;

    if (!returnPicRetained) {
      document.getElementById('return-pic').value = r.repairer || '';
    }
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

document.getElementById('return-pic').addEventListener('input', () => {
  returnPicRetained = true;
});

// ── SUBMIT ────────────────────────────────────────────────────────────────────
document.getElementById('btn-return-submit').addEventListener('click', async () => {
  const err = document.getElementById('return-error');
  err.textContent = '';

  const serial   = document.getElementById('return-serial').value.trim();
  if (serial && returnScannedSerial !== serial) {
    await scanReturnSerial();
  }
  if (serial && returnScannedSerial !== serial) {
    err.textContent = 'Could not verify this serial. Please scan it again before submitting.';
    return;
  }
  const returner = document.getElementById('return-pic').value.trim();

  if (!serial)   { err.textContent = 'Please scan a valid serial number.'; return; }
  if (!returner) { err.textContent = 'Please enter the employee number of the person-in-charge.'; return; }
  if (returnAlreadySubmitted &&
      !window.confirm(`Serial ${serial} has already been returned. Do you want to update its return details?`)) {
    clearReturnSerial();
    returnScannedSerial = '';
    returnAlreadySubmitted = false;
    err.textContent = 'Return update canceled; no changes were made.';
    document.getElementById('return-serial').focus();
    return;
  }

  const payload = { serial_num: serial, returner: returner };

  const res  = await fetch(APP_ROOT + '/api/return/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (json.ok) {
    if (typeof loadAndRender === 'function') loadAndRender();
    returnPicRetained = true;
    clearReturnSerial();
    returnScannedSerial = '';
    returnAlreadySubmitted = false;
    document.getElementById('return-serial').focus();
  } else {
    err.textContent = json.error || 'Failed to return unit.';
  }
});