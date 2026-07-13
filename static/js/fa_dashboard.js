// fa_dashboard.js
// ── STATE ─────────────────────────────────────────────────────────────────────
let allData = [], filteredData = [], page = 1;
const PAGE_SIZE = 50;
const COLORS = ['#f78166','#79c0ff','#56d364','#d29922','#bc8cff','#58a6ff','#ff7b72','#39d353','#ffa657','#a5d6ff'];

// ── UTILS ─────────────────────────────────────────────────────────────────────
const loader = on => document.getElementById('loader').classList.toggle('on', on);
const fmt    = v  => (v == null || v === '') ? '–' : v;

function statusLabel(v) {
  if (v == 1) return 'Easy';
  if (v == 2) return 'Intermediate';
  if (v == 4) return 'Hard';
  return '';
}
function statusTag(v) {
  if (v == 1) return `<span class="tag tag-open">Easy</span>`;
  if (v == 2) return `<span class="tag tag-closed">Intermediate</span>`;
  if (v == 4) return `<span class="tag tag-wip">Hard</span>`;
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
    const res  = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_num: u, badge: p })
    });
    const json = await res.json();
    if (json.ok) {
      const name = json.user.employee_name || json.user.employee_num;
      document.getElementById('user-label').textContent = name;
      sessionStorage.setItem('fa_user', name);
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
  sessionStorage.removeItem('fa_user');
  document.getElementById('inp-pass').value = '';
  document.getElementById('login-error').textContent = '';
  document.getElementById('user-menu-dropdown').classList.remove('open');
  document.getElementById('dashboard-screen').style.display = 'none';
  document.getElementById('login-screen').style.display     = 'flex';
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
  if (!cur || !nw || !conf) { err.textContent = 'All fields are required.'; return; }
  if (nw !== conf)           { err.textContent = 'New badges do not match.'; return; }
  const res  = await fetch('/api/change_password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ current_badge: cur, new_badge: nw })
  });
  const json = await res.json();
  if (json.ok) {
    document.getElementById('modal-chpass').style.display = 'none';
    ['chpass-current','chpass-new','chpass-confirm'].forEach(id => document.getElementById(id).value = '');
  } else {
    err.textContent = json.error || 'Failed to update badge.';
  }
});

// ── DATA ──────────────────────────────────────────────────────────────────────
async function loadAndRender() {
  loader(true);
  try {
    const res  = await fetch('/api/data');
    const json = await res.json();
    if (!json.ok) { alert('Data error: ' + json.error); return; }
    allData = json.rows;
    populateFilters();
    applyFilters();
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
    if (from && r.faendorse_datetime && r.faendorse_datetime.slice(0,10) < from) return false;
    if (to   && r.faendorse_datetime && r.faendorse_datetime.slice(0,10) > to)   return false;
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
  const dateCol = v => v ? `<span style="color:var(--muted)">${String(v).slice(0,10)}</span>` : '–';
  document.getElementById('table-body').innerHTML = slice.map((r,i) => `
    <tr>
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

  const total = filteredData.length;
  const end   = Math.min(start+PAGE_SIZE, total);
  document.getElementById('page-info').textContent = total
    ? `${start+1}–${end} of ${total.toLocaleString()} records`
    : 'No records';
  document.getElementById('btn-prev').disabled = page === 1;
  document.getElementById('btn-next').disabled = end >= total;
}

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