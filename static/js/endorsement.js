// endorsement.js
// ── ENDORSEMENT MODAL ─────────────────────────────────────────────────────────
// NOTE: all top-level names in this file are prefixed/unique so they can't
// collide with the identically-shaped Failure Analysis modal in fa_page.js.
// (Two <script> tags declaring the same top-level `const` throws a
// SyntaxError and silently kills whichever script loads second — that was
// the original bug that made this modal not save anything.)
//
// Product / Model are cascading selects backed by active_customer.py
// (ActiveProjects) via /api/endorsement/products, /api/endorsement/models.
// Station is a free-text input (editable, per request) with a <datalist>
// of suggestions from /api/endorsement/stations for convenience.
//
// Scanning a serial does two lookups in order:
//   1. /api/endorsement/lookup/<serial>      — is it already in fa.main_copy?
//   2. /api/endorsement/station_log/<serial> — if not, search the production
//      station logs (StationLog) for its most recent entry, to auto-fill
//      Product/Model/Station and remarks (-> test_failure).

document.getElementById('btn-endorsement').addEventListener('click', openEndorsementModal);
document.getElementById('btn-endorsement-close').addEventListener('click', closeEndorsementModal);
document.getElementById('btn-endorsement-exit').addEventListener('click', closeEndorsementModal);

function closeEndorsementModal() {
  document.getElementById('modal-endorsement').style.display = 'none';
}

function resetEndorsementForm() {
  document.getElementById('endorsement-error').textContent = '';
  document.getElementById('endorsement-serial').value = '';
  document.getElementById('endorsement-station').value = '';
  document.getElementById('endorsement-station-list').innerHTML = '';
  document.getElementById('endorsement-failure-mode').value = '';
  document.getElementById('endorsement-po').value = '';
  document.getElementById('endorsement-text-display').textContent =
    'Please enter the employee number of the endorser.';

  const endorserInput = document.getElementById('endorsement-endorser');
  endorserInput.value = localStorage.getItem('fa_user_num') || '';
  endorserInput.readOnly = true;

  resetEndorsementSelect('endorsement-product', 'Select…', true);
  resetEndorsementSelect('endorsement-model', 'Select a product first…', true);
}

function resetEndorsementSelect(id, placeholder, disabled) {
  const sel = document.getElementById(id);
  sel.innerHTML = '';
  sel.add(new Option(placeholder, ''));
  sel.disabled = disabled;
}

async function openEndorsementModal() {
  document.getElementById('user-menu-dropdown').classList.remove('open');
  resetEndorsementForm();
  document.getElementById('modal-endorsement').style.display = 'flex';
  await loadEndorsementProducts();
  document.getElementById('endorsement-serial').focus();
}

// ── CASCADING PRODUCT → MODEL, + STATION SUGGESTIONS ──────────────────────────
async function loadEndorsementProducts() {
  try {
    const res  = await fetch('/api/endorsement/products');
    const json = await res.json();
    if (json.ok) fillEndorsementSelect('endorsement-product', json.products);
  } catch (e) {
    // Non-fatal — user can retry by reopening the modal.
  }
}

async function loadEndorsementModels(productId) {
  resetEndorsementSelect('endorsement-model', 'Loading…', true);
  try {
    const res  = await fetch('/api/endorsement/models?product=' + encodeURIComponent(productId));
    const json = await res.json();
    resetEndorsementSelect('endorsement-model', 'Select…', true);
    if (json.ok) fillEndorsementSelect('endorsement-model', json.models);
  } catch (e) {
    resetEndorsementSelect('endorsement-model', 'Select…', true);
  }
}

// Station is free text now — this only refreshes the <datalist> of suggestions.
async function loadEndorsementStationSuggestions(productId, modelId) {
  const datalist = document.getElementById('endorsement-station-list');
  datalist.innerHTML = '';
  if (!productId || !modelId) return;
  try {
    const res  = await fetch(
      '/api/endorsement/stations?product=' + encodeURIComponent(productId) +
      '&model=' + encodeURIComponent(modelId)
    );
    const json = await res.json();
    if (json.ok) {
      (json.stations || []).forEach(s => {
        const opt = document.createElement('option');
        opt.value = (s && typeof s === 'object') ? s.id : s;
        datalist.appendChild(opt);
      });
    }
  } catch (e) {
    // Non-fatal — station stays freely typeable either way.
  }
}

document.getElementById('endorsement-product').addEventListener('change', async e => {
  const productId = e.target.value;
  document.getElementById('endorsement-station').value = '';
  document.getElementById('endorsement-station-list').innerHTML = '';
  if (!productId) {
    resetEndorsementSelect('endorsement-model', 'Select a product first…', true);
    return;
  }
  await loadEndorsementModels(productId);
});

document.getElementById('endorsement-model').addEventListener('change', async e => {
  const modelId   = e.target.value;
  const productId = document.getElementById('endorsement-product').value;
  document.getElementById('endorsement-station').value = '';
  await loadEndorsementStationSuggestions(productId, modelId);
});

// Accepts either plain strings or {id, name} objects (ActiveProjects returns the latter)
function fillEndorsementSelect(id, items) {
  const sel = document.getElementById(id);
  const current = sel.value;
  while (sel.options.length > 1) sel.remove(1);
  (items || []).forEach(item => {
    if (item && typeof item === 'object') {
      sel.add(new Option(item.name, item.id));
    } else {
      sel.add(new Option(item, item));
    }
  });
  if (current) sel.value = current;
}

// Ensure a value exists as an <option> even if it wasn't in the loaded list yet
function ensureEndorsementOption(selectId, value) {
  if (!value) return;
  const sel = document.getElementById(selectId);
  const exists = Array.from(sel.options).some(o => o.value === value);
  if (!exists) sel.add(new Option(value, value));
  sel.value = value;
}

function formatEndorsementDate(v) {
  if (!v) return '–';
  return String(v).replace('T', ' ').slice(0, 19);
}

// ── SERIAL SCAN ────────────────────────────────────────────────────────────────
document.getElementById('endorsement-serial').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); scanEndorsementSerial(); }
});
document.getElementById('endorsement-serial').addEventListener('blur', scanEndorsementSerial);

async function scanEndorsementSerial() {
  const err    = document.getElementById('endorsement-error');
  const serial = document.getElementById('endorsement-serial').value.trim();
  err.textContent = '';
  if (!serial) return;

  try {
    const res  = await fetch('/api/endorsement/lookup/' + encodeURIComponent(serial));
    const json = await res.json();
    if (!json.ok) {
      err.textContent = json.error || 'Could not look up serial number.';
      return;
    }

    if (json.found) {
      // Already in FA — show existing record, prefill for reference/re-endorse.
      const r = json.row;
      document.getElementById('endorsement-po').value = r.po_num || '';
      // document.getElementById('endorsement-failure-mode').value = r.test_failure || '';
      document.getElementById('endorsement-station').value = r.station || '';

      if (r.product) {
        ensureEndorsementOption('endorsement-product', r.product);
        document.getElementById('endorsement-product').value = r.product;
        await loadEndorsementModels(r.product);
        if (r.model) {
          ensureEndorsementOption('endorsement-model', r.model);
          document.getElementById('endorsement-model').value = r.model;
          await loadEndorsementStationSuggestions(r.product, r.model);
        }
      }

      document.getElementById('endorsement-text-display').textContent =
`SERIAL ALREADY REGISTERED:

Product: ${r.product || '–'}
Model: ${r.model || '–'}
Station: ${r.station || '–'}
PO: ${r.po_num || '–'}
Last Endorsed By: ${r.prod_endorser || '–'}
Endorsement Date & Time: ${formatEndorsementDate(r.faendorse_datetime)}
FA Status: ${typeof statusLabel === 'function' ? statusLabel(r.farepair_status) : r.farepair_status}

You can review/update the details (Station is editable) and endorse again.`;
      return;
    }

    // Not yet in FA — autosearch the production/test station logs for its
    // last entry, to auto-fill Product/Model/Station + remarks.
    document.getElementById('endorsement-text-display').textContent = 'Searching station logs…';

    const logRes  = await fetch('/api/endorsement/station_log/' + encodeURIComponent(serial));
    const logJson = await logRes.json();

    if (!logJson.ok) {
      document.getElementById('endorsement-text-display').textContent =
        'New serial number. Could not search station logs: ' + (logJson.error || 'unknown error') +
        '\nFill in the details below and press "Endorse to FA".';
      return;
    }

    if (!logJson.found) {
      document.getElementById('endorsement-text-display').textContent =
        'New serial number — no station log found either.\nFill in the details below and press "Endorse to FA".';
      return;
    }

    const log = logJson.log;
    document.getElementById('endorsement-station').value = log.station || '';
    document.getElementById('endorsement-failure-mode').value = log.remarks || '';

    if (log.product) {
      ensureEndorsementOption('endorsement-product', log.product);
      document.getElementById('endorsement-product').value = log.product;
      await loadEndorsementModels(log.product);
      if (log.model) {
        ensureEndorsementOption('endorsement-model', log.model);
        document.getElementById('endorsement-model').value = log.model;
        await loadEndorsementStationSuggestions(log.product, log.model);
      }
    }

    document.getElementById('endorsement-text-display').textContent =
`LAST STATION LOG FOUND:

Product: ${log.product || '–'}
Model: ${log.model || '–'}
Station: ${log.station || '–'}
Log Date & Time: ${formatEndorsementDate(log.log_datetime)}
Remarks: ${log.remarks || '–'}

Review the details (Station is editable) and press "Endorse to FA".`;
  } catch (e) {
    err.textContent = 'Could not reach server: ' + e.message;
  }
}

// ── ENDORSER "Change" toggle ─────────────────────────────────────────────────
document.getElementById('btn-endorsement-endorser-change').addEventListener('click', () => {
  const inp = document.getElementById('endorsement-endorser');
  inp.readOnly = !inp.readOnly;
  if (!inp.readOnly) inp.focus();
});

// ── SUBMIT ────────────────────────────────────────────────────────────────────
document.getElementById('btn-endorsement-submit').addEventListener('click', async () => {
  const err = document.getElementById('endorsement-error');
  err.textContent = '';

  const serial   = document.getElementById('endorsement-serial').value.trim();
  const product  = document.getElementById('endorsement-product').value;
  const model    = document.getElementById('endorsement-model').value;
  const station  = document.getElementById('endorsement-station').value.trim();
  const endorser = document.getElementById('endorsement-endorser').value.trim();
  const failMode = document.getElementById('endorsement-failure-mode').value.trim();

  if (!serial)   { err.textContent = 'Please scan or type a serial number.'; return; }
  if (!product)  { err.textContent = 'Please select a product.'; return; }
  if (!model)    { err.textContent = 'Please select a model.'; return; }
  if (!station)  { err.textContent = 'Please enter a station.'; return; }
  if (!endorser) { err.textContent = 'Please enter the employee number of the endorser.'; return; }
  if (!failMode) { err.textContent = 'Please describe the failure mode.'; return; }

  const payload = {
    serial_num:    serial,
    product,
    model,
    station,
    po_num:        document.getElementById('endorsement-po').value.trim(),
    test_failure:  failMode,
    prod_endorser: endorser,
  };

  const res  = await fetch('/api/endorsement/update', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (json.ok) {
    closeEndorsementModal();
    if (typeof loadAndRender === 'function') loadAndRender(); // refresh table/charts
  } else {
    err.textContent = json.error || 'Failed to endorse to FA.';
  }
});