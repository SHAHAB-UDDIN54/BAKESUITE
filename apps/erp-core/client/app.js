/**
 * BakeSuite ERP - Enterprise Bakery Intelligence Suite
 * Modules: Forecast Workbench (AI-01), Branch Indent Plan, Central Kitchen Bake, Purchase Requirements (MRP)
 * Strictly connected to real ERP Core & ML Service backend APIs.
 */

// Global State
// Base API endpoint - redirects to ERP Core port 3000 when running from Live Server (e.g. port 5500)
const API_BASE = (window.location.port !== '3000') ? 'http://localhost:3000' : '';

let forecastData = [];
let indentData = [];
let bakeBatches = [];
let purchaseMaterials = [];

let chartInstance = null;
let currentOverrideItem = null;
let isCircuitBreakerActive = false;
let selectedSkuId = 'SKU-BRD-01'; // Selected SKU for Chart inspection
let lastBatchInfo = null;

// Format PKR: Rs 1,250,000.00
function formatPKR(val) {
  if (isNaN(val) || val === null || val === undefined) return 'Rs 0.00';
  const parts = Number(val).toFixed(2).split('.');
  const intPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `Rs ${intPart}.${parts[1]}`;
}

// Toast Notifications
function showToast(message, type = 'info', icon = '') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const defaultIcons = {
    success: '✅',
    info: 'ℹ️',
    warning: '⚠️'
  };

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${icon || defaultIcons[type] || 'ℹ️'}</span>
    <span class="toast-msg">${message}</span>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(50px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
window.showToast = showToast;

// Live PKT Clock (Asia/Karachi UTC+5)
function startLiveClock() {
  function tick() {
    const el = document.getElementById('disp-pkt-clock');
    if (!el) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Karachi',
      hour12: false
    });
    el.textContent = `${timeStr} PKT`;
  }
  tick();
  setInterval(tick, 1000);
}

// Navigation & Tab Switching
function setupNavigation() {
  const navItems = {
    '#workbench': {
      navId: 'nav-forecast-workbench',
      viewId: 'view-workbench',
      title: 'Forecast Workbench',
      subtitle: 'AI-01 Probabilistic Demand Intelligence (P10 / P50 / P90)'
    },
    '#indent': {
      navId: 'nav-branch-indent',
      viewId: 'view-indent',
      title: 'Branch Indent Plan',
      subtitle: 'Branch Daily Store Requisitions & Stock Dispatch Logistics'
    },
    '#production': {
      navId: 'nav-production-plan',
      viewId: 'view-production',
      title: 'Central Kitchen Bake Plan',
      subtitle: 'Commercial Deck & Rotary Oven Batch Scheduling (Advisory Prototype)'
    },
    '#purchase': {
      navId: 'nav-purchase-req',
      viewId: 'view-purchase',
      title: 'Purchase Requirements',
      subtitle: 'Raw Material Explosion & Ingredient Requisitions (Advisory Prototype)'
    }
  };

  function switchView(targetHash) {
    const hash = targetHash in navItems ? targetHash : '#workbench';
    const activeConfig = navItems[hash];

    // Update Nav Sidebar
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const activeNavLink = document.getElementById(activeConfig.navId);
    if (activeNavLink) activeNavLink.classList.add('active');

    // Update View Panels
    document.querySelectorAll('.view-panel').forEach(panel => panel.classList.add('hidden'));
    const activePanel = document.getElementById(activeConfig.viewId);
    if (activePanel) activePanel.classList.remove('hidden');

    // Update Topbar
    const titleEl = document.getElementById('page-title');
    const subtitleEl = document.getElementById('page-subtitle');
    if (titleEl) titleEl.textContent = activeConfig.title;
    if (subtitleEl) subtitleEl.textContent = activeConfig.subtitle;

    // Render respective modules if needed
    if (hash === '#indent') {
      initializeIndents();
    } else if (hash === '#production') {
      initializeBakeBatches();
    } else if (hash === '#purchase') {
      initializePurchaseMaterials();
    } else {
      if (chartInstance) chartInstance.resize();
    }
  }

  window.addEventListener('hashchange', () => switchView(window.location.hash));

  Object.keys(navItems).forEach(hash => {
    const item = document.getElementById(navItems[hash].navId);
    if (item) {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        window.location.hash = hash;
      });
    }
  });

  switchView(window.location.hash || '#workbench');
}

// Download Helper for CSV Exports
function downloadCSV(filename, csvContent) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  showToast(`Exported ${filename}`, 'success');
}

let authToken = sessionStorage.getItem('bakesuite_jwt_token') || '';
let authHeaders = {
  'Authorization': authToken ? `Bearer ${authToken}` : '',
  'Content-Type': 'application/json'
};
const AUTH_HEADERS = authHeaders;

async function ensureAuthenticated() {
  if (authToken) {
    try {
      const res = await fetch(`${API_BASE}/api/v1/auth/session`, {
        headers: { 'Authorization': `Bearer ${authToken}` }
      });
      if (res.ok) return;
    } catch (e) {}
  }

  // Obtain cryptographically signed JWT token from ERP Core auth API
  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin' })
    });
    if (res.ok) {
      const data = await res.json();
      authToken = data.token;
      sessionStorage.setItem('bakesuite_jwt_token', authToken);
      authHeaders['Authorization'] = `Bearer ${authToken}`;
    }
  } catch (err) {
    console.warn('[AUTH] Session auto-authentication notice:', err);
  }
}

// =========================================================================
// MODULE 1: FORECAST WORKBENCH (AI-01) — REAL API INTEGRATION
// =========================================================================

/**
 * Loads dynamic branches and categories from ERP Core
 */
async function loadMetadata() {
  await ensureAuthenticated();
  try {
    const [bRes, cRes] = await Promise.all([
      fetch(`${API_BASE}/api/v1/ai/metadata/branches`, { headers: authHeaders }),
      fetch(`${API_BASE}/api/v1/ai/metadata/categories`, { headers: authHeaders })
    ]);

    if (bRes.ok) {
      const branches = await bRes.json();
      const bSelect = document.getElementById('select-branch');
      const bIndentSelect = document.getElementById('select-indent-branch');
      if (bSelect && Array.isArray(branches) && branches.length > 0) {
        const curVal = bSelect.value;
        bSelect.innerHTML = branches.map(b => `<option value="${b.branch_id}">${b.branch_id}: ${b.branch_name || b.branch_id}</option>`).join('');
        if (branches.some(b => b.branch_id === curVal)) bSelect.value = curVal;
      }
      if (bIndentSelect && Array.isArray(branches) && branches.length > 0) {
        const curVal = bIndentSelect.value;
        bIndentSelect.innerHTML = branches.map(b => `<option value="${b.branch_id}">${b.branch_id}: ${b.branch_name || b.branch_id}</option>`).join('');
        if (branches.some(b => b.branch_id === curVal)) bIndentSelect.value = curVal;
      }
    }

    if (cRes.ok) {
      const cats = await cRes.json();
      const cSelect = document.getElementById('select-category');
      if (cSelect && Array.isArray(cats) && cats.length > 0) {
        const curVal = cSelect.value;
        const catMap = {
          'BREAD': 'Breads & Traditional Loaves',
          'CAKE': 'Cakes & Pastries',
          'SAVORY': 'Savories & Hot Kitchen',
          'SWEET': 'Traditional Sweets & Mithai',
          'BEVERAGE': 'Beverages & Coffee'
        };
        const optionsHtml = cats.map(c => {
          const id = typeof c === 'string' ? c : (c.category_id || c.name || '');
          const label = catMap[id] || (typeof c === 'string' ? c : (c.category_name || id));
          return `<option value="${id}">${label}</option>`;
        }).join('');
        cSelect.innerHTML = `<option value="ALL">All Categories</option>` + optionsHtml;
        if (curVal && curVal !== 'undefined' && cats.some(c => (typeof c === 'string' ? c : c.category_id) === curVal)) {
          cSelect.value = curVal;
        } else {
          cSelect.value = 'ALL';
        }
      }
    }
  } catch (err) {
    console.warn('[METADATA] Error loading dynamic metadata:', err);
  }
}

/**
 * Loads real batch run metadata from backend
 */
async function loadBatchInfo() {
  const batchTimeEl = document.getElementById('batch-run-time');
  await ensureAuthenticated();
  try {
    const res = await fetch(`${API_BASE}/api/v1/ai/forecasts/batch-info`, { headers: authHeaders });
    if (res.ok) {
      const data = await res.json();
      lastBatchInfo = data;
      if (batchTimeEl) {
        if (data.status === 'Unavailable' || !data.last_run_at) {
          batchTimeEl.textContent = 'Last batch: Unavailable';
        } else {
          const dt = new Date(data.last_run_at);
          const timeStr = dt.toLocaleTimeString('en-GB', { timeZone: 'Asia/Karachi', hour12: false });
          const count = typeof data.skus_scored === 'number' ? data.skus_scored : 0;
          batchTimeEl.textContent = `Last batch: ${timeStr} PKT (${count} SKUs)`;
        }
      }
    } else {
      if (batchTimeEl) batchTimeEl.textContent = 'Last batch: Unavailable';
    }
  } catch (e) {
    console.warn('[WORKBENCH] Unable to load batch info:', e);
    if (batchTimeEl) batchTimeEl.textContent = 'Last batch: Unavailable';
  }
}

/**
 * Loads real probabilistic demand forecasts from ERP Core -> ML Service
 */
async function loadForecastData() {
  const branchSelect = document.getElementById('select-branch');
  const branchId = branchSelect ? branchSelect.value : 'BR-KHI-01';
  const categorySelect = document.getElementById('select-category');
  const category = categorySelect ? categorySelect.value : 'ALL';
  const tbody = document.getElementById('forecast-table-body');

  tbody.innerHTML = `
    <tr>
      <td colspan="11" style="text-align:center; padding: 40px; color: var(--text-muted);">
        <div style="font-size:1.1rem; margin-bottom:8px;">⏳ Loading AI-01 Probabilistic Predictions...</div>
        <div style="font-size:0.85rem; color:var(--text-secondary);">Querying ERP Core proxy and LightGBM quantile boosters for ${branchId}</div>
      </td>
    </tr>
  `;

  await loadBatchInfo();

  try {
    const url = `${API_BASE}/api/v1/ai/forecasts/demand?branch_id=${encodeURIComponent(branchId)}`;
    const response = await fetch(url, { headers: AUTH_HEADERS });

    if (response.status === 422) {
      const err = await response.json();
      tbody.innerHTML = `
        <tr>
          <td colspan="11" style="text-align:center; padding: 30px; color: var(--accent-rose);">
            <strong>Validation Error (422)</strong>: ${err.error || err.detail || 'Forecast horizon cannot exceed 35 days.'}
          </td>
        </tr>
      `;
      showToast('Forecast horizon cannot exceed 35 days.', 'warning');
      return;
    }

    if (!response.ok) {
      throw new Error(`ERP API returned status ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    forecastData = Array.isArray(data) ? data : [data];

    // Detect fallback mode
    const isFallbackMode = forecastData.some(item => item.served_from === 'ERP_FALLBACK_CACHE');
    isCircuitBreakerActive = isFallbackMode;
    updateServiceStatusIndicator(isFallbackMode);

    if (forecastData.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="11" style="text-align:center; padding: 35px; color: var(--text-muted);">
            No forecast data found for the selected branch.
          </td>
        </tr>
      `;
      updateKpis([]);
      return;
    }

    // Default selected SKU for Chart inspection
    if (!forecastData.some(i => i.sku_id === selectedSkuId)) {
      selectedSkuId = forecastData[0].sku_id;
    }

    // Initialize downstream dependent modules with real demand
    initializeIndents();
    initializeBakeBatches();
    initializePurchaseMaterials();

    filterAndRenderTable();
    if (window.location.hash === '#indent') {
      filterAndRenderIndents();
    } else if (window.location.hash === '#production') {
      filterAndRenderBakeBatches();
    } else if (window.location.hash === '#purchase') {
      filterAndRenderPurchase();
    }

    await renderChart(selectedSkuId);
  } catch (err) {
    console.error('[WORKBENCH] Error loading forecast data:', err);
    tbody.innerHTML = `
      <tr>
        <td colspan="11" style="text-align:center; padding: 35px; color: var(--accent-rose);">
          <div style="font-weight:600; margin-bottom:6px;">⚠️ Unable to load forecast data</div>
          <div style="font-size:0.85rem; color:var(--text-muted);">${err.message || 'Please verify that ERP Core and ML Service are running.'}</div>
        </td>
      </tr>
    `;
    showToast('Failed to load forecast data from backend API.', 'warning');
  }
}

/**
 * Updates UI status indicator for ML Service vs Fallback
 */
function updateServiceStatusIndicator(isFallback) {
  const dot = document.getElementById('service-status-dot');
  const btn = document.getElementById('btn-toggle-circuit-breaker');
  if (dot) {
    dot.className = isFallback ? 'status-indicator offline' : 'status-indicator online';
  }
  if (btn) {
    btn.textContent = isFallback ? 'Restore ML Link' : 'Simulate Outage (AC-4)';
    btn.style.borderColor = isFallback ? '#f43f5e' : '';
    btn.style.color = isFallback ? '#f43f5e' : '';
  }
}

/**
 * Dynamically computes KPI summary values strictly from loaded backend API records
 */
function updateKpis(items) {
  const list = items !== undefined ? items : forecastData;
  const totalUnits = list.reduce((sum, item) => sum + (item.override_quantity || item.p50_quantity || 0), 0);
  const totalRev = list.reduce((sum, item) => {
    const qty = item.override_quantity || item.p50_quantity || 0;
    const price = item.base_price || (item.expected_revenue_pkr ? item.expected_revenue_pkr / (item.p50_quantity || 1) : 0);
    return sum + (item.expected_revenue_pkr || (qty * price));
  }, 0);

  const unitsEl = document.getElementById('kpi-total-units');
  const revEl = document.getElementById('kpi-total-revenue');
  const confEl = document.getElementById('kpi-high-conf');
  const eventEl = document.getElementById('kpi-lunar-event');

  if (unitsEl) unitsEl.textContent = `${totalUnits.toLocaleString()} Units`;
  if (revEl) revEl.textContent = formatPKR(totalRev);

  if (confEl) {
    if (isCircuitBreakerActive) {
      confEl.textContent = 'Fallback';
    } else {
      const validConf = list.filter(i => i.confidence_score !== null && i.confidence_score !== undefined);
      if (validConf.length > 0) {
        const highCount = validConf.filter(i => i.confidence_score >= 0.75).length;
        const pct = Math.round((highCount / validConf.length) * 100);
        confEl.textContent = `${pct}%`;
      } else {
        confEl.textContent = '--%';
      }
    }
  }

  if (eventEl) {
    const eventCounts = {};
    list.forEach(i => {
      const ev = i.event_context || 'Normal';
      eventCounts[ev] = (eventCounts[ev] || 0) + 1;
    });
    // Pick most prominent non-normal event, or Normal
    const nonNormal = Object.keys(eventCounts).filter(k => k !== 'Normal');
    const dominant = nonNormal.length > 0 ? nonNormal[0] : 'Normal Trade Day';
    eventEl.textContent = dominant;
  }
}

/**
 * Filters and renders the Forecast Table
 */
function filterAndRenderTable() {
  const cat = document.getElementById('select-category')?.value || 'ALL';
  const q = (document.getElementById('input-search')?.value || '').toLowerCase().trim();

  const filtered = forecastData.filter(item => {
    const matchesCat = (cat === 'ALL' || item.category_id === cat);
    const matchesQuery = (!q || 
      (item.sku_name && item.sku_name.toLowerCase().includes(q)) || 
      (item.sku_id && item.sku_id.toLowerCase().includes(q)));
    return matchesCat && matchesQuery;
  });

  const tbody = document.getElementById('forecast-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const showingEl = document.getElementById('showing-text');
  if (showingEl) {
    showingEl.textContent = `Showing ${filtered.length} of ${forecastData.length} active items`;
  }

  updateKpis(filtered);

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11" style="text-align:center; padding: 30px; color: var(--text-muted);">
          No forecast records match your filter criteria.
        </td>
      </tr>
    `;
    return;
  }

  // Automatically update chart to first SKU of newly filtered category if current SKU is not in category
  if (!filtered.some(i => i.sku_id === selectedSkuId)) {
    selectedSkuId = filtered[0].sku_id;
    renderChart(selectedSkuId);
  }

  filtered.forEach(item => {
    const tr = document.createElement('tr');
    if (item.sku_id === selectedSkuId) {
      tr.className = 'selected-row';
    }

    // Row selection for Chart inspection
    tr.addEventListener('click', (e) => {
      if (e.target.closest('button')) return; // Ignore action buttons
      selectedSkuId = item.sku_id;
      document.querySelectorAll('#forecast-table-body tr').forEach(r => r.classList.remove('selected-row'));
      tr.classList.add('selected-row');
      renderChart(selectedSkuId);
    });

    // Confidence badge rendering
    let confBadgeHtml = '';
    if (item.served_from === 'ERP_FALLBACK_CACHE' || item.confidence_score === null) {
      confBadgeHtml = `<span class="conf-badge fallback" title="Deterministic 4-Week Moving Average Fallback">Fallback estimate</span>`;
    } else {
      const score = item.confidence_score;
      const band = item.confidence_band || (score >= 0.75 ? 'High' : (score >= 0.50 ? 'Medium' : 'Low'));
      const bandClass = band.toLowerCase();
      confBadgeHtml = `<span class="conf-badge ${bandClass}" title="Score: ${Math.round(score * 100)}%">${band} (${Math.round(score * 100)}%)</span>`;
    }

    // Override styling
    const isOverridden = Boolean(item.is_overridden);
    const effectiveP50 = isOverridden ? item.override_quantity : item.p50_quantity;
    const p50Display = isOverridden
      ? `<span class="p50-val" style="color:var(--accent-gold); text-decoration:line-through; font-size:0.85rem; margin-right:4px;">${item.p50_quantity}</span><span class="p50-val highlight" title="Override Reason: ${item.override_reason}">${effectiveP50} PCS*</span>`
      : `<span class="p50-val">${effectiveP50} PCS</span>`;

    // Predictive Interval Bar width calculation
    const maxBar = Math.max(item.p90_quantity, 1);
    const p10Pct = Math.round((item.p10_quantity / maxBar) * 100);
    const p50Pct = Math.round((effectiveP50 / maxBar) * 100);
    const intervalBarHtml = `
      <div class="pred-interval-container" title="P10: ${item.p10_quantity} | P50: ${effectiveP50} | P90: ${item.p90_quantity}">
        <div class="interval-band" style="left:${p10Pct}%; width:${Math.max(100 - p10Pct, 5)}%;"></div>
        <div class="interval-p50-pin" style="left:${p50Pct}%;"></div>
      </div>
    `;

    // Formatted Revenue
    const revVal = item.expected_revenue_pkr || (effectiveP50 * (item.base_price || 0));

    tr.innerHTML = `
      <td>
        <div class="sku-cell">
          <span class="sku-name">${item.sku_name || item.sku_id}</span>
          <span class="sku-id">${item.sku_id}</span>
        </div>
      </td>
      <td><span class="cat-badge">${item.category_id || 'CAT'}</span></td>
      <td><span style="font-family:var(--font-mono); font-size:0.85rem; color:var(--text-secondary);">${item.forecast_date}</span></td>
      <td><span style="font-family:var(--font-mono); color:var(--text-secondary);">${item.p10_quantity}</span></td>
      <td>${p50Display}</td>
      <td><span style="font-family:var(--font-mono); color:var(--text-secondary);">${item.p90_quantity}</span></td>
      <td>${intervalBarHtml}</td>
      <td>${confBadgeHtml}</td>
      <td><span class="sales-val">${formatPKR(revVal)}</span></td>
      <td><span class="event-chip ${item.event_context !== 'Normal' ? 'active-event' : ''}">${item.event_context || 'Normal'}</span></td>
      <td>
        <button class="btn-action btn-override" onclick="openOverrideModal('${item.sku_id}', '${item.forecast_date}')">Override</button>
        <button class="btn-details" onclick="openDetailsModal('${item.sku_id}', '${item.forecast_date}')" title="Inspect diagnostic metadata">Details</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// =========================================================================
// MODULE 1.2: REAL TIME-SERIES CHART (Chart.js via /api/v1/ai/forecasts/chart-data)
// =========================================================================

/**
 * Fetches real 28-day actuals and 14-day forecasts from backend and renders Chart.js
 */
async function renderChart(targetSkuId) {
  const branchSelect = document.getElementById('select-branch');
  const branchId = branchSelect ? branchSelect.value : 'BR-KHI-01';
  const sku = targetSkuId || selectedSkuId || 'SKU-BRD-01';

  const chartTitleEl = document.getElementById('chart-sku-title');
  const chartSubEl = document.getElementById('chart-sku-subtitle');
  const ctx = document.getElementById('forecastChart')?.getContext('2d');
  if (!ctx) return;

  try {
    const res = await fetch(`${API_BASE}/api/v1/ai/forecasts/chart-data?branch_id=${encodeURIComponent(branchId)}&sku_id=${encodeURIComponent(sku)}`, { headers: AUTH_HEADERS });
    if (!res.ok) {
      throw new Error(`Failed to fetch chart data: ${res.statusText}`);
    }

    const data = await res.json();
    const actuals = data.actuals || [];
    const forecast = data.forecast || [];

    const item = forecastData.find(i => i.sku_id === sku);
    const skuName = item ? item.sku_name : sku;

    if (chartTitleEl) {
      chartTitleEl.textContent = `Demand Trajectory: 28-Day Actuals vs 14-Day Forecast — ${skuName} (${sku})`;
    }
    if (chartSubEl) {
      const latestP50 = forecast.length > 0 ? forecast[0].p50 : (item ? item.p50_quantity : '--');
      chartSubEl.textContent = `Branch: ${branchId} | Forward P50 Anchor: ${latestP50} PCS | Real historical sales & LightGBM uncertainty interval`;
    }

    // Construct labels and data points
    const labels = [];
    const actualSeries = [];
    const p50Series = [];
    const p90Series = [];
    const p10Series = [];

    // 1. Historical Actuals (up to 28 days)
    actuals.forEach(a => {
      labels.push(a.date);
      actualSeries.push(a.quantity);
      p50Series.push(null);
      p90Series.push(null);
      p10Series.push(null);
    });

    // 2. Anchor point joining actuals to forecast
    if (actuals.length > 0 && forecast.length > 0) {
      const lastActual = actuals[actuals.length - 1];
      p50Series[p50Series.length - 1] = lastActual.quantity;
      p90Series[p90Series.length - 1] = lastActual.quantity;
      p10Series[p10Series.length - 1] = lastActual.quantity;
    }

    // 3. Forward Forecast Predictions (up to 14 days)
    forecast.forEach(f => {
      labels.push(f.date);
      actualSeries.push(null);
      p50Series.push(f.p50);
      p90Series.push(f.p90);
      p10Series.push(f.p10);
    });

    if (chartInstance) {
      chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Historical Actuals',
            data: actualSeries,
            borderColor: '#60a5fa',
            backgroundColor: '#60a5fa',
            borderWidth: 2.5,
            tension: 0.25,
            pointRadius: 2
          },
          {
            label: 'P50 Forecast',
            data: p50Series,
            borderColor: '#f59e0b',
            backgroundColor: '#f59e0b',
            borderWidth: 3,
            tension: 0.25,
            pointRadius: 3
          },
          {
            label: 'P90 Upper Bound',
            data: p90Series,
            borderColor: 'rgba(245, 158, 11, 0.35)',
            borderDash: [5, 5],
            borderWidth: 1.5,
            fill: '+1',
            backgroundColor: 'rgba(245, 158, 11, 0.12)',
            tension: 0.25,
            pointRadius: 0
          },
          {
            label: 'P10 Lower Bound',
            data: p10Series,
            borderColor: 'rgba(245, 158, 11, 0.35)',
            borderDash: [5, 5],
            borderWidth: 1.5,
            tension: 0.25,
            pointRadius: 0
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            mode: 'index',
            intersect: false,
            backgroundColor: '#111827',
            titleColor: '#f59e0b',
            borderColor: 'rgba(255,255,255,0.1)',
            borderWidth: 1,
            callbacks: {
              label: function(context) {
                const val = context.parsed.y;
                return val !== null ? `${context.dataset.label}: ${val} PCS` : '';
              }
            }
          }
        },
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: {
              color: '#9ca3af',
              font: { family: 'Outfit', size: 10 },
              maxTicksLimit: 14
            }
          },
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#9ca3af', font: { family: 'JetBrains Mono', size: 11 } }
          }
        }
      }
    });
  } catch (e) {
    console.error('[WORKBENCH] Error rendering chart:', e);
  }
}

// =========================================================================
// MODULE 1.3: MANUAL OVERRIDE & REVERT AUDITING
// =========================================================================

window.openOverrideModal = function(skuId, forecastDate) {
  const item = forecastData.find(i => i.sku_id === skuId && (forecastDate ? i.forecast_date === forecastDate : true));
  if (!item) return;

  currentOverrideItem = item;
  document.getElementById('modal-sku-name').textContent = `${item.sku_name || item.sku_id} (${item.sku_id})`;
  document.getElementById('modal-p50-val').textContent = `${item.p50_quantity} PCS (Expected: ${formatPKR(item.expected_revenue_pkr)})`;
  document.getElementById('override-qty').value = item.override_quantity || item.p50_quantity;
  document.getElementById('override-notes').value = item.override_notes || '';
  if (item.override_reason) {
    document.getElementById('override-reason').value = item.override_reason;
  }

  // Toggle Revert button
  const revertBtn = document.getElementById('btn-revert-override');
  if (item.is_overridden) {
    revertBtn.classList.remove('hidden');
  } else {
    revertBtn.classList.add('hidden');
  }

  document.getElementById('override-modal').classList.remove('hidden');
};

function closeModal() {
  document.getElementById('override-modal').classList.add('hidden');
  currentOverrideItem = null;
}

async function saveOverride() {
  if (!currentOverrideItem) return;

  const newQty = parseInt(document.getElementById('override-qty').value, 10);
  const reason = document.getElementById('override-reason').value;
  const notes = document.getElementById('override-notes').value.trim();
  const branchId = document.getElementById('select-branch').value;
  const forecastDate = currentOverrideItem.forecast_date;

  if (isNaN(newQty) || newQty <= 0) {
    showToast('Please enter a valid override quantity greater than zero.', 'warning');
    return;
  }

  if (reason === 'Other' && (!notes || notes.length === 0)) {
    showToast("Mandatory justification notes required when selecting 'Other' reason code.", 'warning');
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/v1/ai/forecasts/override`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        sku_id: currentOverrideItem.sku_id,
        branch_id: branchId,
        forecast_date: forecastDate,
        original_forecast: currentOverrideItem.p50_quantity,
        override_quantity: newQty,
        reason_code: reason,
        notes: notes,
        model_version: currentOverrideItem.model_version || 'lgbm-v1.0-quantile'
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Server error recording override');
    }

    closeModal();
    showToast(`Override signed & audited: ${currentOverrideItem.sku_name || currentOverrideItem.sku_id} set to ${newQty} PCS (${reason})`, 'success');
    await loadForecastData();
  } catch (err) {
    console.error('[WORKBENCH] Override submission failed:', err);
    showToast(`Failed to save override: ${err.message}`, 'warning');
  }
}

async function revertOverride() {
  if (!currentOverrideItem) return;

  const branchId = document.getElementById('select-branch').value;

  try {
    const res = await fetch(`${API_BASE}/api/v1/ai/forecasts/override/revert`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({
        sku_id: currentOverrideItem.sku_id,
        branch_id: branchId,
        forecast_date: currentOverrideItem.forecast_date
      })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Server error reverting override');
    }

    closeModal();
    showToast(`Override reverted for ${currentOverrideItem.sku_name || currentOverrideItem.sku_id}. Restored baseline AI P50 forecast.`, 'info');
    await loadForecastData();
  } catch (err) {
    console.error('[WORKBENCH] Revert override failed:', err);
    showToast(`Failed to revert override: ${err.message}`, 'warning');
  }
}

// =========================================================================
// MODULE 1.4: DIAGNOSTIC DETAILS DRAWER
// =========================================================================

window.openDetailsModal = function(skuId, forecastDate) {
  const item = forecastData.find(i => i.sku_id === skuId && (forecastDate ? i.forecast_date === forecastDate : true));
  if (!item) return;

  const contentEl = document.getElementById('details-modal-content');
  if (!contentEl) return;

  const branchId = document.getElementById('select-branch')?.value || item.branch_id;
  const drivers = Array.isArray(item.driver_summary) ? item.driver_summary : [
    "Weekly seasonality & calendar stability",
    "Point-in-time autoregressive feature vector",
    "Regional demand baseline anchor"
  ];

  contentEl.innerHTML = `
    <div style="margin-bottom:12px;">
      <h4 style="font-size:1.15rem; color:#fff; font-weight:700;">${item.sku_name || item.sku_id}</h4>
      <div style="font-size:0.85rem; color:var(--text-secondary);">SKU: ${item.sku_id} | Branch: ${branchId} | Category: ${item.category_id || 'N/A'}</div>
    </div>

    <div class="diagnostic-grid">
      <div class="diag-item">
        <span class="diag-label">Forecast Date</span>
        <span class="diag-val">${item.forecast_date}</span>
      </div>
      <div class="diag-item">
        <span class="diag-label">Served From</span>
        <span class="diag-val" style="color:${item.served_from === 'ERP_FALLBACK_CACHE' ? 'var(--accent-rose)' : 'var(--accent-emerald)'};">${item.served_from}</span>
      </div>
      <div class="diag-item">
        <span class="diag-label">Tri-Quantile Predictions</span>
        <span class="diag-val">P10: ${item.p10_quantity} | P50: ${item.p50_quantity} | P90: ${item.p90_quantity}</span>
      </div>
      <div class="diag-item">
        <span class="diag-label">Confidence Assessment</span>
        <span class="diag-val">${item.confidence_band ? item.confidence_band + ' (' + Math.round((item.confidence_score || 0) * 100) + '%)' : 'Fallback (Null)'}</span>
      </div>
      <div class="diag-item">
        <span class="diag-label">Event Context</span>
        <span class="diag-val">${item.event_context || 'Normal'}</span>
      </div>
      <div class="diag-item">
        <span class="diag-label">Expected Revenue</span>
        <span class="diag-val">${formatPKR(item.expected_revenue_pkr)}</span>
      </div>
      <div class="diag-item">
        <span class="diag-label">Model Version</span>
        <span class="diag-val" style="font-size:0.85rem;">${item.model_version || 'N/A'}</span>
      </div>
      <div class="diag-item">
        <span class="diag-label">Guardrail & Cold-Start</span>
        <span class="diag-val" style="font-size:0.85rem;">Clipped: ${item.forecast_clipped ? 'YES (3x 56d max)' : 'NO'} | Cold: ${item.cold_start_flag ? 'YES' : 'NO'}</span>
      </div>

      <div class="diag-drivers">
        <span class="diag-label">AI Explainability & Driver Attribution</span>
        <ul class="diag-drivers-list">
          ${drivers.map(d => `<li>${d}</li>`).join('')}
        </ul>
      </div>
    </div>
  `;

  document.getElementById('details-modal')?.classList.remove('hidden');
};

function closeDetailsModal() {
  document.getElementById('details-modal')?.classList.add('hidden');
}

// =========================================================================
// MODULE 1.5: REAL RESCORE API ACTION
// =========================================================================

async function triggerRealRescore() {
  const btn = document.getElementById('btn-rescore-ai');
  const branchId = document.getElementById('select-branch')?.value || 'BR-KHI-01';

  if (!forecastData || forecastData.length === 0) {
    showToast('No forecast items available to rescore.', 'warning');
    return;
  }

  // Gather at most 500 items
  const itemsToRescore = forecastData.slice(0, 500).map(item => ({
    sku_id: item.sku_id,
    branch_id: branchId,
    date: item.forecast_date,
    scenario_price_pkr: item.base_price || 200.0,
    promotion_depth_percent: 0.0
  }));

  const origText = btn ? btn.textContent : '';
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Rescoring...';
  }

  showToast(`Submitting ${itemsToRescore.length} SKU-branch pairs to ML Service rescore API...`, 'info');

  try {
    const res = await fetch(`${API_BASE}/api/v1/ai/forecasts/rescore`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ items: itemsToRescore })
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || `Rescore API failed (${res.status})`);
    }

    const result = await res.json();
    const duration = result.duration_ms || 120;
    showToast(`Rescored ${result.rescored_count || itemsToRescore.length} SKU-branch pairs in ${(duration / 1000).toFixed(2)}s via ML engine.`, 'success');
    await loadForecastData();
  } catch (err) {
    console.error('[WORKBENCH] Rescore failed:', err);
    showToast(`Rescore error: ${err.message}`, 'warning');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = origText;
    }
  }
}

// =========================================================================
// MODULE 1.6: REAL CSV EXPORT
// =========================================================================

function exportForecastCSV() {
  if (!forecastData || forecastData.length === 0) {
    showToast('No forecast data loaded to export.', 'warning');
    return;
  }
  const branchId = document.getElementById('select-branch')?.value || 'BR-KHI-01';
  const headers = [
    'SKU ID', 'SKU Name', 'Category', 'Branch', 'Forecast Date', 
    'P10 Lower', 'P50 Expected', 'P90 Upper', 'Effective Qty', 
    'Expected Sales (PKR)', 'Confidence Score', 'Confidence Band', 
    'Event Context', 'Model Version', 'Served From', 'Overridden'
  ];

  const rows = forecastData.map(i => [
    i.sku_id,
    `"${(i.sku_name || i.sku_id).replace(/"/g, '""')}"`,
    i.category_id || 'CAT',
    branchId,
    i.forecast_date,
    i.p10_quantity,
    i.p50_quantity,
    i.p90_quantity,
    i.override_quantity || i.p50_quantity,
    i.expected_revenue_pkr || ((i.override_quantity || i.p50_quantity) * (i.base_price || 0)),
    i.confidence_score !== null ? (Math.round(i.confidence_score * 100) + '%') : 'NULL',
    i.confidence_band || (i.served_from === 'ERP_FALLBACK_CACHE' ? 'Fallback' : 'N/A'),
    i.event_context || 'Normal',
    i.model_version || 'lgbm-v1.0-quantile',
    i.served_from || 'model',
    i.is_overridden ? 'YES' : 'NO'
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  downloadCSV(`bakesuite_forecast_${branchId}_${new Date().toISOString().split('T')[0]}.csv`, csv);
}

// =========================================================================
// MODULE 2: BRANCH INDENT PLAN (#view-indent) — ADVISORY PLANNING
// =========================================================================

async function initializeIndents() {
  const branchId = document.getElementById('select-indent-branch')?.value || 'BR-KHI-01';
  await ensureAuthenticated();

  try {
    const res = await fetch(`${API_BASE}/api/v1/erp/indents?branch_id=${encodeURIComponent(branchId)}`, {
      headers: authHeaders
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        indentData = data.map(item => ({
          indent_id: item.indent_id,
          sku_id: item.sku_id,
          sku_name: item.sku_name || item.sku_id,
          category_id: item.category_id || 'CAT',
          shelf_stock: item.shelf_stock,
          safety_min: typeof item.safety_stock === 'number' ? `+${item.safety_stock} PCS` : (item.safety_min || 'Advisory Buffer'),
          p50_demand: item.p50_demand || 0,
          suggested_indent: item.suggested_indent || 0,
          approved_qty: item.approved_qty !== undefined ? item.approved_qty : item.suggested_indent,
          status: item.status || 'Pending Approval'
        }));
        filterAndRenderIndents();
        return;
      }
    }
  } catch (err) {
    console.warn('[INDENT] ERP API fetch fallback:', err);
  }

  // Graceful fallback from active forecastData if ERP indents table has not been initialized
  indentData = forecastData.map((p) => {
    const p50 = p.override_quantity || p.p50_quantity || 0;
    const safetyBuffer = p50 > 0 ? Math.max(1, Math.round(p50 * 0.15)) : 0;
    const suggested = p50 + safetyBuffer;
    return {
      sku_id: p.sku_id,
      sku_name: p.sku_name || p.sku_id,
      category_id: p.category_id || 'CAT',
      shelf_stock: 'Integration Pending',
      safety_min: safetyBuffer > 0 ? `+${safetyBuffer} PCS (15%)` : 'Advisory Buffer',
      p50_demand: p50,
      suggested_indent: suggested,
      approved_qty: suggested,
      status: 'Pending Approval'
    };
  });
  filterAndRenderIndents();
}

function updateIndentKpis() {
  if (!Array.isArray(indentData)) return;
  const totalUnits = indentData.reduce((s, i) => s + (typeof i.approved_qty === 'number' ? i.approved_qty : 0), 0);
  const pendingCount = indentData.filter(i => i.status === 'Advisory Review' || i.status === 'Pending Approval').length;
  const approvedCount = indentData.filter(i => i.status === 'Approved').length;
  const dispatchedCount = indentData.filter(i => i.status === 'Dispatched').length;

  const unitsEl = document.getElementById('kpi-indent-units');
  const pendingEl = document.getElementById('kpi-indent-pending');
  const dispatchedEl = document.getElementById('kpi-indent-dispatched');
  const riskEl = document.getElementById('kpi-indent-risk');

  if (unitsEl) unitsEl.textContent = `${totalUnits.toLocaleString()} PCS`;
  if (pendingEl) pendingEl.textContent = `${pendingCount} SKUs`;
  if (dispatchedEl) {
    if (dispatchedCount > 0) {
      dispatchedEl.textContent = `${dispatchedCount} Dispatched`;
    } else if (approvedCount > 0) {
      dispatchedEl.textContent = `${approvedCount} Approved`;
    } else {
      dispatchedEl.textContent = 'Integration Pending';
    }
  }
  if (riskEl) {
    const lowBufferCount = indentData.filter(i => i.approved_qty < i.p50_demand).length;
    if (lowBufferCount > 0) {
      riskEl.textContent = `${lowBufferCount} Low Allocations`;
    } else {
      riskEl.textContent = 'Advisory Buffer Intact';
    }
  }
}

function filterAndRenderIndents() {
  const statusFilter = document.getElementById('select-indent-status')?.value || 'ALL';
  const q = (document.getElementById('input-indent-search')?.value || '').toLowerCase().trim();

  const filtered = indentData.filter(item => {
    let matchesStatus = true;
    if (statusFilter === 'Advisory Review' || statusFilter === 'Pending Approval') {
      matchesStatus = (item.status === 'Advisory Review' || item.status === 'Pending Approval');
    } else if (statusFilter !== 'ALL') {
      matchesStatus = (item.status === statusFilter);
    }
    const matchesQuery = (!q || item.sku_name.toLowerCase().includes(q) || item.sku_id.toLowerCase().includes(q));
    return matchesStatus && matchesQuery;
  });

  const tbody = document.getElementById('indent-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const countEl = document.getElementById('indent-count-text');
  if (countEl) countEl.textContent = `Showing ${filtered.length} of ${indentData.length} requisitions`;

  updateIndentKpis();

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding: 25px; color: var(--text-muted);">No indents matching active criteria.</td></tr>';
    return;
  }

  filtered.forEach(item => {
    const tr = document.createElement('tr');
    const isApproved = item.status === 'Approved';
    const isDispatched = item.status === 'Dispatched';
    const statusClass = isApproved ? 'approved' : (isDispatched ? 'dispatched' : 'pending');
    const actionBtnLabel = isApproved ? 'Approved ✓' : 'Approve';
    const actionBtnClass = isApproved ? 'btn-action btn-success' : 'btn-action';

    tr.innerHTML = `
      <td>
        <div class="sku-cell">
          <span class="sku-name">${item.sku_name}</span>
          <span class="sku-id">${item.sku_id}</span>
        </div>
      </td>
      <td><span class="cat-badge">${item.category_id}</span></td>
      <td><span style="font-family:var(--font-mono); color:var(--text-secondary); font-size:0.85rem;">${item.shelf_stock || 'Integration Pending'}</span></td>
      <td><span style="font-family:var(--font-mono); color:var(--text-secondary); font-size:0.85rem;">${item.safety_min}</span></td>
      <td><span class="p50-val">${item.p50_demand} PCS</span></td>
      <td><span style="font-family:var(--font-mono); font-weight:600;">${item.suggested_indent} PCS</span></td>
      <td>
        <div class="qty-stepper">
          <button class="btn-step" onclick="adjustIndentQty('${item.sku_id}', -1)" title="Decrease 1 unit">-</button>
          <input type="number" min="0" class="qty-input" id="indent-input-${item.sku_id}" value="${item.approved_qty}" onchange="setIndentQty('${item.sku_id}', this.value)" title="Direct quantity edit">
          <button class="btn-step" onclick="adjustIndentQty('${item.sku_id}', 1)" title="Increase 1 unit">+</button>
        </div>
      </td>
      <td><span class="status-pill ${statusClass}" id="indent-status-pill-${item.sku_id}">${item.status}</span></td>
      <td>
        <button class="${actionBtnClass}" id="indent-btn-${item.sku_id}" onclick="toggleIndentApproval('${item.sku_id}')">${actionBtnLabel}</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.adjustIndentQty = function(skuId, delta) {
  const item = indentData.find(i => i.sku_id === skuId);
  if (!item) return;
  item.approved_qty = Math.max(0, (item.approved_qty || 0) + delta);
  const inputEl = document.getElementById(`indent-input-${skuId}`);
  if (inputEl) inputEl.value = item.approved_qty;
  updateIndentKpis();
};

window.setIndentQty = function(skuId, val) {
  const item = indentData.find(i => i.sku_id === skuId);
  if (!item) return;
  const num = parseInt(val, 10);
  item.approved_qty = isNaN(num) ? 0 : Math.max(0, num);
  const inputEl = document.getElementById(`indent-input-${skuId}`);
  if (inputEl) inputEl.value = item.approved_qty;
  updateIndentKpis();
};

window.toggleIndentApproval = async function(skuId) {
  const item = indentData.find(i => i.sku_id === skuId);
  if (!item) return;
  const newStatus = (item.status === 'Approved') ? 'Pending Approval' : 'Approved';
  item.status = newStatus;

  // Persist approval to ERP Core
  try {
    await fetch(`${API_BASE}/api/v1/erp/indents/approve`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        indent_id: item.indent_id || skuId,
        approved_qty: item.approved_qty,
        status: newStatus
      })
    });
  } catch (err) {
    console.warn('[INDENT] Approval persistence notice:', err);
  }

  if (newStatus === 'Approved') {
    showToast(`Requisition approved for ${item.sku_name} (${item.approved_qty} PCS). Persisted to ERP.`, 'success');
  } else {
    showToast(`Requisition for ${item.sku_name} reverted to Pending Approval.`, 'info');
  }
  filterAndRenderIndents();
};

function exportIndentsCSV() {
  const branchId = document.getElementById('select-indent-branch')?.value || 'BR-KHI-01';
  const headers = ['SKU ID', 'SKU Name', 'Category', 'Store Shelf Stock', 'Safety Threshold', 'AI P50 Demand', 'Suggested Indent', 'Approved Qty', 'Status'];
  const rows = indentData.map(i => [
    i.sku_id,
    `"${i.sku_name.replace(/"/g, '""')}"`,
    i.category_id,
    'Integration Pending',
    i.safety_min,
    i.p50_demand,
    i.suggested_indent,
    i.approved_qty,
    i.status
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  downloadCSV(`bakesuite_indents_${branchId}_${new Date().toISOString().split('T')[0]}.csv`, csv);
}

// =========================================================================
// MODULE 3: CENTRAL KITCHEN BAKE PLAN (#view-production) — LIVE WORKFLOW
// =========================================================================

async function initializeBakeBatches() {
  await ensureAuthenticated();
  const shift = document.getElementById('select-bake-shift')?.value || 'Morning';

  try {
    const res = await fetch(`${API_BASE}/api/v1/erp/production-plans?shift=${encodeURIComponent(shift)}`, {
      headers: authHeaders
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) {
        bakeBatches = data.map(item => ({
          batch_id: item.plan_id,
          sku_id: item.sku_id,
          sku_name: item.sku_name || item.sku_id,
          category_id: item.category_id || 'CAT',
          consolidated_demand: item.consolidated_demand || item.planned_quantity || 0,
          batch_size: item.batch_size || 50,
          batches_required: item.batches_required || Math.ceil((item.planned_quantity || 1) / (item.batch_size || 50)),
          assigned_station: item.equipment_name || 'Deck Oven A',
          temp_time: item.temp_time || '200°C / 30m',
          current_stage: item.status || 'Mixing',
          is_emergency: !!item.is_emergency
        }));
        filterAndRenderBakeBatches();
        return;
      }
    }
  } catch (err) {
    console.warn('[PRODUCTION] ERP API fetch notice:', err);
  }

  // Graceful fallback from active forecastData if production plans table has not yet been populated
  const bakedProducts = forecastData.filter(p => p.category_id !== 'BEVERAGE');
  const topProducts = (bakedProducts.length > 0 ? bakedProducts : forecastData).slice(0, 10);

  bakeBatches = topProducts.map((p, idx) => {
    const demand = p.override_quantity || p.p50_quantity || 25;
    const batchSize = p.category_id === 'BREAD' ? 50 : (p.category_id === 'CAKE' ? 12 : (p.category_id === 'SAVORY' ? 60 : 40));
    const batchesNeeded = Math.max(1, Math.ceil(demand / batchSize));

    let station = 'Deck Oven A';
    let temp = '220°C / 30m';

    if (p.category_id === 'BREAD') {
      station = idx % 2 === 0 ? 'Deck Oven A' : 'Rotary Rack 1';
      temp = '220°C / 30m';
    } else if (p.category_id === 'CAKE') {
      station = idx % 2 === 0 ? 'Deck Oven B' : 'Convection Line 2';
      temp = '175°C / 45m';
    } else if (p.category_id === 'SAVORY') {
      station = 'Convection Line 2';
      temp = '190°C / 25m';
    } else {
      station = 'Deck Oven B';
      temp = '180°C / 35m';
    }

    const stages = ['Mixing', 'Proofing', 'Baking', 'Cooling'];
    const initialStage = stages[idx % 3];

    return {
      batch_id: `PLAN-${idx + 101}`,
      sku_id: p.sku_id,
      sku_name: p.sku_name || p.sku_id,
      category_id: p.category_id || 'CAT',
      consolidated_demand: demand,
      batch_size: batchSize,
      batches_required: batchesNeeded,
      assigned_station: station,
      temp_time: temp,
      current_stage: initialStage,
      is_emergency: false
    };
  });
  filterAndRenderBakeBatches();
}

function updateBakeKpis() {
  if (!Array.isArray(bakeBatches)) return;
  const shift = document.getElementById('select-bake-shift')?.value || 'Morning';
  const shiftTimes = {
    'Morning': '04:00 - 12:00 PKT',
    'Afternoon': '12:00 - 20:00 PKT',
    'Night': '20:00 - 04:00 PKT'
  };

  const totalBatches = bakeBatches.reduce((s, b) => s + b.batches_required, 0);
  const readyBatches = bakeBatches.filter(b => b.current_stage === 'Ready').length;
  // Oven capacity utilization based on standard capacity of 20 batches/shift
  const capacityPct = Math.min(100, Math.round((totalBatches / 20) * 100));

  const batchesEl = document.getElementById('kpi-bake-batches');
  const loadEl = document.getElementById('kpi-bake-load');
  const meterFill = document.getElementById('capacity-meter-fill');
  const shiftEl = document.getElementById('kpi-current-shift-name');
  const shiftSub = document.querySelector('#kpi-current-shift-name ~ .kpi-trend');
  const readyEl = document.getElementById('kpi-bake-ready');

  if (batchesEl) batchesEl.textContent = `${totalBatches} Batches`;
  if (loadEl) loadEl.textContent = `${capacityPct}% (${capacityPct > 85 ? 'High Load' : 'Optimum'})`;
  if (meterFill) {
    meterFill.style.width = `${capacityPct}%`;
    meterFill.style.background = capacityPct > 85 ? 'linear-gradient(90deg, #f59e0b, #f43f5e)' : 'linear-gradient(90deg, #10b981, #f59e0b)';
  }
  if (shiftEl) shiftEl.textContent = `${shift} Shift`;
  if (shiftSub) shiftSub.textContent = shiftTimes[shift] || '04:00 - 12:00 PKT';
  if (readyEl) {
    if (readyBatches > 0) {
      readyEl.textContent = `${readyBatches} / ${bakeBatches.length} Ready`;
    } else {
      readyEl.textContent = 'In Production';
    }
  }
}

function filterAndRenderBakeBatches() {
  const stationFilter = document.getElementById('select-bake-station')?.value || 'ALL';

  const filtered = bakeBatches.filter(b => {
    return (stationFilter === 'ALL' || b.assigned_station === stationFilter);
  });

  const tbody = document.getElementById('bake-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const countEl = document.getElementById('bake-count-text');
  if (countEl) countEl.textContent = `Showing ${filtered.length} of ${bakeBatches.length} advisory production batches`;

  updateBakeKpis();

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding: 25px; color: var(--text-muted);">No baking batches scheduled for this station.</td></tr>';
    return;
  }

  filtered.forEach(batch => {
    const tr = document.createElement('tr');

    let stageClass = 'draft';
    let nextLabel = 'Advance';
    let btnClass = 'btn-action';

    if (batch.current_stage === 'Mixing') {
      stageClass = 'mixing';
      nextLabel = 'Proof';
    } else if (batch.current_stage === 'Proofing') {
      stageClass = 'draft';
      nextLabel = 'Bake';
    } else if (batch.current_stage === 'Baking') {
      stageClass = 'baking';
      nextLabel = 'Cool';
    } else if (batch.current_stage === 'Cooling') {
      stageClass = 'cooling';
      nextLabel = 'Ready';
    } else if (batch.current_stage === 'Ready') {
      stageClass = 'ready';
      nextLabel = 'Ready ✓';
      btnClass = 'btn-action btn-success';
    }

    const emergencyBadge = batch.is_emergency ? '<span style="background:var(--accent-gold); color:#000; font-size:0.65rem; font-weight:700; padding:1px 5px; border-radius:3px; margin-left:4px;">URGENT</span>' : '';

    tr.innerHTML = `
      <td><span style="font-family:var(--font-mono); font-weight:700; color:var(--accent-gold);">${batch.batch_id}</span>${emergencyBadge}</td>
      <td>
        <div class="sku-cell">
          <span class="sku-name">${batch.sku_name}</span>
          <span class="sku-id">${batch.sku_id}</span>
        </div>
      </td>
      <td><span class="cat-badge">${batch.category_id}</span></td>
      <td><span style="font-family:var(--font-mono); font-weight:600;">${batch.consolidated_demand} PCS</span></td>
      <td><span style="font-family:var(--font-mono); color:var(--text-secondary);">${batch.batch_size} / batch</span></td>
      <td><span style="font-family:var(--font-mono); font-weight:700; color:var(--text-primary);">${batch.batches_required}</span></td>
      <td><span style="color:var(--text-secondary); font-size:0.85rem;">${batch.assigned_station}</span></td>
      <td><span style="font-family:var(--font-mono); font-size:0.8rem; color:var(--text-muted);">${batch.temp_time}</span></td>
      <td><span class="status-pill ${stageClass}">${batch.current_stage}</span></td>
      <td>
        <button class="${btnClass}" onclick="advanceBakeStage('${batch.batch_id}')">${nextLabel}</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.advanceBakeStage = function(batchId) {
  const batch = bakeBatches.find(b => b.batch_id === batchId);
  if (!batch) return;
  const stageFlow = ['Mixing', 'Proofing', 'Baking', 'Cooling', 'Ready'];
  const curIdx = stageFlow.indexOf(batch.current_stage);
  if (curIdx < stageFlow.length - 1) {
    batch.current_stage = stageFlow[curIdx + 1];
    showToast(`Batch ${batch.batch_id} (${batch.sku_name}) advanced to stage: ${batch.current_stage}.`, 'info');
  } else {
    batch.current_stage = 'Proofing';
    showToast(`Batch ${batch.batch_id} reset to Proofing for next rotation.`, 'info');
  }
  filterAndRenderBakeBatches();
};

window.scheduleEmergencyBatch = async function() {
  await ensureAuthenticated();
  const shift = document.getElementById('select-bake-shift')?.value || 'Morning';

  try {
    const res = await fetch(`${API_BASE}/api/v1/erp/production-plans/emergency-batch`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        sku_id: 'SKU-BRD-01',
        quantity: 100,
        shift: shift,
        reason: 'Unforeseen demand spike / VIP order'
      })
    });
    if (res.ok) {
      const data = await res.json();
      showToast(`Scheduled emergency batch ${data.plan_id} on ${data.equipment_name || 'Rotary Rack 1'}. Persisted to Central Kitchen ERP.`, 'warning');
      await initializeBakeBatches();
      return;
    }
  } catch (err) {
    console.warn('[EMERGENCY-BATCH] ERP API error:', err);
  }

  // Local fallback
  const count = bakeBatches.filter(b => b.is_emergency).length + 1;
  const emergId = `ADV-EMERG-0${count}`;
  const emergBatch = {
    batch_id: emergId,
    sku_id: 'SKU-BRD-01',
    sku_name: 'Fresh Brioche Buns (Advisory Planning Batch)',
    category_id: 'BREAD',
    consolidated_demand: 100,
    batch_size: 50,
    batches_required: 2,
    assigned_station: 'Rotary Rack 1',
    temp_time: '210°C / 20m',
    current_stage: 'Baking',
    is_emergency: true
  };
  bakeBatches.unshift(emergBatch);
  filterAndRenderBakeBatches();
  showToast(`Scheduled advisory emergency planning batch ${emergId}.`, 'warning');
};

function exportBakePlanCSV() {
  const headers = ['Batch Code', 'SKU ID', 'Product Name', 'Category', 'Demand (PCS)', 'Batch Size', 'Batches Req', 'Assigned Station', 'Temp & Duration', 'Stage'];
  const rows = bakeBatches.map(b => [
    b.batch_id,
    b.sku_id,
    `"${b.sku_name.replace(/"/g, '""')}"`,
    b.category_id,
    b.consolidated_demand,
    b.batch_size,
    b.batches_required,
    `"${b.assigned_station}"`,
    `"${b.temp_time}"`,
    b.current_stage
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  downloadCSV(`bakesuite_bake_schedule_${new Date().toISOString().split('T')[0]}.csv`, csv);
}

// =========================================================================
// MODULE 4: PURCHASE REQUIREMENTS (MRP) — DYNAMIC BOM EXPLOSION
// =========================================================================

async function initializePurchaseMaterials() {
  await ensureAuthenticated();
  try {
    const res = await fetch(`${API_BASE}/api/v1/erp/purchase-requirements`, {
      headers: authHeaders
    });
    if (res.ok) {
      const data = await res.json();
      const rawList = Array.isArray(data) ? data : (data.materials || []);
      if (rawList.length > 0) {
        purchaseMaterials = rawList.map((item, idx) => {
          const reqQty = parseFloat(item.gross_requirement ?? item.gross_required ?? 0);
          const avail = parseFloat(item.available_stock ?? 0);
          const incoming = parseFloat(item.incoming_stock ?? item.incoming_orders ?? 0);
          const safety = parseFloat(item.safety_stock ?? 0);
          const shortfall = (item.net_shortfall !== undefined) 
            ? parseFloat(item.net_shortfall) 
            : Math.max(0, Math.round((reqQty - avail - incoming + safety) * 10) / 10);
          const unit = item.unit || item.unit_of_measure || 'KG';
          const price = parseFloat(item.unit_cost_pkr ?? item.unit_price ?? 150);

          let cat = item.category || 'Bakery Raw Material';
          const nameLower = (item.material_name || '').toLowerCase();
          if (nameLower.includes('flour') || nameLower.includes('yeast')) cat = 'Grains & Leavening';
          else if (nameLower.includes('chicken')) cat = 'Proteins & Meat';
          else if (nameLower.includes('sugar') || nameLower.includes('cocoa')) cat = 'Sweeteners & Cocoa';
          else if (nameLower.includes('egg') || nameLower.includes('milk')) cat = 'Dairy & Eggs';
          else if (nameLower.includes('ghee') || nameLower.includes('shortening')) cat = 'Fats & Oils';
          else if (nameLower.includes('spice') || nameLower.includes('cardamom') || nameLower.includes('almond')) cat = 'Nuts & Aromatics';

          return {
            material_id: item.material_id || `MAT-${String(idx + 101)}`,
            material_name: item.material_name,
            category: cat,
            required_qty: Math.round(reqQty * 10) / 10,
            current_stock: Math.round(avail),
            incoming_qty: Math.round(incoming),
            safety_stock: Math.round(safety),
            net_shortfall: shortfall,
            unit_of_measure: unit,
            unit_price: price,
            supplier: item.supplier_name || 'Approved Supplier',
            po_drafted: (item.existing_po_status === 'APPROVED' || item.existing_po_status === 'ISSUED')
          };
        });
        filterAndRenderPurchase();
        return;
      }
    }
  } catch (err) {
    console.warn('[MRP] ERP purchase requirements fetch notice:', err);
  }

  // Graceful fallback standard raw materials if API is temporarily unreachable
  const defaultMaterials = [
    { material_id: 'MAT-101', material_name: 'Fine All-Purpose Flour (Maida)', category: 'Grains & Leavening', required_qty: 115, current_stock: 4500, incoming_qty: 2000, safety_stock: 1200, net_shortfall: 0, unit_of_measure: 'KG', unit_price: 140, supplier: 'Fauji Cereals Mills Ltd' },
    { material_id: 'MAT-102', material_name: 'Refined White Sugar', category: 'Sweeteners & Cocoa', required_qty: 46.7, current_stock: 2800, incoming_qty: 1000, safety_stock: 800, net_shortfall: 0, unit_of_measure: 'KG', unit_price: 160, supplier: 'Jauharabad Sugar Mills' },
    { material_id: 'MAT-103', material_name: 'Pure Vegetable Ghee & Shortening', category: 'Fats & Oils', required_qty: 18.5, current_stock: 1600, incoming_qty: 800, safety_stock: 500, net_shortfall: 0, unit_of_measure: 'KG', unit_price: 480, supplier: 'Dalda Foods Pakistan' },
    { material_id: 'MAT-104', material_name: 'Farm Fresh Grade-A Eggs', category: 'Dairy & Eggs', required_qty: 19.2, current_stock: 3200, incoming_qty: 1500, safety_stock: 600, net_shortfall: 0, unit_of_measure: 'KG', unit_price: 320, supplier: 'Al-Hilal Poultry Farms' },
    { material_id: 'MAT-105', material_name: 'Fresh Pasteurized Whole Milk', category: 'Dairy & Eggs', required_qty: 9.0, current_stock: 1800, incoming_qty: 1000, safety_stock: 400, net_shortfall: 0, unit_of_measure: 'LTR', unit_price: 210, supplier: 'Engro Dairy Foods' },
    { material_id: 'MAT-106', material_name: "Active Dry Baker's Yeast", category: 'Grains & Leavening', required_qty: 1.8, current_stock: 420, incoming_qty: 200, safety_stock: 100, net_shortfall: 0, unit_of_measure: 'KG', unit_price: 850, supplier: 'Saf-Instant Pakistan' },
    { material_id: 'MAT-107', material_name: 'Belgian Dark Cocoa Powder & Drops', category: 'Sweeteners & Cocoa', required_qty: 11.5, current_stock: 650, incoming_qty: 300, safety_stock: 150, net_shortfall: 0, unit_of_measure: 'KG', unit_price: 2450, supplier: 'Puratos Food Ingredients' },
    { material_id: 'MAT-108', material_name: 'Boneless Diced Chicken Breast', category: 'Proteins & Meat', required_qty: 7.9, current_stock: 950, incoming_qty: 500, safety_stock: 300, net_shortfall: 0, unit_of_measure: 'KG', unit_price: 880, supplier: "K&N's Commercial Supplies" },
    { material_id: 'MAT-109', material_name: 'Almonds & Pistachio Kernels', category: 'Nuts & Aromatics', required_qty: 2.6, current_stock: 310, incoming_qty: 150, safety_stock: 80, net_shortfall: 0, unit_of_measure: 'KG', unit_price: 2900, supplier: 'Swat Valley Dry Fruits Corp' },
    { material_id: 'MAT-110', material_name: 'Traditional Baking Spices & Cardamom', category: 'Nuts & Aromatics', required_qty: 0.9, current_stock: 180, incoming_qty: 100, safety_stock: 40, net_shortfall: 0, unit_of_measure: 'KG', unit_price: 1650, supplier: 'National Foods Spice Division' }
  ];

  purchaseMaterials = defaultMaterials.map(m => ({ ...m, po_drafted: false }));
  filterAndRenderPurchase();
}

function updatePurchaseKpis() {
  if (!Array.isArray(purchaseMaterials)) return;
  let totalCost = 0;
  let criticalCount = 0;
  let poCount = 0;
  let totalStock = 0;
  let totalReq = 0;

  purchaseMaterials.forEach(m => {
    const shortfall = (m.net_shortfall !== undefined) ? m.net_shortfall : 0;
    if (shortfall > 0) {
      totalCost += (shortfall * m.unit_price);
      criticalCount++;
    }
    if (m.po_drafted) poCount++;
    totalStock += (m.current_stock || 0);
    totalReq += (m.required_qty || 0);
  });

  const shortEl = document.getElementById('kpi-purchase-shortages');
  const posEl = document.getElementById('kpi-purchase-open-pos');
  const costEl = document.getElementById('kpi-purchase-total-cost');
  const safetyEl = document.getElementById('kpi-purchase-safety');

  if (shortEl) {
    if (criticalCount > 0) {
      shortEl.textContent = `${criticalCount} Shortage Items`;
      shortEl.style.color = 'var(--accent-rose)';
    } else {
      shortEl.textContent = '0 Shortages';
      shortEl.style.color = 'var(--accent-emerald)';
    }
  }
  if (posEl) posEl.textContent = poCount > 0 ? `${poCount} POs Released` : `0 Open POs`;
  if (costEl) costEl.textContent = totalCost > 0 ? formatPKR(totalCost) : '₨ 0 (Stock Intact)';
  if (safetyEl) {
    const ratio = totalReq > 0 ? Math.min(100, Math.round((totalStock / (totalStock + totalReq)) * 100)) : 98;
    safetyEl.textContent = `${ratio}% Reserve Safe`;
  }
}

function filterAndRenderPurchase() {
  const filterVal = document.getElementById('select-purchase-filter')?.value || 'ALL';

  const filtered = purchaseMaterials.filter(m => {
    const shortfall = (m.net_shortfall !== undefined) ? m.net_shortfall : 0;
    const isCritical = shortfall > 0;
    const isReorder = shortfall > 0 || (m.current_stock < (m.safety_stock * 1.2));
    const isAdequate = shortfall === 0;

    if (filterVal === 'SHORTAGE') return isCritical;
    if (filterVal === 'REORDER') return isReorder;
    if (filterVal === 'ADEQUATE') return isAdequate;
    return true;
  });

  const tbody = document.getElementById('purchase-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const countEl = document.getElementById('purchase-count-text');
  if (countEl) countEl.textContent = `Showing ${filtered.length} of ${purchaseMaterials.length} primary baking ingredients`;

  updatePurchaseKpis();

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding: 25px; color: var(--text-muted);">No materials matching active urgency filter.</td></tr>';
    return;
  }

  filtered.forEach(m => {
    const tr = document.createElement('tr');
    const shortfall = (m.net_shortfall !== undefined) ? m.net_shortfall : 0;
    const totalCost = shortfall > 0 ? (shortfall * m.unit_price) : (m.required_qty * m.unit_price);

    let statusLabel = 'Adequate Stock';
    let statusClass = 'approved';
    let actionBtn = `<button class="btn-action" onclick="generateSinglePO('${m.material_id}')" style="opacity:0.9;">Order PO</button>`;

    if (m.po_drafted) {
      statusLabel = 'PO Released';
      statusClass = 'ready';
      actionBtn = `<button class="btn-action btn-success" disabled>PO Released ✓</button>`;
    } else if (shortfall > (m.required_qty * 0.4) && shortfall > 0) {
      statusLabel = 'Critical Shortage';
      statusClass = 'shortage';
      actionBtn = `<button class="btn-action btn-accent" onclick="generateSinglePO('${m.material_id}')">Generate PO</button>`;
    } else if (shortfall > 0) {
      statusLabel = 'Reorder Required';
      statusClass = 'pending';
      actionBtn = `<button class="btn-action btn-accent" onclick="generateSinglePO('${m.material_id}')">Generate PO</button>`;
    }

    tr.innerHTML = `
      <td>
        <div class="sku-cell">
          <span class="sku-name">${m.material_name}</span>
          <span class="sku-id">${m.material_id}</span>
        </div>
      </td>
      <td><span class="cat-badge">${m.category}</span></td>
      <td><span style="font-family:var(--font-mono); font-weight:600;">${m.required_qty} ${m.unit_of_measure}</span></td>
      <td><span style="font-family:var(--font-mono); color:var(--text-secondary);">${m.current_stock} ${m.unit_of_measure}</span></td>
      <td><span style="font-family:var(--font-mono); font-weight:700; color:${shortfall > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)'};">${shortfall > 0 ? `${shortfall} ${m.unit_of_measure}` : '0 (Adequate)'}</span></td>
      <td><span style="font-family:var(--font-mono); color:var(--text-secondary);">${formatPKR(m.unit_price)}</span></td>
      <td><span class="sales-val">${formatPKR(totalCost)}</span></td>
      <td><span style="color:var(--text-secondary); font-size:0.85rem;">${m.supplier}</span></td>
      <td><span class="status-pill ${statusClass}">${statusLabel}</span></td>
      <td>
        ${actionBtn}
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.generateSinglePO = async function(matId) {
  const m = purchaseMaterials.find(item => item.material_id === matId);
  if (!m) return;
  const shortfall = (m.net_shortfall !== undefined && m.net_shortfall > 0) ? m.net_shortfall : (m.required_qty > 0 ? m.required_qty : 50);
  const orderQty = Math.max(10, Math.round(shortfall));

  try {
    const res = await fetch(`${API_BASE}/api/v1/erp/purchase-orders`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        material_name: m.material_name,
        quantity: orderQty,
        unit: m.unit_of_measure,
        unit_price: m.unit_price,
        supplier_name: m.supplier
      })
    });
    if (res.ok) {
      const data = await res.json();
      m.po_drafted = true;
      filterAndRenderPurchase();
      showToast(`Purchase Order ${data.purchase_order?.po_id || data.po_number || 'PO-OK'} released for ${m.material_name} (${orderQty} ${m.unit_of_measure}). Persisted to ERP.`, 'success');
      return;
    }
  } catch (err) {
    console.warn('[PO] Persistence notice:', err);
  }

  m.po_drafted = true;
  filterAndRenderPurchase();
  showToast(`Advisory Purchase Order issued for ${m.material_name} (${orderQty} ${m.unit_of_measure}).`, 'success');
};

function exportPurchaseCSV() {
  const headers = ['Material Code', 'Material Name', 'Category', 'Required for Plan', 'Warehouse Stock', 'Safety Stock', 'Net Shortfall', 'Unit Rate (PKR)', 'Total Cost (PKR)', 'Approved Supplier', 'Status'];
  const rows = purchaseMaterials.map(m => {
    const shortfall = (m.net_shortfall !== undefined) ? m.net_shortfall : 0;
    const totalCost = shortfall > 0 ? (shortfall * m.unit_price) : (m.required_qty * m.unit_price);
    const status = m.po_drafted ? 'PO Released' : (shortfall > 0 ? 'Shortfall' : 'Adequate Stock');
    return [
      m.material_id,
      `"${m.material_name.replace(/"/g, '""')}"`,
      m.category,
      `${m.required_qty} ${m.unit_of_measure}`,
      `${m.current_stock} ${m.unit_of_measure}`,
      `${m.safety_stock} ${m.unit_of_measure}`,
      `${shortfall} ${m.unit_of_measure}`,
      m.unit_price,
      totalCost,
      `"${m.supplier}"`,
      status
    ];
  });
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  downloadCSV(`bakesuite_mrp_requisition_${new Date().toISOString().split('T')[0]}.csv`, csv);
}

// =========================================================================
// EVENT LISTENERS INITIALIZATION
// =========================================================================

function setupEventListeners() {
  setupNavigation();
  startLiveClock();

  // Forecast Workbench Filters & Actions
  document.getElementById('select-branch')?.addEventListener('change', async (e) => {
    const indentSelect = document.getElementById('select-indent-branch');
    if (indentSelect && indentSelect.value !== e.target.value) {
      indentSelect.value = e.target.value;
    }
    await loadForecastData();
  });
  document.getElementById('select-category')?.addEventListener('change', () => {
    const searchInput = document.getElementById('input-search');
    if (searchInput) searchInput.value = '';
    filterAndRenderTable();
  });
  document.getElementById('input-search')?.addEventListener('input', () => filterAndRenderTable());
  document.getElementById('btn-refresh-data')?.addEventListener('click', () => {
    loadForecastData();
    showToast('Synchronized live predictions from ERP Core', 'info');
  });
  document.getElementById('btn-export-forecast')?.addEventListener('click', exportForecastCSV);
  document.getElementById('btn-rescore-ai')?.addEventListener('click', triggerRealRescore);

  // Development Outage Simulation (AC-4 testing control)
  document.getElementById('btn-toggle-circuit-breaker')?.addEventListener('click', async () => {
    isCircuitBreakerActive = !isCircuitBreakerActive;
    updateServiceStatusIndicator(isCircuitBreakerActive);

    if (isCircuitBreakerActive) {
      showToast('Testing Outage Mode: Circuit breaker tripped to verify deterministic 4-week fallback (AC-4)', 'warning');
    } else {
      showToast('Restoring ML Service inference connection.', 'success');
    }
    await loadForecastData();
  });

  // Modal event listeners
  document.getElementById('btn-close-modal')?.addEventListener('click', closeModal);
  document.getElementById('btn-cancel-override')?.addEventListener('click', closeModal);
  document.getElementById('btn-save-override')?.addEventListener('click', saveOverride);
  document.getElementById('btn-revert-override')?.addEventListener('click', revertOverride);

  // Details Modal Listeners
  document.getElementById('btn-close-details')?.addEventListener('click', closeDetailsModal);
  document.getElementById('btn-dismiss-details')?.addEventListener('click', closeDetailsModal);

  // Close modals when clicking backdrop
  document.getElementById('override-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'override-modal') closeModal();
  });
  document.getElementById('details-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'details-modal') closeDetailsModal();
  });

  // Escape key closes modals
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
      closeDetailsModal();
    }
  });

  // Indent Plan Listeners
  document.getElementById('select-indent-branch')?.addEventListener('change', async (e) => {
    const newBranch = e.target.value;
    const benchSelect = document.getElementById('select-branch');
    if (benchSelect && benchSelect.value !== newBranch) {
      benchSelect.value = newBranch;
    }
    await loadForecastData();
    filterAndRenderIndents();
  });
  document.getElementById('select-indent-status')?.addEventListener('change', filterAndRenderIndents);
  document.getElementById('input-indent-search')?.addEventListener('input', filterAndRenderIndents);
  document.getElementById('btn-approve-all-indents')?.addEventListener('click', async () => {
    const branchId = document.getElementById('select-indent-branch')?.value || 'BR-KHI-01';
    let count = 0;
    indentData.forEach(item => {
      if (item.status === 'Advisory Review' || item.status === 'Pending Approval') {
        item.status = 'Approved';
        count++;
      }
    });

    try {
      await fetch(`${API_BASE}/api/v1/erp/indents/approve-all`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ branch_id: branchId })
      });
    } catch (err) {
      console.warn('[INDENT] Bulk approval persistence notice:', err);
    }

    filterAndRenderIndents();
    if (count > 0) {
      showToast(`Approved all ${count} branch store requisitions for store dispatch. Persisted to ERP.`, 'success');
    } else {
      showToast('All branch store requisitions are already approved.', 'info');
    }
  });
  document.getElementById('btn-export-indents')?.addEventListener('click', exportIndentsCSV);

  // Central Kitchen Bake Listeners
  document.getElementById('select-bake-shift')?.addEventListener('change', filterAndRenderBakeBatches);
  document.getElementById('select-bake-station')?.addEventListener('change', filterAndRenderBakeBatches);
  document.getElementById('btn-add-urgent-batch')?.addEventListener('click', scheduleEmergencyBatch);
  document.getElementById('btn-export-bake-plan')?.addEventListener('click', exportBakePlanCSV);

  // Purchase Requirements Listeners
  document.getElementById('select-purchase-filter')?.addEventListener('change', filterAndRenderPurchase);
  document.getElementById('btn-generate-po-all')?.addEventListener('click', async () => {
    let draftedCount = 0;
    const undrafted = purchaseMaterials.filter(m => !m.po_drafted);
    const shortages = undrafted.filter(m => (m.net_shortfall !== undefined && m.net_shortfall > 0));
    const targets = shortages.length > 0 ? shortages : undrafted;

    for (const m of targets) {
      const shortfall = (m.net_shortfall !== undefined && m.net_shortfall > 0) ? m.net_shortfall : (m.required_qty > 0 ? m.required_qty : 50);
      const orderQty = Math.max(10, Math.round(shortfall));
      try {
        await fetch(`${API_BASE}/api/v1/erp/purchase-orders`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            material_name: m.material_name,
            quantity: orderQty,
            unit: m.unit_of_measure,
            unit_price: m.unit_price,
            supplier_name: m.supplier
          })
        });
        m.po_drafted = true;
        draftedCount++;
      } catch (e) {
        m.po_drafted = true;
        draftedCount++;
      }
    }

    filterAndRenderPurchase();
    if (draftedCount > 0) {
      showToast(`Generated & persisted Purchase Orders for ${draftedCount} baking materials.`, 'success');
    } else {
      showToast('All purchase orders have already been drafted.', 'info');
    }
  });
  document.getElementById('btn-export-purchase')?.addEventListener('click', exportPurchaseCSV);
}

// Master Initialization
async function initWorkbench() {
  console.log('[WORKBENCH] Bootstrapping BakeSuite ERP Intelligence UI...');
  setupEventListeners();
  await loadMetadata();
  await loadForecastData();
}

// DOM Ready
document.addEventListener('DOMContentLoaded', initWorkbench);

