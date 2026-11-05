// rework.js
// ── REWORK MODAL ──────────────────────────────────────────────────────────────
document.getElementById('btn-rework').addEventListener('click', openReworkModal);
document.getElementById('btn-rework-close').addEventListener('click', closeReworkModal);
document.getElementById('btn-rework-exit').addEventListener('click', closeReworkModal);

const REWORK_DEFAULT_MSG = 'Please enter the employee number of the reworker.';
let reworkRetained = { reworker: false, actionTaken: false };
let reworkScannedSerial = '';
let reworkAlreadySubmitted = false;

function closeReworkModal() {
  document.getElementById('modal-rework').style.display = 'none';
}

function clearReworkSerial() {
  document.getElementById('rework-error').textContent = '';
  document.getElementById('rework-serial').value = '';
  document.getElementById('rework-datetime').value = '';
  document.getElementById('rework-text-display').textContent = REWORK_DEFAULT_MSG;
}

function resetReworkForm() {
  clearReworkSerial();
  reworkScannedSerial = '';
  reworkAlreadySubmitted = false;
  reworkRetained = { reworker: false, actionTaken: false };
  document.getElementById('rework-action-taken').value = '';
  document.getElementById('rework-pic').value = '';
  document.getElementById('rework-pic').readOnly = true;
}

async function openReworkModal() {
  document.getElementById('user-menu-dropdown').classList.remove('open');
  resetReworkForm();
  document.getElementById('modal-rework').style.display = 'flex';
  await loadReworkOptions();
  document.getElementById('rework-serial').focus();
}

async function loadReworkOptions() {
  try {
    const res  = await fetch(APP_ROOT + '/api/rework/options');
    const json = await res.json();
    if (json.ok) fillReworkSelect('rework-action-taken', json.action_taken);
  } catch (e) {
    // Non-fatal — dropdown just stays empty
  }
}

function fillReworkSelect(id, vals) {
  const sel = document.getElementById(id);
  const current = sel.value;
  while (sel.options.length > 1) sel.remove(1);
  vals.forEach(v => sel.add(new Option(v, v)));
  sel.value = current;
}

function ensureReworkOption(selectId, value) {
  if (!value) return;
  const sel = document.getElementById(selectId);
  const exists = Array.from(sel.options).some(o => o.value === value);
  if (!exists) sel.add(new Option(value, value));
  sel.value = value;
}

function formatReworkDate(v) {
  if (!v) return '–';
  return String(v).replace('T', ' ').slice(0, 19);
}

// ── SERIAL SCAN ────────────────────────────────────────────────────────────────
document.getElementById('rework-serial').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); scanReworkSerial(); }
});
document.getElementById('rework-serial').addEventListener('blur', scanReworkSerial);
document.getElementById('rework-serial').addEventListener('input', () => {
  reworkScannedSerial = '';
  reworkAlreadySubmitted = false;
});

async function scanReworkSerial() {
  const err    = document.getElementById('rework-error');
  const serial = document.getElementById('rework-serial').value.trim();
  err.textContent = '';
  if (!serial) return;
  if (reworkScannedSerial === serial) return;

  try {
    const res  = await fetch(APP_ROOT + '/api/rework/lookup/' + encodeURIComponent(serial));
    const json = await res.json();
    if (!json.ok) {
      document.getElementById('rework-text-display').textContent = 'Serial number not found.';
      document.getElementById('rework-datetime').value = '';
      err.textContent = json.error || 'Serial number not found.';
      return;
    }
    const r = json.row;
    reworkScannedSerial = serial;
    reworkAlreadySubmitted = Boolean(
      r.repaired_datetime || Number(r.farepair_status) >= 3
    );
    document.getElementById('rework-datetime').value = formatReworkDate(r.faendorse_datetime);
    const reworkStatus = Number(r.farepair_status);
    document.getElementById('rework-text-display').textContent = reworkStatus >= 3
      ? `This serial has already completed Rework. ${faWorkflowStageLabel(reworkStatus)}. Endorsement and Failure Analysis details are hidden.`
      : `${faWorkflowStageLabel(reworkStatus)}
    UUT DETAILS:
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
    FA PIC: ${r.fa_pic || '–'}`;

    if (!reworkRetained.reworker) {
      document.getElementById('rework-pic').value = r.repairer || '';
    }
    if (!reworkRetained.actionTaken) {
      ensureReworkOption('rework-action-taken', r.action_taken);
    }
  } catch (e) {
    err.textContent = 'Could not reach server: ' + e.message;
  }
}

// ── REWORKER "Change" toggle ──────────────────────────────────────────────────
document.getElementById('btn-rework-pic-change').addEventListener('click', () => {
  const inp = document.getElementById('rework-pic');
  inp.readOnly = !inp.readOnly;
  if (!inp.readOnly) inp.focus();
  document.getElementById('rework-text-display').textContent = inp.readOnly
    ? REWORK_DEFAULT_MSG
    : 'Enter the reworker\'s employee number, then select the action taken.';
});

document.getElementById('rework-pic').addEventListener('input', () => {
  reworkRetained.reworker = true;
});
document.getElementById('rework-action-taken').addEventListener('change', () => {
  reworkRetained.actionTaken = true;
});

// ── SUBMIT ────────────────────────────────────────────────────────────────────
document.getElementById('btn-rework-submit').addEventListener('click', async () => {
  const err = document.getElementById('rework-error');
  err.textContent = '';

  const serial      = document.getElementById('rework-serial').value.trim();
  if (serial && reworkScannedSerial !== serial) {
    await scanReworkSerial();
  }
  if (serial && reworkScannedSerial !== serial) {
    err.textContent = 'Could not verify this serial. Please scan it again before submitting.';
    return;
  }
  const reworker     = document.getElementById('rework-pic').value.trim();
  const actionTaken = document.getElementById('rework-action-taken').value;

  if (!serial)      { err.textContent = 'Please scan a valid serial number.'; return; }
  if (!reworker)     { err.textContent = 'Please enter the employee number of the reworker.'; return; }
  if (!actionTaken) { err.textContent = 'Please select an action taken.'; return; }
  if (reworkAlreadySubmitted &&
      !window.confirm(`Serial ${serial} has already been reworked. Do you want to update its rework details?`)) {
    clearReworkSerial();
    reworkScannedSerial = '';
    reworkAlreadySubmitted = false;
    err.textContent = 'Rework update canceled; no changes were made.';
    document.getElementById('rework-serial').focus();
    return;
  }

  const payload = { serial_num: serial, reworker: reworker, action_taken: actionTaken };

  const res  = await fetch(APP_ROOT + '/api/rework/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (json.ok) {
    if (typeof loadAndRender === 'function') loadAndRender();
    reworkRetained = { reworker: true, actionTaken: true };
    clearReworkSerial();
    reworkScannedSerial = '';
    reworkAlreadySubmitted = false;
    document.getElementById('rework-serial').focus();
  } else {
    err.textContent = json.error || 'Failed to update repair status.';
  }
});