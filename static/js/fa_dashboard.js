// fa_dashboard.js
// ── STATE ─────────────────────────────────────────────────────────────────────
let allData = [], filteredData = [], page = 1;
const PAGE_SIZE = 50;
const COLORS = ['#f78166','#79c0ff','#56d364','#d29922','#bc8cff','#58a6ff','#ff7b72','#39d353','#ffa657','#a5d6ff'];

function refreshSettingsDateFilters() {
  const baseRows = allData;
  const availableDates = getAvailableDates(baseRows);
  
  // Filter out weekends - only show weekdays
  const weekdayDates = availableDates.filter(date => !isWeekend(date));
  
  const fromSel = document.getElementById('settings-date-from');
  const toSel = document.getElementById('settings-date-to');
  const currentFrom = fromSel.value;
  const currentTo = toSel.value;
  
  // Rebuild "from" dropdown
  fromSel.innerHTML = '<option value="">Select date</option>';
  weekdayDates.forEach(date => {
    const opt = document.createElement('option');
    opt.value = date;
    opt.textContent = date;
    fromSel.appendChild(opt);
  });
  fromSel.value = currentFrom;
  
  // Rebuild "to" dropdown, constraining based on "from" selection
  const fromDate = currentFrom ? new Date(currentFrom) : null;
  toSel.innerHTML = '<option value="">Select date</option>';
  weekdayDates.forEach(date => {
    if (!fromDate || new Date(date) >= fromDate) {
      const opt = document.createElement('option');
      opt.value = date;
      opt.textContent = date;
      toSel.appendChild(opt);
    }
  });
  toSel.value = currentTo;
}

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

// ── DATA HIDING (Weekends, Lunch, Meetings, Holidays) ───────────────────────
function isWeekend(dateStr) {
  const date = new Date(dateStr + 'T00:00:00');
  const day = date.getDay();
  return day === 0 || day === 6;
}

function isLunchTime(datetimeStr) {
  if (!datetimeStr) return false;
  const time = String(datetimeStr).slice(11, 16);
  if (!time) return false;
  const [hh, mm] = time.split(':').map(Number);
  const minutes = hh * 60 + mm;
  const lunchStart = 11 * 60;
  const lunchEnd = 13 * 60;
  return minutes >= lunchStart && minutes < lunchEnd;
}

function getHolidaysAndMeetings() {
  try {
    return JSON.parse(localStorage.getItem('fa_holidays_meetings') || '[]');
  } catch {
    return [];
  }
}

function isHolidayOrMeeting(dateStr) {
  const holidays = getHolidaysAndMeetings();
  return holidays.some(entry => entry.date === dateStr);
}

function shouldHideRecord(record) {
  if (!record.faendorse_datetime) return false;
  const dateStr = String(record.faendorse_datetime).slice(0, 10);
  const isAdmin = (localStorage.getItem('fa_group') || '').toUpperCase() === 'ADMIN';

  const holidays = getHolidaysAndMeetings();
  const userNum = String(localStorage.getItem('fa_user_num') || '').trim();
  const hasConfiguredHide = holidays.some(entry => {
    const authorizedPerson = String(entry.authorizedPerson || '').trim();
    return entry.date === dateStr && (!authorizedPerson || authorizedPerson === userNum);
  });

  // Explicit holiday/meeting assignments apply even when the viewer is an admin.
  if (hasConfiguredHide) return true;

  if (!isAdmin) {
    if (isWeekend(dateStr) || isLunchTime(record.faendorse_datetime)) return true;
  }
  return false;
}


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

    // Start refreshing only after the initial data has loaded
    startAutoRefresh();
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

// ── SETTINGS MODAL (Holidays & Meetings) ──────────────────────────────────────
document.getElementById('btn-settings').addEventListener('click', () => {
  document.getElementById('modal-settings').style.display = 'flex';
  document.getElementById('user-menu-dropdown').classList.remove('open');
  refreshSettingsDateFilters();
  renderSettingsModal();
});

document.getElementById('btn-settings-close').addEventListener('click', () => {
  document.getElementById('modal-settings').style.display = 'none';
});

document.getElementById('btn-settings-close-btn').addEventListener('click', () => {
  document.getElementById('modal-settings').style.display = 'none';
});

const isAdminUser = () => (localStorage.getItem('fa_group') || '').toUpperCase() === 'ADMIN';

function renderSettingsModal() {
  const settingsAuthField = document.getElementById('settings-auth-person-field');
  settingsAuthField.style.display = isAdminUser() ? 'block' : 'none';
  updateSettingsHiddenList();
}

function updateSettingsHiddenList() {
  const list = document.getElementById('settings-hidden-list');
  const holidays = getHolidaysAndMeetings();
  const userNum = localStorage.getItem('fa_user_num') || '';

  if (!holidays.length) {
    list.innerHTML = '<div style="color:var(--muted)">No hidden dates yet</div>';
    return;
  }

  const userHolidays = holidays.filter(h => !h.authorizedPerson || h.authorizedPerson === userNum || isAdminUser());

  if (!userHolidays.length) {
    list.innerHTML = '<div style="color:var(--muted)">No hidden dates</div>';
    return;
  }

  list.innerHTML = userHolidays.map((h, idx) => `
    <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
      <span>${h.date} - ${h.reason || 'N/A'}${h.authorizedPerson ? ' (' + h.authorizedPerson + ')' : ''}</span>
      <button class="btn-reset" style="padding:2px 8px;font-size:.8rem" data-idx="${idx}">Remove</button>
    </div>
  `).join('');

  list.querySelectorAll('button[data-idx]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      holidays.splice(idx, 1);
      localStorage.setItem('fa_holidays_meetings', JSON.stringify(holidays));
      updateSettingsHiddenList();
      applyFilters();
    });
  });
}

document.getElementById('btn-settings-add').addEventListener('click', () => {
  const err = document.getElementById('settings-error');
  err.textContent = '';

  const fromDate = document.getElementById('settings-date-from').value.trim();
  const toDate = document.getElementById('settings-date-to').value.trim();
  const reason = document.getElementById('settings-hide-reason').value.trim();
  const authPerson = document.getElementById('settings-auth-person').value.trim();

  if (!fromDate || !toDate) { err.textContent = 'Please select both From and To dates.'; return; }
  if (fromDate > toDate) { err.textContent = 'Date From cannot be after Date To.'; return; }
  if (!reason || !['Holiday', 'Meeting'].includes(reason)) {
    err.textContent = 'Please select Holiday or Meeting.';
    return;
  }

  const holidays = getHolidaysAndMeetings();
  const userNum = localStorage.getItem('fa_user_num') || '';
  const start = new Date(`${fromDate}T00:00:00`);
  const end = new Date(`${toDate}T00:00:00`);
  const authorizedPerson = isAdminUser() && authPerson ? authPerson : userNum;
  let addedCount = 0;

  for (const current = new Date(start); current <= end; current.setDate(current.getDate() + 1)) {
    const dateStr = current.toISOString().slice(0, 10);
    if (!isWeekend(dateStr) && !holidays.some(entry => entry.date === dateStr && entry.authorizedPerson === authorizedPerson)) {
      holidays.push({
      date: dateStr,
      reason,
      authorizedPerson,
      createdBy: userNum,
      createdAt: new Date().toISOString()
      });
      addedCount += 1;
    }
  }

  if (!addedCount) { err.textContent = 'No new weekdays in selected range.'; return; }
  localStorage.setItem('fa_holidays_meetings', JSON.stringify(holidays));

  document.getElementById('settings-date-from').value = '';
  document.getElementById('settings-date-to').value = '';
  document.getElementById('settings-hide-reason').value = '';
  document.getElementById('settings-auth-person').value = '';

  updateSettingsHiddenList();
  applyFilters();
});

// Event listener for "Date From" changes in settings - refreshes "Date To" options
document.getElementById('settings-date-from').addEventListener('change', refreshSettingsDateFilters);

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
// ================refresh web page=============
let refreshTimer = null;
let isRefreshing = false;

async function refreshData() {
  // Prevent overlapping API requests
  if (isRefreshing) return;

  isRefreshing = true;

  try {
    const res = await fetch('/api/data', {
      cache: 'no-store'
    });

    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status}`);
    }

    const json = await res.json();

    if (!json.ok) {
      throw new Error(json.error || 'Failed to refresh data.');
    }

    // Replace the data with the latest server data
    allData = Array.isArray(json.rows) ? json.rows : [];

    // IMPORTANT:
    // Do NOT reset page = 1 here.
    // Do NOT reset the user's filters.
    refreshCascadingFilters();
    applyFilters();

  } catch (e) {
    console.error('[FA Dashboard] Auto-refresh failed:', e);
  } finally {
    isRefreshing = false;
  }
}

function startAutoRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
  }

  refreshTimer = setInterval(refreshData, 5000);
}

// ── FILTERS ───────────────────────────────────────────────────────────────────
function populateFilters() {
  refreshCascadingFilters();
}

function fillSelect(id, vals, selectedValue = '') {
  const sel = document.getElementById(id);
  while (sel.options.length > 1) sel.remove(1);
  vals.forEach(v => sel.add(new Option(v, v)));
  sel.value = vals.includes(selectedValue) ? selectedValue : '';
}

function getAvailableDates(rows) {
  return [...new Set(rows
    .map(record => {
      const value = record.faendorse_datetime;
      if (!value) return null;
      const dateStr = String(value).trim();
      return dateStr.slice(0, 10) || null;
    })
    .filter(Boolean))].sort((a,b) => b.localeCompare(a));
}

function refreshDateFilters(baseRows = allData) {
  const fromSelect = document.getElementById('f-from');
  const toSelect = document.getElementById('f-to');
  const currentFrom = fromSelect.value;
  const currentTo = toSelect.value;

  const availableDates = getAvailableDates(baseRows);

  const validFrom = currentFrom && availableDates.includes(currentFrom)
    ? currentFrom
    : '';
  const validTo = currentTo && availableDates.includes(currentTo)
    ? currentTo
    : '';

  const fromOptions = availableDates.filter(date => !validTo || date <= validTo);
  const toOptions = availableDates.filter(date => !validFrom || date >= validFrom);

  fillSelect('f-from', fromOptions, validFrom);
  fillSelect('f-to', toOptions, validTo);

  const finalFrom = document.getElementById('f-from').value;
  const finalTo = document.getElementById('f-to').value;

  if (finalFrom && finalTo && finalFrom > finalTo) {
    document.getElementById('f-to').value = finalFrom;
  }
}

function refreshCascadingFilters() {
  const productSelect = document.getElementById('f-product');
  const modelSelect = document.getElementById('f-model');
  const stationSelect = document.getElementById('f-station');
  const product = productSelect.value;
  const model = modelSelect.value;

  const products = [...new Set(allData.map(record => record.product).filter(Boolean))].sort();
  fillSelect('f-product', products, product);

  const productRows = product
    ? allData.filter(record => record.product === product)
    : allData;
  const models = [...new Set(productRows.map(record => record.model).filter(Boolean))].sort();
  fillSelect('f-model', models, model);

  const modelRows = model && models.includes(model)
    ? productRows.filter(record => record.model === model)
    : productRows;
  const stations = [...new Set(modelRows.map(record => record.station).filter(Boolean))].sort();
  fillSelect('f-station', stations, stationSelect.value);

  const stationRows = stationSelect.value && stations.includes(stationSelect.value)
    ? modelRows.filter(record => record.station === stationSelect.value)
    : modelRows;

  refreshDateFilters(stationRows);
}

document.getElementById('f-product').addEventListener('change', () => {
  document.getElementById('f-model').value = '';
  document.getElementById('f-station').value = '';
  refreshCascadingFilters();
});
document.getElementById('f-model').addEventListener('change', () => {
  document.getElementById('f-station').value = '';
  refreshCascadingFilters();
});
document.getElementById('f-station').addEventListener('change', () => {
  refreshCascadingFilters();
});
document.getElementById('f-from').addEventListener('change', () => {
  const fromValue = document.getElementById('f-from').value;
  const toValue = document.getElementById('f-to').value;

  if (fromValue && toValue && fromValue > toValue) {
    document.getElementById('f-to').value = fromValue;
  }

  refreshCascadingFilters();
});
document.getElementById('f-to').addEventListener('change', () => {
  const fromValue = document.getElementById('f-from').value;
  const toValue = document.getElementById('f-to').value;

  if (fromValue && toValue && fromValue > toValue) {
    document.getElementById('f-from').value = toValue;
  }

  refreshCascadingFilters();
});

document.getElementById('btn-apply').addEventListener('click',  () => { page=1; applyFilters(); });
document.getElementById('btn-reset').addEventListener('click',  () => {
  ['f-product','f-model','f-station','f-status'].forEach(id => document.getElementById(id).value='');
  document.getElementById('f-from').value = '';
  document.getElementById('f-to').value   = '';
  refreshCascadingFilters();
  page=1; applyFilters();
});

function applyFilters() {
  const prod   = document.getElementById('f-product').value;
  const model  = document.getElementById('f-model').value;
  const sta    = document.getElementById('f-station').value;
  const status = document.getElementById('f-status').value;
  const from   = document.getElementById('f-from').value;
  const to     = document.getElementById('f-to').value;

  const hasDateFilter = Boolean(from || to);

  if (!hasDateFilter) {
    filteredData = [];
    renderKPIs(); renderCharts(); renderTable();
    return;
  }
  
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
    if (shouldHideRecord(r)) return false;
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

function countByDateAndCategory(arr, key) {
  const map = {};

  arr.forEach(record => {
    const date = String(record.faendorse_datetime || '').slice(0, 10);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;

    const category = String(record[key] || 'Unknown').trim() || 'Unknown';
    const label = `${date} | ${category}`;

    map[label] = (map[label] || 0) + 1;
  });

  return Object.entries(map)
    .sort((a, b) => {
      const [aDate, aCategory] = a[0].split(' | ');
      const [bDate, bCategory] = b[0].split(' | ');

      if (aDate === bDate) {
        return b[1] - a[1] || aCategory.localeCompare(bCategory);
      }

      return aDate.localeCompare(bDate);
    })
    .slice(0, 12);
}

function formatChartLabel(label) {
  const value = String(label || '');

  if (!value.includes(' | ')) {
    return value;
  }

  // Keep category in the underlying label,
  // but display DATE ONLY on the chart.
  const [date] = value.split(' | ');

  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split('-');
    return `${month}/${day}/${year}`;
  }

  return date;
}

function parseChartLabel(label) {
  const text = String(label || '').trim();

  if (!text.includes(' | ')) {
    return {
      date: text,
      category: ''
    };
  }

  const [date, category] = text.split(' | ');

  return {
    date: (date || '').trim(),
    category: (category || '').trim()
  };
}

function showChartMatches(chartKey, label) {
  const { date, category } = parseChartLabel(label);

  if (!date || !category) return;

  const matches = filteredData.filter(record => {
    const recordDate = String(record.faendorse_datetime || '').slice(0, 10);

    if (recordDate !== date) return false;

    const recordValue =
      String(record[chartKey] || 'Unknown').trim() || 'Unknown';

    return recordValue === category;
  });

  const titleMap = {
    product: 'Product',
    station: 'Station'
  };

  renderFailureList(
    `${titleMap[chartKey] || 'Category'} — ${formatChartLabel(date)} (${category})`,
    matches
  );
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
  canvas.style.cursor = entries.length ? 'pointer' : 'default';

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
    const lbl = formatChartLabel(label);
    ctx.save();
    ctx.translate(x + barW/2, PAD_T + chartH + 8);
    ctx.rotate(-0.48);
    ctx.fillStyle = '#6b7280'; ctx.font = '10px Segoe UI, sans-serif'; ctx.textAlign = 'right';
    ctx.fillText(lbl, 0, 0);
    ctx.restore();
  });

  if (options.chartKey) {
    canvas.onclick = event => {
      const rect = canvas.getBoundingClientRect();
      const clickX = event.clientX - rect.left;
      const clickY = event.clientY - rect.top;

      for (let i = 0; i < entries.length; i++) {
        const [label, val] = entries[i];
        const x = PAD_L + gap + i * (barW + gap);
        const bH = (val / maxVal) * chartH;
        const y = PAD_T + chartH - bH;

        if (clickX >= x && clickX <= x + barW && clickY >= y && clickY <= PAD_T + chartH) {
          showChartMatches(options.chartKey, label);
          return;
        }
      }
    };
  }
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
  drawBarChart(
    'chart-product',
    countByDateAndCategory(filteredData, 'product'),
    { chartKey: 'product' }
  );

  drawBarChart(
    'chart-station',
    countByDateAndCategory(filteredData, 'station'),
    { chartKey: 'station' }
  );

  drawHBarChart('chart-defect-cat', countBy(filteredData, 'defect_cat'));

  renderPareto();
}

function groupByFaCase() {
  const groups = new Map();
  filteredData.forEach(record => {
    const faCase = String(record.fa_case || 'Unknown');
    if (!groups.has(faCase)) groups.set(faCase, []);
    groups.get(faCase).push(record);
  });
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
}

function unitsAffected(records) {
  return new Set(records.map(record => String(record.serial_num || '')).filter(Boolean)).size;
}

function getFaCaseUrl(record) {
  const url = record?.url ?? record?.link ?? record?.['fa.url'] ?? record?.fa_url ?? record?.document_url;
  const value = String(url || '').trim();
  if (!value) return '';
  if (/^www\./i.test(value)) return `https://${value}`;
  return /^https?:\/\//i.test(value) ? value : '';
}

function faCaseLink(records) {
  const value = records.map(getFaCaseUrl).find(Boolean);
  if (!value) return '';
  return `<a class="pareto-case-link" href="${escapeHtml(value)}" target="_blank" rel="noopener noreferrer">See Documents</a>`;
}

function drawParetoTrend(records) {
  const canvas = document.getElementById('chart-pareto-trend');
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = Math.max(280, canvas.parentElement.clientWidth - 4);
  const H = 180;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const monthGroups = new Map();
  records.forEach(record => {
    const month = String(record.faendorse_datetime || '').slice(0, 7);
    const serial = String(record.serial_num || '');
    if (!/^\d{4}-\d{2}$/.test(month) || !serial) return;
    if (!monthGroups.has(month)) monthGroups.set(month, new Set());
    monthGroups.get(month).add(serial);
  });
  const entries = [...monthGroups.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  if (!entries.length) {
    ctx.fillStyle = '#6b7280';
    ctx.font = '13px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('No dated records', W / 2, H / 2);
    return;
  }

  const values = entries.map(([, serials]) => serials.size);
  const pad = { top: 18, right: 18, bottom: 42, left: 38 };
  const chartW = W - pad.left - pad.right;
  const chartH = H - pad.top - pad.bottom;
  const maxValue = Math.max(...values, 1);
  const step = chartW / entries.length;
  const barW = Math.max(12, Math.min(56, step * .62));

  for (let tick = 0; tick <= 4; tick++) {
    const value = Math.round(maxValue * tick / 4);
    const y = pad.top + chartH - chartH * tick / 4;
    ctx.strokeStyle = '#e5e7eb';
    ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px Segoe UI, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(value, pad.left - 6, y + 4);
  }

  entries.forEach(([month, serials], index) => {
    const value = serials.size;
    const height = chartH * value / maxValue;
    const x = pad.left + step * index + (step - barW) / 2;
    const y = pad.top + chartH - height;
    ctx.fillStyle = '#f78166';
    ctx.fillRect(x, y, barW, height);
    ctx.fillStyle = '#111827';
    ctx.font = 'bold 11px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(value, x + barW / 2, y - 5);
    ctx.fillStyle = '#6b7280';
    ctx.font = '10px Segoe UI, sans-serif';
    const [year, monthNumber] = month.split('-');
    const label = new Date(Number(year), Number(monthNumber) - 1, 1)
      .toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    ctx.fillText(label, x + barW / 2, H - 16);
  });
}

function renderPareto() {
  const topEl = document.getElementById('pareto-top-case');
  const listEl = document.getElementById('pareto-case-list');
  const groups = groupByFaCase();
  if (!groups.length) {
    topEl.innerHTML = '<div class="pareto-empty">No FA case data</div>';
    listEl.innerHTML = '';
    drawParetoTrend([]);
    return;
  }

  const [topCase, topRecords] = groups[0];
  const top = topRecords[0];
  topEl.innerHTML = `
    <div class="pareto-top-heading">Top FA Case: <strong>${fmt(topCase)}</strong>${faCaseLink(topRecords)}</div>
    <div class="pareto-detail-grid">
      <div><span>Product</span><strong>${fmt(top.product)}</strong></div>
      <div><span>Model</span><strong>${fmt(top.model)}</strong></div>
      <div><span>Test Failure</span><strong>${fmt(top.test_failure)}</strong></div>
      <div><span>Cause of Failure</span><strong>${fmt(top.failure_cause)}</strong></div>
      <div><span>Affected Component</span><strong>${fmt(top.affected_comp)}</strong></div>
      <div><span>Defect Category</span><strong>${fmt(top.defect_cat)}</strong></div>
      <div><span>Units Affected</span><strong>${unitsAffected(topRecords)}</strong></div>
    </div>`;
  drawParetoTrend(topRecords);

  listEl.innerHTML = groups.slice(0, 5).map(([faCase, records], index) => `
    <div class="pareto-case-row" data-fa-case="${escapeHtml(faCase)}">
      <span class="pareto-rank">${index + 1}</span>
      <span class="pareto-case-name">${fmt(faCase)}</span>
      ${faCaseLink(records)}
      <span class="pareto-case-count">${unitsAffected(records).toLocaleString()} units</span>
    </div>`).join('');
  listEl.querySelectorAll('.pareto-case-row').forEach(button => {
    button.addEventListener('click', () => showFaCaseRecords(button.dataset.faCase));
    button.querySelector('.pareto-case-link')?.addEventListener('click', event => event.stopPropagation());
  });
}

function showFaCaseRecords(faCase) {
  if (paretoGroupsModal.style.display === 'flex') closeParetoGroups();
  const matches = filteredData.filter(record => String(record.fa_case || 'Unknown') === faCase);
  renderFailureList(`FA Case ${faCase}`, matches);
}

const paretoGroupsModal = document.getElementById('modal-pareto-groups');
function showParetoGroups() {
  const body = document.getElementById('pareto-groups-body');
  body.innerHTML = groupByFaCase().map(([faCase, records], index) => `
    <div class="pareto-case-row" data-fa-case="${escapeHtml(faCase)}">
      <span class="pareto-rank">${index + 1}</span>
      <span class="pareto-case-name">${fmt(faCase)}</span>
      ${faCaseLink(records)}
      <span class="pareto-case-count">${unitsAffected(records).toLocaleString()} units</span>
    </div>`).join('') || '<div class="pareto-empty">No FA case data</div>';
  body.querySelectorAll('.pareto-case-row').forEach(button => {
    button.addEventListener('click', () => showFaCaseRecords(button.dataset.faCase));
    button.querySelector('.pareto-case-link')?.addEventListener('click', event => event.stopPropagation());
  });
  paretoGroupsModal.style.display = 'flex';
  document.body.style.overflow = 'hidden';
}
document.getElementById('btn-pareto-more').addEventListener('click', showParetoGroups);
function closeParetoGroups() {
  paretoGroupsModal.style.display = 'none';
  document.body.style.overflow = '';
}
document.getElementById('btn-pareto-groups-close').addEventListener('click', closeParetoGroups);
document.getElementById('btn-pareto-groups-exit').addEventListener('click', closeParetoGroups);
paretoGroupsModal.addEventListener('click', event => {
  if (event.target === paretoGroupsModal) closeParetoGroups();
});

// ── TABLE ─────────────────────────────────────────────────────────────────────
document.getElementById('btn-prev').addEventListener('click', () => { if(page>1){page--;renderTable();} });
document.getElementById('btn-next').addEventListener('click', () => { if(page*PAGE_SIZE<filteredData.length){page++;renderTable();} });

function renderTable() {
  const total = filteredData.length;
  const maxPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Prevent current page from exceeding available pages
  if (page > maxPage) {
    page = maxPage;
  }

  const start = (page - 1) * PAGE_SIZE;
  const slice = filteredData.slice(start, start + PAGE_SIZE);
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
  const matches = filteredData.filter(r => String(r.farepair_status) === String(status));
  renderFailureList(titleMap[status] ? `${titleMap[status]} — matching records` : 'Matching records', matches);
}

function renderFailureList(subtitleText, matches) {
  if (!failureListModal) return;
  const subtitle = document.getElementById('failure-list-subtitle');
  const countEl  = document.getElementById('failure-list-count');
  const body     = document.getElementById('failure-list-body');

  subtitle.textContent = subtitleText;
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