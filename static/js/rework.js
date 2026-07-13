// rework.js
// ── REWORK MODAL ──────────────────────────────────────────────────────────────
document.getElementById('btn-rework').addEventListener('click', openReworkModal);
document.getElementById('btn-rework-close').addEventListener('click', closeReworkModal);
document.getElementById('btn-rework-exit').addEventListener('click', closeReworkModal);

const REWORK_DEFAULT_MSG = 'Please enter the employee number of the reworker.';

function closeReworkModal() {
  document.getElementById('modal-rework').style.display = 'none';
}

function resetReworkForm() {
  document.getElementById('rework-error').textContent = '';
  document.getElementById('rework-serial').value = '';
  document.getElementById('rework-datetime').value = '';
  document.getElementById('rework-text-display').textContent = REWORK_DEFAULT_MSG;
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
    const res  = await fetch('/api/rework/options');
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

async function scanReworkSerial() {
  const err    = document.getElementById('rework-error');
  const serial = document.getElementById('rework-serial').value.trim();
  err.textContent = '';
  if (!serial) return;

  try {
    const res  = await fetch('/api/rework/lookup/' + encodeURIComponent(serial));
    const json = await res.json();
    if (!json.ok) {
      document.getElementById('rework-text-display').textContent = 'Serial number not found.';
      document.getElementById('rework-datetime').value = '';
      err.textContent = json.error || 'Serial number not found.';
      return;
    }
    const r = json.row;
    document.getElementById('rework-datetime').value = formatReworkDate(r.faendorse_datetime);
    document.getElementById('rework-text-display').textContent =
`FA FINDINGS:

Failure Cause: ${r.failure_cause || '–'}
Affected Component: ${r.affected_comp || '–'}
Proposed Action: ${r.proposed_action || '–'}
Defect Category: ${r.defect_cat || '–'}
FA Class: ${r.fa_class || '–'}
FA PIC: ${r.fa_pic || '–'}`;

    document.getElementById('rework-pic').value = r.repairer || '';
    ensureReworkOption('rework-action-taken', r.action_taken);
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

// ── SUBMIT ────────────────────────────────────────────────────────────────────
document.getElementById('btn-rework-submit').addEventListener('click', async () => {
  const err = document.getElementById('rework-error');
  err.textContent = '';

  const serial      = document.getElementById('rework-serial').value.trim();
  const reworker     = document.getElementById('rework-pic').value.trim();
  const actionTaken = document.getElementById('rework-action-taken').value;

  if (!serial)      { err.textContent = 'Please scan a valid serial number.'; return; }
  if (!reworker)     { err.textContent = 'Please enter the employee number of the reworker.'; return; }
  if (!actionTaken) { err.textContent = 'Please select an action taken.'; return; }

  const payload = { serial_num: serial, reworker: reworker, action_taken: actionTaken };

  const res  = await fetch('/api/rework/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (json.ok) {
    closeReworkModal();
    if (typeof loadAndRender === 'function') loadAndRender();
  } else {
    err.textContent = json.error || 'Failed to update repair status.';
  }
});