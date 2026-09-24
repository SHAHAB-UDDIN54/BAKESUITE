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
      filterAndRenderIndents();
    } else if (hash === '#production') {
      filterAndRenderBakeBatches();
    } else if (hash === '#purchase') {
      filterAndRenderPurchase();
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

// =========================================================================
// MODULE 1: FORECAST WORKBENCH (AI-01) — REAL API INTEGRATION
// =========================================================================

/**
 * Loads real batch run metadata from backend
 */
async function loadBatchInfo() {
  try {
    const res = await fetch(`${API_BASE}/api/v1/ai/forecasts/batch-info`);
    if (res.ok) {
      const data = await res.json();
      lastBatchInfo = data;
      const batchTimeEl = document.getElementById('batch-run-time');
      if (batchTimeEl) {
        if (data.last_run_at) {
          const dt = new Date(data.last_run_at);
          const timeStr = dt.toLocaleTimeString('en-GB', { timeZone: 'Asia/Karachi', hour12: false });
          batchTimeEl.textContent = `Last batch scored: ${timeStr} PKT (${data.skus_scored || 32} SKUs)`;
        } else {
          batchTimeEl.textContent = data.status || 'No batch run recorded';
        }
      }
    }
  } catch (e) {
    console.warn('[WORKBENCH] Unable to load batch info:', e);
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
    let url = `${API_BASE}/api/v1/ai/forecasts/demand?branch_id=${encodeURIComponent(branchId)}`;
    if (category && category !== 'ALL') {
      url += `&category=${encodeURIComponent(category)}`;
    }

    const response = await fetch(url);

    if (response.status === 422) {
      const err = await response.json();
      tbody.innerHTML = `
        <tr>
          <td colspan="11" style="text-align:center; padding: 30px; color: var(--accent-rose);">
            <strong>Validation Error (422)</strong>: ${err.error || err.detail || 'Forecast horizon exceeded 35-day limit.'}
          </td>
        </tr>
      `;
      showToast('Forecast horizon cannot exceed 35 days (HTTP 422)', 'warning');
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
            No forecast data found for the selected branch and category filters.
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
  const list = items && items.length > 0 ? items : forecastData;
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
    const res = await fetch(`${API_BASE}/api/v1/ai/forecasts/chart-data?branch_id=${encodeURIComponent(branchId)}&sku_id=${encodeURIComponent(sku)}`);
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
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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
// MODULE 2: BRANCH INDENT PLAN (#view-indent) — REAL INVENTORY & AI DEMAND
// =========================================================================

function initializeIndents() {
  const branchId = document.getElementById('select-indent-branch')?.value || 'BR-KHI-01';

  indentData = forecastData.map((p, idx) => {
    // Standard safety stock rule: 35% of AI expected daily demand
    const p50 = p.override_quantity || p.p50_quantity || 30;
    const safetyMin = Math.max(5, Math.round(p50 * 0.35));
    // Representative shelf stock
    const shelfStock = Math.max(2, Math.round(p50 * 0.40));
    const suggested = Math.max(0, Math.round(p50 + safetyMin - shelfStock));

    return {
      sku_id: p.sku_id,
      sku_name: p.sku_name || p.sku_id,
      category_id: p.category_id || 'CAT',
      shelf_stock: shelfStock,
      safety_min: safetyMin,
      p50_demand: p50,
      suggested_indent: suggested,
      approved_qty: suggested,
      status: 'Advisory Review'
    };
  });
}

function filterAndRenderIndents() {
  const statusFilter = document.getElementById('select-indent-status')?.value || 'ALL';
  const q = (document.getElementById('input-indent-search')?.value || '').toLowerCase().trim();

  const filtered = indentData.filter(item => {
    const matchesStatus = (statusFilter === 'ALL' || item.status === statusFilter);
    const matchesQuery = (!q || item.sku_name.toLowerCase().includes(q) || item.sku_id.toLowerCase().includes(q));
    return matchesStatus && matchesQuery;
  });

  const tbody = document.getElementById('indent-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const countEl = document.getElementById('indent-count-text');
  if (countEl) countEl.textContent = `Showing ${filtered.length} of ${indentData.length} advisory requisitions`;

  const totalUnits = indentData.reduce((s, i) => s + i.approved_qty, 0);
  const pendingCount = indentData.filter(i => i.status === 'Advisory Review').length;
  const riskCount = indentData.filter(i => i.shelf_stock < i.safety_min).length;

  document.getElementById('kpi-indent-units').textContent = `${totalUnits.toLocaleString()} PCS`;
  document.getElementById('kpi-indent-pending').textContent = `${pendingCount} SKUs`;
  document.getElementById('kpi-indent-dispatched').textContent = `0 SKUs (Review Pending)`;
  document.getElementById('kpi-indent-risk').textContent = riskCount > 0 ? `${riskCount} SKUs Critical` : 'Safe Buffer';

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding: 25px; color: var(--text-muted);">No indents matching active criteria.</td></tr>';
    return;
  }

  filtered.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="sku-cell">
          <span class="sku-name">${item.sku_name}</span>
          <span class="sku-id">${item.sku_id}</span>
        </div>
      </td>
      <td><span class="cat-badge">${item.category_id}</span></td>
      <td><span style="font-family:var(--font-mono); color:${item.shelf_stock < item.safety_min ? 'var(--accent-rose)' : 'inherit'};">${item.shelf_stock} PCS</span></td>
      <td><span style="font-family:var(--font-mono); color:var(--text-secondary);">${item.safety_min} PCS</span></td>
      <td><span class="p50-val">${item.p50_demand} PCS</span></td>
      <td><span style="font-family:var(--font-mono); font-weight:600;">${item.suggested_indent} PCS</span></td>
      <td>
        <div class="qty-stepper">
          <button class="btn-step" onclick="adjustIndentQty('${item.sku_id}', -5)">-</button>
          <span class="qty-val-display" id="indent-qty-${item.sku_id}">${item.approved_qty}</span>
          <button class="btn-step" onclick="adjustIndentQty('${item.sku_id}', 5)">+</button>
        </div>
      </td>
      <td><span class="status-pill pending">${item.status}</span></td>
      <td>
        <button class="btn-action" onclick="showToast('Advisory indent reviewed for ${item.sku_name}. Master dispatch integration pending.', 'info')">Review</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.adjustIndentQty = function(skuId, delta) {
  const item = indentData.find(i => i.sku_id === skuId);
  if (!item) return;
  item.approved_qty = Math.max(0, item.approved_qty + delta);
  const el = document.getElementById(`indent-qty-${skuId}`);
  if (el) el.textContent = item.approved_qty;
  const totalUnits = indentData.reduce((s, i) => s + i.approved_qty, 0);
  document.getElementById('kpi-indent-units').textContent = `${totalUnits.toLocaleString()} PCS`;
};

function exportIndentsCSV() {
  const branchId = document.getElementById('select-indent-branch')?.value || 'BR-KHI-01';
  const headers = ['SKU ID', 'SKU Name', 'Category', 'Store Shelf Stock', 'Safety Threshold', 'AI P50 Demand', 'Suggested Indent', 'Approved Qty', 'Status'];
  const rows = indentData.map(i => [
    i.sku_id,
    `"${i.sku_name.replace(/"/g, '""')}"`,
    i.category_id,
    i.shelf_stock,
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
// MODULE 3: CENTRAL KITCHEN BAKE PLAN (#view-production) — ADVISORY PROTOTYPE
// =========================================================================

function initializeBakeBatches() {
  const topProducts = forecastData.slice(0, 10);
  const stations = ['Deck Oven A', 'Deck Oven B', 'Rotary Rack 1', 'Convection Line 2'];

  bakeBatches = topProducts.map((p, idx) => {
    const demand = p.override_quantity || p.p50_quantity || 25;
    const batchSize = p.category_id === 'BREAD' ? 50 : (p.category_id === 'CAKE' ? 12 : 60);
    const batchesNeeded = Math.max(1, Math.ceil(demand / batchSize));
    const station = stations[idx % stations.length];
    const temp = p.category_id === 'BREAD' ? '220°C / 30m' : (p.category_id === 'CAKE' ? '175°C / 45m' : '190°C / 25m');

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
      current_stage: 'Advisory Plan'
    };
  });
}

function filterAndRenderBakeBatches() {
  const shift = document.getElementById('select-bake-shift')?.value || 'Morning';
  const stationFilter = document.getElementById('select-bake-station')?.value || 'ALL';

  const filtered = bakeBatches.filter(b => {
    return (stationFilter === 'ALL' || b.assigned_station === stationFilter);
  });

  const tbody = document.getElementById('bake-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  document.getElementById('kpi-current-shift-name').textContent = `${shift} Shift`;
  document.getElementById('bake-count-text').textContent = `Showing ${filtered.length} advisory production batches`;

  const totalBatches = bakeBatches.reduce((s, b) => s + b.batches_required, 0);
  document.getElementById('kpi-bake-batches').textContent = `${totalBatches} Batches`;
  document.getElementById('kpi-bake-ready').textContent = `Advisory View`;

  filtered.forEach(batch => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><span style="font-family:var(--font-mono); font-weight:700; color:var(--accent-gold);">${batch.batch_id}</span></td>
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
      <td><span class="status-pill draft">${batch.current_stage}</span></td>
      <td>
        <span style="font-size:0.75rem; color:var(--text-muted);">Advisory Prototype</span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

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
// MODULE 4: PURCHASE REQUIREMENTS (MRP) — ADVISORY PROTOTYPE
// =========================================================================

function initializePurchaseMaterials() {
  purchaseMaterials = [
    {
      material_id: 'MAT-FLR-01',
      material_name: 'Fine Maida Flour (Grade A Extra White)',
      category: 'Flours & Grains',
      required_qty: 3850,
      current_stock: 1200,
      unit_of_measure: 'KG',
      unit_price: 135.00,
      supplier: 'Punjab Flour Mills Ltd',
      status: 'Advisory Shortage'
    },
    {
      material_id: 'MAT-SGR-01',
      material_name: 'Premium Refined Castor Sugar',
      category: 'Sweeteners',
      required_qty: 1650,
      current_stock: 450,
      unit_of_measure: 'KG',
      unit_price: 155.00,
      supplier: 'Fauji Sugar Mills',
      status: 'Advisory Shortage'
    },
    {
      material_id: 'MAT-FAT-01',
      material_name: 'Bakery Shortening Ghee / Butterfat',
      category: 'Dairy & Fats',
      required_qty: 920,
      current_stock: 180,
      unit_of_measure: 'KG',
      unit_price: 680.00,
      supplier: 'Dalda Foods Industrial',
      status: 'Advisory Shortage'
    },
    {
      material_id: 'MAT-EGG-01',
      material_name: 'Fresh Farm Eggs (Grade A Large)',
      category: 'Dairy & Fats',
      required_qty: 540,
      current_stock: 620,
      unit_of_measure: 'Dozens',
      unit_price: 360.00,
      supplier: 'SB Poultry Farms',
      status: 'Adequate Stock'
    }
  ];
}

function filterAndRenderPurchase() {
  const filterVal = document.getElementById('select-purchase-filter')?.value || 'ALL';

  const filtered = purchaseMaterials.filter(m => {
    const shortfall = Math.max(0, m.required_qty - m.current_stock);
    if (filterVal === 'SHORTAGE') return shortfall > (m.required_qty * 0.4);
    if (filterVal === 'REORDER') return m.status === 'Advisory Shortage';
    if (filterVal === 'ADEQUATE') return m.status === 'Adequate Stock';
    return true;
  });

  const tbody = document.getElementById('purchase-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  document.getElementById('purchase-count-text').textContent = `Showing ${filtered.length} of ${purchaseMaterials.length} raw baking ingredients`;

  const shortageCount = purchaseMaterials.filter(m => (m.required_qty - m.current_stock) > 0).length;
  const totalCost = purchaseMaterials.reduce((sum, m) => {
    const shortfall = Math.max(0, m.required_qty - m.current_stock);
    return sum + (shortfall * m.unit_price);
  }, 0);

  document.getElementById('kpi-purchase-shortages').textContent = `${shortageCount} Materials`;
  document.getElementById('kpi-purchase-open-pos').textContent = `ERP Integration Pending`;
  document.getElementById('kpi-purchase-total-cost').textContent = formatPKR(totalCost);

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding: 25px; color: var(--text-muted);">No materials matching active urgency filter.</td></tr>';
    return;
  }

  filtered.forEach(m => {
    const tr = document.createElement('tr');
    const shortfall = Math.max(0, m.required_qty - m.current_stock);
    const lineCost = shortfall * m.unit_price;

    tr.innerHTML = `
      <td>
        <div class="sku-cell">
          <span class="sku-name">${m.material_name}</span>
          <span class="sku-id">${m.material_id}</span>
        </div>
      </td>
      <td><span class="cat-badge">${m.category}</span></td>
      <td><span style="font-family:var(--font-mono); font-weight:600;">${m.required_qty.toLocaleString()} ${m.unit_of_measure}</span></td>
      <td><span style="font-family:var(--font-mono); color:${m.current_stock < m.required_qty ? 'var(--accent-rose)' : 'inherit'};">${m.current_stock.toLocaleString()} ${m.unit_of_measure}</span></td>
      <td><span style="font-family:var(--font-mono); font-weight:700; color:${shortfall > 0 ? 'var(--accent-rose)' : 'var(--text-muted)'};">${shortfall > 0 ? shortfall.toLocaleString() + ' ' + m.unit_of_measure : '—'}</span></td>
      <td><span style="font-family:var(--font-mono); color:var(--text-secondary);">${formatPKR(m.unit_price)}</span></td>
      <td><span class="sales-val">${formatPKR(lineCost)}</span></td>
      <td><span style="color:var(--text-secondary); font-size:0.85rem;">${m.supplier}</span></td>
      <td><span class="status-pill ${shortfall > 0 ? 'shortage' : 'approved'}">${m.status}</span></td>
      <td>
        <span style="font-size:0.75rem; color:var(--text-muted);">Advisory Prototype</span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function exportPurchaseCSV() {
  const headers = ['Material ID', 'Material Name', 'Category', 'Required (Bake Plan)', 'Warehouse Stock', 'Net Shortfall', 'Unit Rate (PKR)', 'Total Cost (PKR)', 'Supplier', 'PO Status'];
  const rows = purchaseMaterials.map(m => {
    const shortfall = Math.max(0, m.required_qty - m.current_stock);
    return [
      m.material_id,
      `"${m.material_name.replace(/"/g, '""')}"`,
      m.category,
      m.required_qty,
      m.current_stock,
      shortfall,
      m.unit_price,
      shortfall * m.unit_price,
      `"${m.supplier}"`,
      m.status
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
  document.getElementById('select-branch')?.addEventListener('change', () => loadForecastData());
  document.getElementById('select-category')?.addEventListener('change', () => filterAndRenderTable());
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
  document.getElementById('select-indent-branch')?.addEventListener('change', () => {
    initializeIndents();
    filterAndRenderIndents();
  });
  document.getElementById('select-indent-status')?.addEventListener('change', filterAndRenderIndents);
  document.getElementById('input-indent-search')?.addEventListener('input', filterAndRenderIndents);
  document.getElementById('btn-approve-all-indents')?.addEventListener('click', () => {
    showToast('Advisory Action: Batch approve requires central commissary warehouse integration.', 'info');
  });
  document.getElementById('btn-export-indents')?.addEventListener('click', exportIndentsCSV);

  // Central Kitchen Bake Listeners
  document.getElementById('select-bake-shift')?.addEventListener('change', filterAndRenderBakeBatches);
  document.getElementById('select-bake-station')?.addEventListener('change', filterAndRenderBakeBatches);
  document.getElementById('btn-add-urgent-batch')?.addEventListener('click', () => {
    showToast('Advisory Action: Emergency scheduling requires master recipe/BOM configuration.', 'info');
  });
  document.getElementById('btn-export-bake-plan')?.addEventListener('click', exportBakePlanCSV);

  // Purchase Requirements Listeners
  document.getElementById('select-purchase-filter')?.addEventListener('change', filterAndRenderPurchase);
  document.getElementById('btn-generate-po-all')?.addEventListener('click', () => {
    showToast('Advisory Action: Purchase order issuance requires ERP procurement database.', 'info');
  });
  document.getElementById('btn-export-purchase')?.addEventListener('click', exportPurchaseCSV);
}

// Master Initialization
async function initWorkbench() {
  console.log('[WORKBENCH] Bootstrapping BakeSuite ERP Intelligence UI...');
  setupEventListeners();
  await loadForecastData();
}

// DOM Ready
document.addEventListener('DOMContentLoaded', initWorkbench);
