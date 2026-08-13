// fa_dashboard.js
// ── STATE ─────────────────────────────────────────────────────────────────────
let allData = [], filteredData = [], page = 1;
const PAGE_SIZE = 50;
const COLORS = ['#f78166','#79c0ff','#56d364','#d29922','#bc8cff','#58a6ff','#ff7b72','#39d353','#ffa657','#a5d6ff'];

// ── UTILS ─────────────────────────────────────────────────────────────────────
const loader = on => document.getElementById('loader').classList.toggle('on', on);
function escapeHtml(v) {
  if (v == null || v === '') return '–';

  return String(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const fmt = escapeHtml;

function statusLabel(v) {
  if (v == 1) return 'OPEN';
  if (v == 2) return 'WIP';
  if (v == 4) return 'CLOSED';
  return '';
}
function statusTag(v) {
  if (v == 1) return `<span class="tag tag-open">OPEN</span>`;
  if (v == 2) return `<span class="tag tag-wip">WIP</span>`;
  if (v == 4) return `<span class="tag tag-closed">CLOSED</span>`;
  return `<span class="tag" style="opacity:.4">–</span>`;
}

// ── USER MENU DROPDOWN ────────────────────────────────────────────────────────
document.getElementById('user-menu-btn').addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('user-menu-dropdown').classList.toggle('open');
});
document.addEventListener('click', () => {
  document.getElementById('user-menu-dropdown').classList.remove('open');
});

// ── GROUP-BASED NAV ACCESS ─────────────────────────────────────────────────────
// Access is driven entirely by the group assigned to the employee in the
// database (userv2.user_group) — there is no manual switcher.
// FA      → only Endorsement + Failure Analysis are shown
// PROCESS → only Rework + Return are shown
// ADMIN   → everything is shown
const VALID_GROUPS = ['FA', 'PROCESS', 'ADMIN'];

function applyGroupAccess(group) {
  const normalized = (group || '').trim().toUpperCase();
  const show = VALID_GROUPS.includes(normalized);
  if (!show) {
    console.warn(
      `[FA Dashboard] Unrecognized group "${group}" — hiding all group-restricted menu items ` +
      `(Endorsement, Failure Analysis, Rework, Return) because it doesn't match FA/PROCESS/ADMIN. ` +
      `Check the value of userv2.user_group for this account, and that functions.py's authenticate() ` +
      `is reading the right column.`
    );
  }
  document.querySelectorAll('[data-group]').forEach(el => {
    // Fail closed on an unknown/missing group instead of showing everything.
    el.style.display = (show && (normalized === 'ADMIN' || el.dataset.group === normalized)) ? '' : 'none';
  });
}

// ── LOGIN ─────────────────────────────────────────────────────────────────────
document.getElementById('btn-login').addEventListener('click', doLogin);
document.getElementById('inp-pass').addEventListener('keydown', e => { if (e.key==='Enter') doLogin(); });

async function doLogin() {
  const u   = document.getElementById('inp-user').value.trim();
  const p   = document.getElementById('inp-pass').value.trim();
  const err = document.getElementById('login-error');
  err.textContent = '';
  if (!u || !p) { err.textContent = 'Please enter Employee No. and badge.'; return; }

  loader(true);
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        employee_num: u,
        badge: p
      })
    });

    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status}`);
    }

    const json = await res.json();
    if (json.ok) {
      const name  = json.user.employee_name || json.user.employee_num;
      const group = json.user.group || '';
      document.getElementById('user-label').textContent = name;
      localStorage.setItem('fa_user', name);
      localStorage.setItem('fa_user_num', json.user.employee_num || '');
      localStorage.setItem('fa_group', group);
      applyGroupAccess(group);
      document.getElementById('login-screen').style.display  = 'none';
      document.getElementById('dashboard-screen').style.display = 'block';
      await loadAndRender();
    } else {
      err.textContent = json.error || 'Login failed.';
    }
  } catch(e) {
    err.textContent = 'Could not reach server: ' + e.message;
  } finally {
    loader(false);
  }
}

// ── LOGOUT ────────────────────────────────────────────────────────────────────
document.getElementById('btn-logout').addEventListener('click', () => {
  allData = []; filteredData = [];
  localStorage.removeItem('fa_user');
  localStorage.removeItem('fa_user_num');
  localStorage.removeItem('fa_group');
  document.getElementById('inp-pass').value = '';
  document.getElementById('login-error').textContent = '';
  document.getElementById('user-menu-dropdown').classList.remove('open');
  document.getElementById('dashboard-screen').style.display = 'none';
  document.getElementById('login-screen').style.display     = 'flex';
});

// ── RESTORE LOGIN AFTER PAGE REFRESH ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
    const savedUser  = localStorage.getItem('fa_user');
    const savedGroup = localStorage.getItem('fa_group') || '';

    if (savedUser) {
        document.getElementById('user-label').textContent = savedUser;
        applyGroupAccess(savedGroup);
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('dashboard-screen').style.display = 'block';

        await loadAndRender();
    }
});

// ── CHANGE PASSWORD MODAL ─────────────────────────────────────────────────────
document.getElementById('btn-change-pass').addEventListener('click', () => {
  document.getElementById('modal-chpass').style.display = 'flex';
  document.getElementById('user-menu-dropdown').classList.remove('open');
});
document.getElementById('btn-chpass-close').addEventListener('click', () => {
  document.getElementById('modal-chpass').style.display = 'none';
});

document.getElementById('btn-chpass-submit').addEventListener('click', async () => {
  const cur  = document.getElementById('chpass-current').value.trim();
  const nw   = document.getElementById('chpass-new').value.trim();
  const conf = document.getElementById('chpass-confirm').value.trim();
  const err  = document.getElementById('chpass-error');

  err.textContent = '';

  if (!cur || !nw || !conf) {
    err.textContent = 'All fields are required.';
    return;
  }

  if (nw !== conf) {
    err.textContent = 'New badges do not match.';
    return;
  }

  try {
    const res = await fetch('/api/change_password', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        current_badge: cur,
        new_badge: nw
      })
    });

    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status}`);
    }

    const json = await res.json();

    if (json.ok) {
      document.getElementById('modal-chpass').style.display = 'none';

      [
        'chpass-current',
        'chpass-new',
        'chpass-confirm'
      ].forEach(id => {
        document.getElementById(id).value = '';
      });

    } else {
      err.textContent = json.error || 'Failed to update badge.';
    }

  } catch (e) {
    console.error('[FA Dashboard] Password change failed:', e);
    err.textContent = 'Could not update badge: ' + e.message;
  }
});

// ── DATA ──────────────────────────────────────────────────────────────────────
async function loadAndRender() {
  loader(true);

  try {
    const res = await fetch('/api/data');

    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status}`);
    }

    const json = await res.json();

    if (!json.ok) {
      throw new Error(json.error || 'Failed to load data.');
    }

    allData = Array.isArray(json.rows) ? json.rows : [];

    // Always return to page 1 after loading new data
    page = 1;

    populateFilters();
    applyFilters();

  } catch (e) {
    console.error('[FA Dashboard] Data load failed:', e);
    alert('Could not load dashboard data: ' + e.message);

  } finally {
    loader(false);
  }
}
// ── FILTERS ───────────────────────────────────────────────────────────────────
function populateFilters() {
  fillSelect('f-product', [...new Set(allData.map(r=>r.product).filter(Boolean))].sort());
  fillSelect('f-model',   [...new Set(allData.map(r=>r.model).filter(Boolean))].sort());
  fillSelect('f-station', [...new Set(allData.map(r=>r.station).filter(Boolean))].sort());
}

function fillSelect(id, vals) {
  const sel = document.getElementById(id);
  while (sel.options.length > 1) sel.remove(1);
  vals.forEach(v => sel.add(new Option(v, v)));
}

document.getElementById('btn-apply').addEventListener('click',  () => { page=1; applyFilters(); });
document.getElementById('btn-reset').addEventListener('click',  () => {
  ['f-product','f-model','f-station','f-status'].forEach(id => document.getElementById(id).value='');
  document.getElementById('f-from').value = '';
  document.getElementById('f-to').value   = '';
  page=1; applyFilters();
});

function applyFilters() {
  const prod   = document.getElementById('f-product').value;
  const model  = document.getElementById('f-model').value;
  const sta    = document.getElementById('f-station').value;
  const status = document.getElementById('f-status').value;
  const from   = document.getElementById('f-from').value;
  const to     = document.getElementById('f-to').value;

  filteredData = allData.filter(r => {
    if (prod   && r.product  !== prod)   return false;
    if (model  && r.model    !== model)  return false;
    if (sta    && r.station  !== sta)    return false;
    if (status && String(r.farepair_status) !== status) return false;
    if (from) {
      if (!r.faendorse_datetime ||
          String(r.faendorse_datetime).slice(0, 10) < from) {
        return false;
      }
    }

    if (to) {
      if (!r.faendorse_datetime ||
          String(r.faendorse_datetime).slice(0, 10) > to) {
        return false;
      }
    }
    return true;
  });
  renderKPIs(); renderCharts(); renderTable();
}

// ── KPIs ──────────────────────────────────────────────────────────────────────
function renderKPIs() {
  document.getElementById('kpi-total').textContent    = filteredData.length.toLocaleString();
  document.getElementById('kpi-open').textContent     = filteredData.filter(r=>r.farepair_status==1).length.toLocaleString();
  document.getElementById('kpi-wip').textContent      = filteredData.filter(r=>r.farepair_status==2).length.toLocaleString();
  document.getElementById('kpi-closed').textContent   = filteredData.filter(r=>r.farepair_status==4).length.toLocaleString();
  document.getElementById('kpi-products').textContent = new Set(filteredData.map(r=>r.product).filter(Boolean)).size;
}
// ── KPI CARD CLICK-TO-FILTER ───────────────────────────────────────────────
document.querySelectorAll('.kpi-clickable').forEach(card => {
  card.addEventListener('click', () => {
    const status = card.dataset.status;
    const sel = document.getElementById('f-status');
    const alreadyActive = card.classList.contains('active');

    document.querySelectorAll('.kpi-clickable').forEach(c => c.classList.remove('active'));

    // Clicking an already-active card clears the filter (toggle behavior)
    sel.value = alreadyActive ? '' : status;
    if (!alreadyActive) card.classList.add('active');

    page = 1;
    applyFilters();
    // Float/pop animation on the clicked card itself — no auto-scroll.
    card.classList.remove('kpi-floating');
    void card.offsetWidth; // force reflow so rapid re-clicks restart the animation
    card.classList.add('kpi-floating');
    card.addEventListener('animationend', () => card.classList.remove('kpi-floating'), { once: true });

    // If the card was just activated, open the list modal showing all matching
    // records so the user can see a summary instead of a single record.
    if (!alreadyActive) {
      setTimeout(() => showFailureList(String(status)), 120);
    }
  });
});

// ── CHARTS (pure Canvas) ──────────────────────────────────────────────────────
function countBy(arr, key) {
  const map = {};
  arr.forEach(r => { const v = r[key]||'Unknown'; map[v]=(map[v]||0)+1; });
  return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,12);
}

function drawBarChart(canvasId, entries, options = {}) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const dpr    = window.devicePixelRatio || 1;
  const W      = canvas.parentElement.clientWidth - 44;
  const H      = options.height || 220;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  if (!entries.length) {
    ctx.fillStyle = '#6b7280';
    ctx.font = '13px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data', W/2, H/2);
    return;
  }

  const PAD_L=48, PAD_R=12, PAD_T=14, PAD_B=56;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const maxVal = Math.max(...entries.map(e=>e[1]));
  const barW   = Math.max(8, (chartW / entries.length) - 6);
  const gap    = (chartW - barW * entries.length) / (entries.length + 1);

  // Grid lines + y labels
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const y = PAD_T + chartH - (chartH * i / steps);
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(PAD_L + chartW, y); ctx.stroke();
    ctx.fillStyle = '#6b7280'; ctx.font = '10px Segoe UI, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(Math.round(maxVal * i / steps), PAD_L - 5, y + 4);
  }

  // Bars
  entries.forEach(([label, val], i) => {
    const x  = PAD_L + gap + i * (barW + gap);
    const bH = (val / maxVal) * chartH;
    const y  = PAD_T + chartH - bH;
    const c  = options.singleColor || COLORS[i % COLORS.length];

    ctx.fillStyle = c + '33';
    const r = 3;
    ctx.beginPath();
    ctx.moveTo(x+r, y); ctx.lineTo(x+barW-r, y);
    ctx.quadraticCurveTo(x+barW, y, x+barW, y+r);
    ctx.lineTo(x+barW, y+bH); ctx.lineTo(x, y+bH); ctx.lineTo(x, y+r);
    ctx.quadraticCurveTo(x, y, x+r, y);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.stroke();

    // Value on top
    ctx.fillStyle = '#111827'; ctx.font = 'bold 10px Segoe UI, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(val, x + barW/2, y - 4);

    // X label rotated
    const lbl = label.length > 10 ? label.slice(0,9)+'…' : label;
    ctx.save();
    ctx.translate(x + barW/2, PAD_T + chartH + 8);
    ctx.rotate(-0.48);
    ctx.fillStyle = '#6b7280'; ctx.font = '10px Segoe UI, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(lbl, 0, 0);
    ctx.restore();
  });
}

// Horizontal bar chart — better for many categories with long names
function drawHBarChart(canvasId, entries) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.parentElement.clientWidth - 44;
  // Height scales with number of entries so bars aren't squished
  const H   = Math.max(220, entries.length * 36 + 40);
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width  = W + 'px';
  canvas.style.height = H + 'px';

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  if (!entries.length) {
    ctx.fillStyle = '#6b7280';
    ctx.font = '13px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No data', W/2, H/2);
    return;
  }

  const PAD_L = 140, PAD_R = 48, PAD_T = 14, PAD_B = 14;
  const chartW = W - PAD_L - PAD_R;
  const chartH = H - PAD_T - PAD_B;
  const maxVal = entries[0][1]; // already sorted desc
  const rowH   = chartH / entries.length;
  const barH   = Math.min(rowH * 0.55, 28);

  // Vertical grid lines
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const x = PAD_L + (chartW * i / steps);
    ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, PAD_T); ctx.lineTo(x, H - PAD_B); ctx.stroke();
    ctx.fillStyle = '#6b7280'; ctx.font = '10px Segoe UI, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(Math.round(maxVal * i / steps), x, H - PAD_B + 14);
  }

  // Bars + labels
  entries.forEach(([label, val], i) => {
    const y   = PAD_T + i * rowH + (rowH - barH) / 2;
    const bW  = (val / maxVal) * chartW;
    const c   = COLORS[i % COLORS.length];

    // Category label (left side)
    const lbl = label.length > 18 ? label.slice(0,17)+'…' : label;
    ctx.fillStyle = '#374151'; ctx.font = '11px Segoe UI, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(lbl, PAD_L - 8, y + barH / 2 + 4);

    // Bar fill
    ctx.fillStyle = c + '33';
    const r = 3;
    if (bW > r * 2) {
      ctx.beginPath();
      ctx.moveTo(PAD_L, y + r); ctx.lineTo(PAD_L, y + barH - r);
      ctx.quadraticCurveTo(PAD_L, y + barH, PAD_L + r, y + barH);
      ctx.lineTo(PAD_L + bW - r, y + barH);
      ctx.quadraticCurveTo(PAD_L + bW, y + barH, PAD_L + bW, y + barH - r);
      ctx.lineTo(PAD_L + bW, y + r);
      ctx.quadraticCurveTo(PAD_L + bW, y, PAD_L + bW - r, y);
      ctx.lineTo(PAD_L + r, y); ctx.quadraticCurveTo(PAD_L, y, PAD_L, y + r);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = c; ctx.lineWidth = 1.5; ctx.stroke();
    }

    // Value label (right of bar)
    ctx.fillStyle = '#111827'; ctx.font = 'bold 11px Segoe UI, sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(val, PAD_L + bW + 6, y + barH / 2 + 4);
  });
}

function renderCharts() {
  drawBarChart('chart-product', countBy(filteredData, 'product'));
  drawBarChart('chart-station', countBy(filteredData, 'station'));
  drawHBarChart('chart-defect-cat', countBy(filteredData, 'defect_cat'));
}

// ── TABLE ─────────────────────────────────────────────────────────────────────
document.getElementById('btn-prev').addEventListener('click', () => { if(page>1){page--;renderTable();} });
document.getElementById('btn-next').addEventListener('click', () => { if(page*PAGE_SIZE<filteredData.length){page++;renderTable();} });

function renderTable() {
  const start = (page-1)*PAGE_SIZE;
  const slice = filteredData.slice(start, start+PAGE_SIZE);
  const dateCol = v => v ? `<span style="color:var(--muted)">${escapeHtml(String(v).slice(0,10))}</span>` : '–';
  document.getElementById('table-body').innerHTML = slice.map((r,i) => `
    <tr data-record-index="${start + i}" title="Click to view failure details">
      <td style="color:var(--muted)">${start+i+1}</td>
      <td style="font-family:monospace;color:var(--accent3)">${fmt(r.serial_num)}</td>
      <td>${fmt(r.product)}</td>
      <td>${fmt(r.model)}</td>
      <td>${fmt(r.po_num)}</td>
      <td>${fmt(r.station)}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${fmt(r.test_failure)}</td>
      <td>${fmt(r.prod_endorser)}</td>
      <td>${dateCol(r.faendorse_datetime)}</td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${fmt(r.failure_cause)}</td>
      <td>${fmt(r.affected_comp)}</td>
      <td>${fmt(r.defect_cat)}</td>
      <td>${fmt(r.fa_pic)}</td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${fmt(r.proposed_action)}</td>
      <td>${fmt(r.fa_class)}</td>
      <td>${fmt(r.fa_case)}</td>
      <td>${dateCol(r.faended_datetime)}</td>
      <td>${fmt(r.repairer)}</td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${fmt(r.action_taken)}</td>
      <td>${dateCol(r.repaired_datetime)}</td>
      <td>${dateCol(r.returned_datetime)}</td>
      <td>${statusTag(r.farepair_status)}</td>
    </tr>`).join('');
  // Make each rendered failure record clickable
  document.querySelectorAll('#table-body tr').forEach(row => {
    row.addEventListener('click', () => {
      const index = Number(row.dataset.recordIndex);
      const record = filteredData[index];

      if (record) {
        showFailureRecord(record);
      }
    });
  });
  const total = filteredData.length;
  const end   = Math.min(start+PAGE_SIZE, total);
  document.getElementById('page-info').textContent = total
    ? `${start+1}–${end} of ${total.toLocaleString()} records`
    : 'No records';
  document.getElementById('btn-prev').disabled = page === 1;
  document.getElementById('btn-next').disabled = end >= total;
}
// ── FAILURE RECORD DETAIL MODAL ───────────────────────────────────────────────

const failureDetailModal = document.getElementById('modal-failure-record');

// Failure list modal (summary of matching records)
const failureListModal = document.getElementById('modal-failure-list');

function showFailureList(status) {
  if (!failureListModal) return;

  const titleMap = { '1': 'Open FA', '2': 'In Progress', '4': 'Closed' };
  const subtitle = document.getElementById('failure-list-subtitle');
  const countEl  = document.getElementById('failure-list-count');
  const body     = document.getElementById('failure-list-body');

  const matches = filteredData.filter(r => String(r.farepair_status) === String(status));

  subtitle.textContent = titleMap[status] ? `${titleMap[status]} — matching records` : 'Matching records';
  countEl.textContent  = matches.length ? `${matches.length.toLocaleString()} records` : '';

  if (!matches.length) {
    body.innerHTML = `<tr><td colspan="7" style="padding:18px;color:var(--muted)">No matching records</td></tr>`;
  } else {
    body.innerHTML = matches.map((r, i) => `
      <tr class="failure-list-row" data-serial="${escapeHtml(r.serial_num)}" style="cursor:pointer">
        <td style="padding:8px;color:var(--muted)">${i+1}</td>
        <td style="padding:8px;font-family:monospace;color:var(--accent3)">${fmt(r.serial_num)}</td>
        <td style="padding:8px">${fmt(r.product)}</td>
        <td style="padding:8px">${fmt(r.model)}</td>
        <td style="padding:8px">${fmt(r.station)}</td>
        <td style="padding:8px">${statusLabel(r.farepair_status)}</td>
        <td style="padding:8px;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${fmt(r.test_failure)}</td>
      </tr>
    `).join('');

    // Attach click handlers to open the detail modal for a selected row
    Array.from(body.querySelectorAll('.failure-list-row')).forEach(row => {
      row.addEventListener('click', () => {
        const serial = row.dataset.serial;
        const record = filteredData.find(rr => String(rr.serial_num) === String(serial));
        if (record) showFailureRecord(record);
      });
    });
  }

  failureListModal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closeFailureListModal() {
  if (!failureListModal) return;
  failureListModal.style.display = 'none';
  document.body.style.overflow = '';
}

// Close buttons for failure list modal
const btnFailureListClose = document.getElementById('btn-failure-list-close');
if (btnFailureListClose) btnFailureListClose.addEventListener('click', closeFailureListModal);
const btnFailureListExit = document.getElementById('btn-failure-list-exit');
if (btnFailureListExit) btnFailureListExit.addEventListener('click', closeFailureListModal);

// Click outside modal to close
if (failureListModal) {
  failureListModal.addEventListener('click', e => {
    if (e.target === failureListModal) closeFailureListModal();
  });
}

function failureDetailFmt(value) {
  if (value == null || value === '') return '–';
  return String(value);
}

function failureDetailDate(value) {
  if (!value) return '–';
  return String(value);
}

function showFailureRecord(record) {
  if (!record) return;

  // Focus information
  document.getElementById('failure-detail-serial').textContent =
    failureDetailFmt(record.serial_num);

  document.getElementById('failure-detail-subtitle').textContent =
    `${failureDetailFmt(record.product)} · ${failureDetailFmt(record.model)}`;

  // Status
  const statusEl = document.getElementById('failure-detail-status');

  const status = Number(record.farepair_status);

  if (status === 1) {
    statusEl.textContent = 'OPEN';
    statusEl.style.background = 'rgba(217,119,6,.13)';
    statusEl.style.color = '#b45309';
  } else if (status === 2) {
    statusEl.textContent = 'WIP';
    statusEl.style.background = 'rgba(37,99,235,.13)';
    statusEl.style.color = '#2563eb';
  } else if (status === 4) {
    statusEl.textContent = 'CLOSED';
    statusEl.style.background = 'rgba(22,163,74,.13)';
    statusEl.style.color = '#15803d';
  } else {
    statusEl.textContent = '–';
    statusEl.style.background = 'rgba(107,114,128,.10)';
    statusEl.style.color = '#6b7280';
  }

  // Failure information
  document.getElementById('fd-product').textContent =
    failureDetailFmt(record.product);

  document.getElementById('fd-model').textContent =
    failureDetailFmt(record.model);

  document.getElementById('fd-po').textContent =
    failureDetailFmt(record.po_num);

  document.getElementById('fd-station').textContent =
    failureDetailFmt(record.station);

  document.getElementById('fd-test-failure').textContent =
    failureDetailFmt(record.test_failure);

  document.getElementById('fd-prod-endorser').textContent =
    failureDetailFmt(record.prod_endorser);

  document.getElementById('fd-fa-endorse-date').textContent =
    failureDetailDate(record.faendorse_datetime);

  // FA information
  document.getElementById('fd-failure-cause').textContent =
    failureDetailFmt(record.failure_cause);

  document.getElementById('fd-affected-comp').textContent =
    failureDetailFmt(record.affected_comp);

  document.getElementById('fd-defect-cat').textContent =
    failureDetailFmt(record.defect_cat);

  document.getElementById('fd-fa-pic').textContent =
    failureDetailFmt(record.fa_pic);

  document.getElementById('fd-fa-class').textContent =
    failureDetailFmt(record.fa_class);

  document.getElementById('fd-fa-case').textContent =
    failureDetailFmt(record.fa_case);

  document.getElementById('fd-proposed-action').textContent =
    failureDetailFmt(record.proposed_action);

  document.getElementById('fd-fa-ended-date').textContent =
    failureDetailDate(record.faended_datetime);

  // Repair / return
  document.getElementById('fd-repairer').textContent =
    failureDetailFmt(record.repairer);

  document.getElementById('fd-action-taken').textContent =
    failureDetailFmt(record.action_taken);

  document.getElementById('fd-repaired-date').textContent =
    failureDetailDate(record.repaired_datetime);

  document.getElementById('fd-returned-date').textContent =
    failureDetailDate(record.returned_datetime);

  // Show modal
  failureDetailModal.style.display = 'flex';

  // Prevent the page behind the modal from scrolling
  document.body.style.overflow = 'hidden';
}

function closeFailureRecordModal() {
  failureDetailModal.style.display = 'none';
  document.body.style.overflow = '';
}

// Close buttons
document.getElementById('btn-failure-detail-close')
  .addEventListener('click', closeFailureRecordModal);

document.getElementById('btn-failure-detail-exit')
  .addEventListener('click', closeFailureRecordModal);

// Click outside modal
failureDetailModal.addEventListener('click', e => {
  if (e.target === failureDetailModal) {
    closeFailureRecordModal();
  }
});

// ESC key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' &&
      failureDetailModal.style.display === 'flex') {
    closeFailureRecordModal();
  }
});

// ── DOWNLOAD ──────────────────────────────────────────────────────────────────
document.getElementById('btn-dl-toggle').addEventListener('click', e => {
  e.stopPropagation();
  document.getElementById('dl-menu').classList.toggle('open');
});
document.addEventListener('click', () => document.getElementById('dl-menu').classList.remove('open'));

const EXPORT_COLS = [
  { key: 'serial_num',          label: 'Serial Num'       },
  { key: 'product',             label: 'Product'          },
  { key: 'model',               label: 'Model'            },
  { key: 'po_num',              label: 'PO Num'           },
  { key: 'station',             label: 'Station'          },
  { key: 'test_failure',        label: 'Test Failure'     },
  { key: 'prod_endorser',       label: 'Prod Endorser'    },
  { key: 'faendorse_datetime',  label: 'FA Endorse Date'  },
  { key: 'failure_cause',       label: 'Failure Cause'    },
  { key: 'affected_comp',       label: 'Affected Comp'    },
  { key: 'defect_cat',          label: 'Defect Cat'       },
  { key: 'fa_pic',              label: 'FA PIC'           },
  { key: 'proposed_action',     label: 'Proposed Action'  },
  { key: 'fa_class',            label: 'FA Class'         },
  { key: 'fa_case',             label: 'FA Case'          },
  { key: 'faended_datetime',    label: 'FA Ended Date'    },
  { key: 'repairer',            label: 'Repairer'         },
  { key: 'action_taken',        label: 'Action Taken'     },
  { key: 'repaired_datetime',   label: 'Repaired Date'    },
  { key: 'returned_datetime',   label: 'Returned Date'    },
  { key: 'farepair_status',     label: 'FA Status', transform: statusLabel },
];

function buildExportRows() {
  const headers = EXPORT_COLS.map(c => c.label);
  const rows = filteredData.map(r =>
    EXPORT_COLS.map(c => {
      const v = r[c.key];
      if (c.transform) return c.transform(v);
      return v == null ? '' : v;
    })
  );
  return [headers, ...rows];
}

document.getElementById('dl-csv').addEventListener('click', () => {
  document.getElementById('dl-menu').classList.remove('open');
  const data = buildExportRows();
  const csv  = data.map(row =>
    row.map(cell => {
      const s = String(cell ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')
  ).join('\r\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, 'fa_report.csv');
});

document.getElementById('dl-xlsx').addEventListener('click', () => {
  document.getElementById('dl-menu').classList.remove('open');
  const data = buildExportRows();
  const ws   = XLSX.utils.aoa_to_sheet(data);
  ws['!cols'] = EXPORT_COLS.map((col) => {
    const maxLen = Math.max(
      col.label.length,
      ...filteredData.map(r => String(r[col.key] ?? '').length).slice(0, 200)
    );
    return { wch: Math.min(maxLen + 2, 40) };
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'FA Report');
  XLSX.writeFile(wb, 'fa_report.xlsx');
});

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}