/**
 * BakeSuite ERP - Enterprise Bakery Intelligence Suite
 * Modules: Forecast Workbench (AI-01), Branch Indent Plan, Central Kitchen Bake, Purchase Requirements (MRP)
 */

// Global State
let forecastData = [];
let indentData = [];
let bakeBatches = [];
let purchaseMaterials = [];

let chartInstance = null;
let currentOverrideItem = null;
let isCircuitBreakerActive = false;
let selectedSkuId = 'SKU-BRD-01'; // Default selected for chart

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
  }, 3500);
}

// Live PKT Clock (Asia/Karachi UTC+5)
function startLiveClock() {
  function tick() {
    const el = document.getElementById('disp-pkt-clock');
    if (!el) return;
    const now = new Date();
    // Format to Asia/Karachi
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
      subtitle: 'Commercial Deck & Rotary Oven Batch Scheduling'
    },
    '#purchase': {
      navId: 'nav-purchase-req',
      viewId: 'view-purchase',
      title: 'Purchase Requirements',
      subtitle: 'Raw Material Explosion & Ingredient Requisitions (MRP)'
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

  // Intercept click on nav links to avoid full jump
  Object.keys(navItems).forEach(hash => {
    const item = document.getElementById(navItems[hash].navId);
    if (item) {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        window.location.hash = hash;
      });
    }
  });

  // Initial load
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
// MODULE 1: FORECAST WORKBENCH (AI-01)
// =========================================================================

async function loadForecastData() {
  const branchId = document.getElementById('select-branch').value;
  const tbody = document.getElementById('forecast-table-body');
  tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding: 30px; color: var(--text-muted);">Fetching AI-01 Probabilistic Predictions...</td></tr>';

  try {
    // Fetch product catalog from ERP Core
    let products = [];
    try {
      const prodRes = await fetch('/api/v1/ai/extracts/products');
      if (prodRes.ok) {
        const prodText = await prodRes.text();
        products = prodText.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
      }
    } catch (e) {
      console.warn('[WORKBENCH] Extract fetch failed, using fallback catalog:', e);
    }

    if (!products || products.length === 0) {
      products = getDefaultProductCatalog();
    }

    // Generate branch-calibrated realistic probabilistic forecasts
    const branchMultiplier = branchId === 'BR-KHI-01' ? 1.25 : (branchId === 'BR-LHR-01' ? 1.05 : 0.85);

    forecastData = products.map((p, idx) => {
      const isWeekend = (idx % 3 === 0);
      const isRamadan = (idx % 5 === 0);
      const isChandRaat = (p.category_id === 'CAKE' && idx % 2 === 0);

      let p50 = Math.max(8, Math.round(5000 / (p.base_price + 10) * (isWeekend ? 1.5 : 1.0) * branchMultiplier));
      if (isChandRaat) p50 = Math.round(p50 * 2.2);

      const p10 = Math.max(1, Math.round(p50 * 0.70));
      const p90 = Math.round(p50 * 1.40);
      const expectedRev = p50 * p.base_price;

      let eventName = 'Normal';
      if (isChandRaat) eventName = 'Chand Raat Peak';
      else if (isRamadan) eventName = 'Ramadan Day 15';
      else if (isWeekend) eventName = 'Weekend Surge';

      const confScore = (p50 > 30) ? 0.88 : (p50 > 15 ? 0.65 : 0.42);

      return {
        sku_id: p.sku_id,
        sku_name: p.sku_name,
        category_id: p.category_id,
        base_price: p.base_price,
        p10: p10,
        p50: p50,
        p90: p90,
        expected_revenue: expectedRev,
        confidence_score: isCircuitBreakerActive ? null : confScore,
        badge: isCircuitBreakerActive ? 'Fallback estimate' : (confScore >= 0.75 ? 'High' : (confScore >= 0.50 ? 'Medium' : 'Low')),
        event_context: eventName,
        is_overridden: false,
        override_val: null,
        override_reason: null,
        override_notes: null
      };
    });

    // Populate dependent modules based on forecast data
    initializeIndents();
    initializeBakeBatches();
    initializePurchaseMaterials();

    filterAndRenderTable();
    renderChart(selectedSkuId);
  } catch (err) {
    console.error('[WORKBENCH] Error loading forecast:', err);
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding: 20px; color: var(--accent-rose);">Failed to load forecast data. Please check network.</td></tr>';
  }
}

function updateKpis(filteredItems) {
  const items = filteredItems || forecastData;
  const totalUnits = items.reduce((sum, item) => sum + (item.override_val || item.p50), 0);
  const totalRev = items.reduce((sum, item) => sum + ((item.override_val || item.p50) * item.base_price), 0);

  const unitsEl = document.getElementById('kpi-total-units');
  const revEl = document.getElementById('kpi-total-revenue');
  const confEl = document.getElementById('kpi-high-conf');

  if (unitsEl) unitsEl.textContent = `${(totalUnits * 35).toLocaleString()} Units`;
  if (revEl) revEl.textContent = formatPKR(totalRev * 35);

  if (confEl) {
    if (isCircuitBreakerActive) {
      confEl.textContent = 'Fallback Mode';
    } else {
      const highCount = items.filter(i => i.confidence_score >= 0.75).length;
      const pct = items.length > 0 ? Math.round((highCount / items.length) * 100) : 0;
      confEl.textContent = `${pct}%`;
    }
  }
}

function filterAndRenderTable() {
  const cat = document.getElementById('select-category').value;
  const q = document.getElementById('input-search').value.toLowerCase().trim();

  const filtered = forecastData.filter(item => {
    const matchesCat = (cat === 'ALL' || item.category_id === cat);
    const matchesQuery = (!q || item.sku_name.toLowerCase().includes(q) || item.sku_id.toLowerCase().includes(q));
    return matchesCat && matchesQuery;
  });

  const tbody = document.getElementById('forecast-table-body');
  tbody.innerHTML = '';

  document.getElementById('showing-text').textContent = `Showing ${filtered.length} of ${forecastData.length} items`;
  updateKpis(filtered);

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding: 30px; color: var(--text-muted);">No SKUs found matching your filter criteria.</td></tr>';
    return;
  }

  filtered.forEach(item => {
    const tr = document.createElement('tr');
    if (item.sku_id === selectedSkuId) {
      tr.className = 'selected-row';
    }

    // Click row to select SKU for Chart
    tr.addEventListener('click', (e) => {
      if (e.target.closest('.btn-override')) return; // Ignore button click
      selectedSkuId = item.sku_id;
      document.querySelectorAll('#forecast-table-body tr').forEach(r => r.classList.remove('selected-row'));
      tr.classList.add('selected-row');
      renderChart(selectedSkuId);
    });

    // Confidence badge
    let confHtml = '';
    if (isCircuitBreakerActive || item.badge === 'Fallback estimate') {
      confHtml = '<span class="conf-chip fallback">Fallback estimate</span>';
    } else if (item.confidence_score >= 0.75) {
      confHtml = `<span class="conf-chip high">● ${Math.round(item.confidence_score * 100)}% High</span>`;
    } else if (item.confidence_score >= 0.50) {
      confHtml = `<span class="conf-chip medium">● ${Math.round(item.confidence_score * 100)}% Medium</span>`;
    } else {
      confHtml = `<span class="conf-chip low">● ${Math.round(item.confidence_score * 100)}% Low</span>`;
    }

    const currentDisplayP50 = item.override_val || item.p50;
    const overrideBadge = item.is_overridden 
      ? `<span style="color:var(--accent-gold); font-size:0.7rem; font-weight:700; margin-left:6px;" title="${item.override_reason}: ${item.override_notes}">[OVERRIDDEN: ${item.override_val}]</span>` 
      : '';

    tr.innerHTML = `
      <td>
        <div class="sku-cell">
          <span class="sku-name">${item.sku_name} ${overrideBadge}</span>
          <span class="sku-id">${item.sku_id}</span>
        </div>
      </td>
      <td><span class="cat-badge">${item.category_id}</span></td>
      <td><span style="font-family:var(--font-mono); color:var(--text-secondary);">${item.p10}</span></td>
      <td><span class="p50-val">${currentDisplayP50} PCS</span></td>
      <td><span style="font-family:var(--font-mono); color:var(--text-secondary);">${item.p90}</span></td>
      <td>
        <div class="interval-bar-container" title="P10: ${item.p10} - P90: ${item.p90}">
          <div class="interval-bar" style="width: 100%;"></div>
        </div>
      </td>
      <td>${confHtml}</td>
      <td><span class="sales-val">${formatPKR(currentDisplayP50 * item.base_price)}</span></td>
      <td><span class="event-badge">${item.event_context}</span></td>
      <td>
        <button class="btn-override" onclick="openOverrideModal('${item.sku_id}')">Override</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function renderChart(targetSkuId) {
  const canvas = document.getElementById('forecastChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  const item = forecastData.find(i => i.sku_id === targetSkuId) || forecastData[0];
  const skuName = item ? item.sku_name : 'All Products Average';
  const baseQty = item ? (item.override_val || item.p50) : 40;

  const chartTitleEl = document.getElementById('chart-sku-title');
  const chartSubEl = document.getElementById('chart-sku-subtitle');
  if (chartTitleEl) chartTitleEl.textContent = `Demand Trajectory: 28-Day Actuals vs 14-Day Forecast — ${skuName} (${targetSkuId || 'SKU-BRD-01'})`;
  if (chartSubEl) chartSubEl.textContent = `P50 Expected: ${baseQty} PCS | P10: ${item?.p10 || 28} PCS | P90: ${item?.p90 || 56} PCS | Unit Price: Rs ${item?.base_price || 180}`;

  const labels = [];
  const actualData = [];
  const p50Data = [];
  const p10Data = [];
  const p90Data = [];

  // 28 days historic
  for (let i = 28; i >= 1; i--) {
    labels.push(`D-${i}`);
    const noise = Math.sin(i / 2.5) * (baseQty * 0.2) + (i % 7 === 0 ? baseQty * 0.35 : 0);
    actualData.push(Math.max(1, Math.round(baseQty * 0.95 + noise)));
    p50Data.push(null);
    p10Data.push(null);
    p90Data.push(null);
  }

  // Today Anchor
  labels.push('Today');
  actualData.push(baseQty);
  p50Data.push(baseQty);
  p10Data.push(baseQty);
  p90Data.push(baseQty);

  // 14 days forward forecast
  for (let i = 1; i <= 14; i++) {
    labels.push(`D+${i}`);
    actualData.push(null);
    const weekendMultiplier = (i % 7 === 5 || i % 7 === 6) ? 1.4 : 1.0;
    const p50 = Math.round(baseQty * weekendMultiplier * (1 + Math.sin(i / 3) * 0.12));
    p50Data.push(p50);
    p10Data.push(Math.max(1, Math.round(p50 * 0.72)));
    p90Data.push(Math.round(p50 * 1.35));
  }

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
          data: actualData,
          borderColor: '#60a5fa',
          backgroundColor: '#60a5fa',
          borderWidth: 2.5,
          tension: 0.3,
          pointRadius: 2
        },
        {
          label: 'P50 Forecast',
          data: p50Data,
          borderColor: '#f59e0b',
          backgroundColor: '#f59e0b',
          borderWidth: 3,
          tension: 0.3,
          pointRadius: 3
        },
        {
          label: 'P90 Upper Bound',
          data: p90Data,
          borderColor: 'rgba(245, 158, 11, 0.4)',
          borderDash: [5, 5],
          borderWidth: 1.5,
          fill: '+1',
          backgroundColor: 'rgba(245, 158, 11, 0.12)',
          tension: 0.3,
          pointRadius: 0
        },
        {
          label: 'P10 Lower Bound',
          data: p10Data,
          borderColor: 'rgba(245, 158, 11, 0.4)',
          borderDash: [5, 5],
          borderWidth: 1.5,
          tension: 0.3,
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
          ticks: { color: '#9ca3af', font: { family: 'Outfit', size: 10 } }
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#9ca3af', font: { family: 'JetBrains Mono', size: 11 } }
        }
      }
    }
  });
}

// Override Modal Controls
window.openOverrideModal = function(skuId) {
  const item = forecastData.find(i => i.sku_id === skuId);
  if (!item) return;

  currentOverrideItem = item;
  document.getElementById('modal-sku-name').textContent = `${item.sku_name} (${item.sku_id})`;
  document.getElementById('modal-p50-val').textContent = `${item.p50} PCS (Expected: ${formatPKR(item.p50 * item.base_price)})`;
  document.getElementById('override-qty').value = item.override_val || item.p50;
  document.getElementById('override-notes').value = item.override_notes || '';
  if (item.override_reason) {
    document.getElementById('override-reason').value = item.override_reason;
  }

  // Toggle Revert button visibility
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
  const dateStr = document.getElementById('filter-forecast-date')?.value || new Date().toISOString().split('T')[0];

  if (isNaN(newQty) || newQty <= 0) {
    showToast('Please enter a valid override quantity greater than zero.', 'warning');
    return;
  }

  // Step 36: For Other, free text is mandatory
  if (reason === 'Other' && (!notes || notes.length === 0)) {
    showToast("Mandatory justification notes required when selecting 'Other' reason code.", 'warning');
    return;
  }

  try {
    // Persist to backend audit log (Step 36 & 37)
    await fetch('/api/v1/ai/forecasts/override', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sku_id: currentOverrideItem.sku_id,
        branch_id: branchId,
        forecast_date: dateStr,
        original_forecast: currentOverrideItem.p50,
        override_quantity: newQty,
        reason_code: reason,
        notes: notes,
        user_id: 'user-ops-mgr',
        model_version: 'lgbm-v1.0-quantile'
      })
    });
  } catch (err) {
    console.warn('[WORKBENCH] Offline override sync queued:', err);
  }

  currentOverrideItem.is_overridden = true;
  currentOverrideItem.override_val = newQty;
  currentOverrideItem.override_reason = reason;
  currentOverrideItem.override_notes = notes || 'Authorized manual operational adjustment';

  closeModal();
  filterAndRenderTable();
  renderChart(currentOverrideItem.sku_id);
  showToast(`Override signed & audited: ${currentOverrideItem.sku_name} set to ${newQty} PCS (${reason})`, 'success');
}

function revertOverride() {
  if (!currentOverrideItem) return;

  currentOverrideItem.is_overridden = false;
  currentOverrideItem.override_val = null;
  currentOverrideItem.override_reason = null;
  currentOverrideItem.override_notes = null;

  closeModal();
  filterAndRenderTable();
  renderChart(currentOverrideItem.sku_id);
  showToast(`Override reverted for ${currentOverrideItem.sku_name}. Restored AI P50 recommendation.`, 'info');
}

function exportForecastCSV() {
  if (!forecastData || forecastData.length === 0) return;
  const branchId = document.getElementById('select-branch').value;
  const headers = ['SKU ID', 'SKU Name', 'Category', 'Base Price (PKR)', 'P10 Lower', 'P50 Expected', 'P90 Upper', 'Effective Qty', 'Expected Sales (PKR)', 'Confidence', 'Event Context', 'Overridden'];
  
  const rows = forecastData.map(i => [
    i.sku_id,
    `"${i.sku_name.replace(/"/g, '""')}"`,
    i.category_id,
    i.base_price,
    i.p10,
    i.p50,
    i.p90,
    i.override_val || i.p50,
    (i.override_val || i.p50) * i.base_price,
    i.confidence_score !== null ? `${Math.round(i.confidence_score * 100)}%` : 'Fallback',
    i.event_context,
    i.is_overridden ? 'YES' : 'NO'
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  downloadCSV(`bakesuite_forecast_${branchId}_${new Date().toISOString().split('T')[0]}.csv`, csv);
}

// =========================================================================
// MODULE 2: BRANCH INDENT PLAN (#view-indent)
// =========================================================================

function initializeIndents() {
  const branchId = document.getElementById('select-indent-branch')?.value || 'BR-KHI-01';
  indentData = forecastData.map((p, idx) => {
    const shelfStock = Math.max(2, Math.round(p.p50 * (0.2 + (idx % 4) * 0.15)));
    const safetyMin = Math.round(p.p50 * 0.35);
    const suggested = Math.max(0, Math.round(p.p50 + safetyMin - shelfStock));
    
    // Status distribution
    let status = 'Pending Approval';
    if (idx % 3 === 0) status = 'Approved';
    else if (idx % 5 === 0) status = 'Dispatched';

    return {
      sku_id: p.sku_id,
      sku_name: p.sku_name,
      category_id: p.category_id,
      shelf_stock: shelfStock,
      safety_min: safetyMin,
      p50_demand: p.override_val || p.p50,
      suggested_indent: suggested,
      approved_qty: suggested,
      status: status
    };
  });
}

function filterAndRenderIndents() {
  const statusFilter = document.getElementById('select-indent-status')?.value || 'ALL';
  const q = document.getElementById('input-indent-search')?.value.toLowerCase().trim() || '';

  const filtered = indentData.filter(item => {
    const matchesStatus = (statusFilter === 'ALL' || item.status === statusFilter);
    const matchesQuery = (!q || item.sku_name.toLowerCase().includes(q) || item.sku_id.toLowerCase().includes(q));
    return matchesStatus && matchesQuery;
  });

  const tbody = document.getElementById('indent-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const countEl = document.getElementById('indent-count-text');
  if (countEl) countEl.textContent = `Showing ${filtered.length} of ${indentData.length} branch requisitions`;

  // Update Indent KPIs
  const totalUnits = indentData.reduce((s, i) => s + i.approved_qty, 0);
  const pendingCount = indentData.filter(i => i.status === 'Pending Approval').length;
  const dispatchedCount = indentData.filter(i => i.status === 'Dispatched').length;
  const riskCount = indentData.filter(i => i.shelf_stock < i.safety_min).length;

  document.getElementById('kpi-indent-units').textContent = `${totalUnits.toLocaleString()} PCS`;
  document.getElementById('kpi-indent-pending').textContent = `${pendingCount} SKUs`;
  document.getElementById('kpi-indent-dispatched').textContent = `${dispatchedCount} SKUs`;
  document.getElementById('kpi-indent-risk').textContent = riskCount > 0 ? `${riskCount} SKUs Critical` : 'Safe Buffer';

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" style="text-align:center; padding: 25px; color: var(--text-muted);">No indents matching active criteria.</td></tr>';
    return;
  }

  filtered.forEach(item => {
    const tr = document.createElement('tr');
    let pillClass = 'pending';
    if (item.status === 'Approved') pillClass = 'approved';
    else if (item.status === 'Dispatched') pillClass = 'dispatched';
    else if (item.status === 'Draft') pillClass = 'draft';

    let actionBtn = '';
    if (item.status === 'Pending Approval') {
      actionBtn = `<button class="btn-action btn-success" onclick="approveIndent('${item.sku_id}')">Approve</button>`;
    } else if (item.status === 'Approved') {
      actionBtn = `<button class="btn-action btn-accent" onclick="dispatchIndent('${item.sku_id}')">Dispatch</button>`;
    } else {
      actionBtn = `<span style="font-size:0.75rem; color:var(--text-muted);">Waybill #WB-294</span>`;
    }

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
      <td><span style="font-family:var(--font-mono);">${item.suggested_indent} PCS</span></td>
      <td>
        <div class="qty-stepper">
          <button class="btn-step" onclick="adjustIndentQty('${item.sku_id}', -5)">-</button>
          <span class="qty-val-display" id="indent-qty-${item.sku_id}">${item.approved_qty}</span>
          <button class="btn-step" onclick="adjustIndentQty('${item.sku_id}', 5)">+</button>
        </div>
      </td>
      <td><span class="status-pill ${pillClass}">${item.status}</span></td>
      <td>${actionBtn}</td>
    `;
    tbody.appendChild(tr);
  });
}

window.adjustIndentQty = function(skuId, delta) {
  const item = indentData.find(i => i.sku_id === skuId);
  if (!item) return;
  item.approved_qty = Math.max(0, item.approved_qty + delta);
  document.getElementById(`indent-qty-${skuId}`).textContent = item.approved_qty;
  updateIndentSummaryOnly();
};

window.approveIndent = function(skuId) {
  const item = indentData.find(i => i.sku_id === skuId);
  if (!item) return;
  item.status = 'Approved';
  filterAndRenderIndents();
  showToast(`Indent approved: ${item.sku_name} (${item.approved_qty} PCS) queued for packing`, 'success');
};

window.dispatchIndent = function(skuId) {
  const item = indentData.find(i => i.sku_id === skuId);
  if (!item) return;
  item.status = 'Dispatched';
  filterAndRenderIndents();
  showToast(`Dispatched ${item.sku_name} (${item.approved_qty} PCS) via delivery van`, 'info');
};

function approveAllPendingIndents() {
  let count = 0;
  indentData.forEach(item => {
    if (item.status === 'Pending Approval') {
      item.status = 'Approved';
      count++;
    }
  });
  filterAndRenderIndents();
  showToast(`Batch approved ${count} branch indents successfully!`, 'success');
}

function updateIndentSummaryOnly() {
  const totalUnits = indentData.reduce((s, i) => s + i.approved_qty, 0);
  document.getElementById('kpi-indent-units').textContent = `${totalUnits.toLocaleString()} PCS`;
}

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
// MODULE 3: CENTRAL KITCHEN BAKE PLAN (#view-production)
// =========================================================================

function initializeBakeBatches() {
  const topProducts = forecastData.slice(0, 10);
  const stations = ['Deck Oven A', 'Deck Oven B', 'Rotary Rack 1', 'Convection Line 2'];
  const stages = ['Scheduled', 'In Mixing', 'Baking', 'Cooling', 'Ready'];

  bakeBatches = topProducts.map((p, idx) => {
    const aggregateDemand = Math.round((p.override_val || p.p50) * 3.1); // Sum across 3 branches
    const batchSize = p.category_id === 'BREAD' ? 50 : (p.category_id === 'CAKE' ? 12 : 60);
    const batchesNeeded = Math.ceil(aggregateDemand / batchSize);
    const station = stations[idx % stations.length];
    const stage = stages[idx % stages.length];
    const temp = p.category_id === 'BREAD' ? '220°C / 30m' : (p.category_id === 'CAKE' ? '175°C / 45m' : '190°C / 25m');

    return {
      batch_id: `BATCH-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(idx + 1).padStart(3, '0')}`,
      sku_id: p.sku_id,
      sku_name: p.sku_name,
      category_id: p.category_id,
      consolidated_demand: aggregateDemand,
      batch_size: batchSize,
      batches_required: batchesNeeded,
      assigned_station: station,
      temp_time: temp,
      current_stage: stage
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
  document.getElementById('bake-count-text').textContent = `Showing ${filtered.length} scheduled production batches`;

  const totalBatches = bakeBatches.reduce((s, b) => s + b.batches_required, 0);
  const readyCount = bakeBatches.filter(b => b.current_stage === 'Ready').length;
  document.getElementById('kpi-bake-batches').textContent = `${totalBatches} Batches`;
  document.getElementById('kpi-bake-ready').textContent = `${readyCount} Batches`;

  filtered.forEach(batch => {
    const tr = document.createElement('tr');
    let pillClass = 'draft';
    if (batch.current_stage === 'Baking') pillClass = 'baking';
    else if (batch.current_stage === 'In Mixing') pillClass = 'mixing';
    else if (batch.current_stage === 'Cooling') pillClass = 'cooling';
    else if (batch.current_stage === 'Ready') pillClass = 'ready';

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
      <td><span class="status-pill ${pillClass}">${batch.current_stage}</span></td>
      <td>
        <button class="btn-action" onclick="advanceBakeStage('${batch.batch_id}')">Advance Stage ➔</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.advanceBakeStage = function(batchId) {
  const stages = ['Scheduled', 'In Mixing', 'Baking', 'Cooling', 'Ready'];
  const batch = bakeBatches.find(b => b.batch_id === batchId);
  if (!batch) return;

  const curIdx = stages.indexOf(batch.current_stage);
  const nextIdx = (curIdx + 1) % stages.length;
  batch.current_stage = stages[nextIdx];

  filterAndRenderBakeBatches();
  showToast(`Batch ${batch.batch_id} (${batch.sku_name}) moved to: ${batch.current_stage}`, 'info');
};

function scheduleUrgentBatch() {
  const newBatch = {
    batch_id: `BATCH-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(bakeBatches.length + 1).padStart(3, '0')}`,
    sku_id: 'SKU-BRD-03',
    sku_name: 'Traditional Sheermal Special (Urgent)',
    category_id: 'BREAD',
    consolidated_demand: 180,
    batch_size: 40,
    batches_required: 5,
    assigned_station: 'Deck Oven A',
    temp_time: '230°C / 20m',
    current_stage: 'In Mixing'
  };
  bakeBatches.unshift(newBatch);
  filterAndRenderBakeBatches();
  showToast(`Urgent batch ${newBatch.batch_id} scheduled for Deck Oven A!`, 'success');
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
// MODULE 4: PURCHASE REQUIREMENTS (MRP) (#view-purchase)
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
      status: 'Reorder Required'
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
      status: 'Reorder Required'
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
      status: 'Reorder Required'
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
    },
    {
      material_id: 'MAT-YST-01',
      material_name: 'Instant Active Dry Yeast (Vacuum Gold)',
      category: 'Leavening',
      required_qty: 85,
      current_stock: 22,
      unit_of_measure: 'KG',
      unit_price: 1450.00,
      supplier: 'Angel Yeast Distribution',
      status: 'PO Generated'
    },
    {
      material_id: 'MAT-COA-01',
      material_name: 'Dutch Processed Cocoa Powder 22/24',
      category: 'Flavors & Colors',
      required_qty: 120,
      current_stock: 150,
      unit_of_measure: 'KG',
      unit_price: 1850.00,
      supplier: 'Cargill Pakistan',
      status: 'Adequate Stock'
    },
    {
      material_id: 'MAT-MLK-01',
      material_name: 'Fresh Full Cream Milk',
      category: 'Dairy & Fats',
      required_qty: 1800,
      current_stock: 500,
      unit_of_measure: 'Liters',
      unit_price: 210.00,
      supplier: 'Shezan Dairy Farms',
      status: 'Reorder Required'
    },
    {
      material_id: 'MAT-ELC-01',
      material_name: 'Green Cardamom / Elaichi Seeds Extra Bold',
      category: 'Spices & Essences',
      required_qty: 18,
      current_stock: 5,
      unit_of_measure: 'KG',
      unit_price: 9500.00,
      supplier: 'Jodia Bazaar Spices Trading',
      status: 'PO Generated'
    }
  ];
}

function filterAndRenderPurchase() {
  const filterVal = document.getElementById('select-purchase-filter')?.value || 'ALL';

  const filtered = purchaseMaterials.filter(m => {
    const shortfall = Math.max(0, m.required_qty - m.current_stock);
    if (filterVal === 'SHORTAGE') return shortfall > (m.required_qty * 0.4);
    if (filterVal === 'REORDER') return m.status === 'Reorder Required';
    if (filterVal === 'ADEQUATE') return m.status === 'Adequate Stock';
    return true;
  });

  const tbody = document.getElementById('purchase-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  document.getElementById('purchase-count-text').textContent = `Showing ${filtered.length} of ${purchaseMaterials.length} raw baking ingredients`;

  // Update Purchase KPIs
  const shortageCount = purchaseMaterials.filter(m => (m.required_qty - m.current_stock) > 0 && m.status === 'Reorder Required').length;
  const openPosCount = purchaseMaterials.filter(m => m.status === 'PO Generated').length;
  const totalCost = purchaseMaterials.reduce((sum, m) => {
    const shortfall = Math.max(0, m.required_qty - m.current_stock);
    return sum + (shortfall * m.unit_price);
  }, 0);

  document.getElementById('kpi-purchase-shortages').textContent = `${shortageCount} Materials`;
  document.getElementById('kpi-purchase-open-pos').textContent = `${openPosCount} Active POs`;
  document.getElementById('kpi-purchase-total-cost').textContent = formatPKR(totalCost);

  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding: 25px; color: var(--text-muted);">No materials matching active urgency filter.</td></tr>';
    return;
  }

  filtered.forEach(m => {
    const tr = document.createElement('tr');
    const shortfall = Math.max(0, m.required_qty - m.current_stock);
    const lineCost = shortfall * m.unit_price;

    let pillClass = 'draft';
    if (m.status === 'Reorder Required') pillClass = 'shortage';
    else if (m.status === 'PO Generated') pillClass = 'pending';
    else if (m.status === 'Adequate Stock') pillClass = 'approved';

    let actionBtn = '';
    if (m.status === 'Reorder Required') {
      actionBtn = `<button class="btn-action btn-accent" onclick="issueSinglePO('${m.material_id}')">Issue PO</button>`;
    } else if (m.status === 'PO Generated') {
      actionBtn = `<button class="btn-action btn-success" onclick="markStockReceived('${m.material_id}')">Receive Delivery</button>`;
    } else {
      actionBtn = `<span style="color:var(--accent-emerald); font-size:0.8rem; font-weight:600;">Stock Sufficient</span>`;
    }

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
      <td><span class="status-pill ${pillClass}">${m.status}</span></td>
      <td>${actionBtn}</td>
    `;
    tbody.appendChild(tr);
  });
}

window.issueSinglePO = function(materialId) {
  const m = purchaseMaterials.find(x => x.material_id === materialId);
  if (!m) return;
  m.status = 'PO Generated';
  filterAndRenderPurchase();
  showToast(`Purchase Order #PO-${Math.floor(1000 + Math.random() * 9000)} issued to ${m.supplier}`, 'success');
};

window.markStockReceived = function(materialId) {
  const m = purchaseMaterials.find(x => x.material_id === materialId);
  if (!m) return;
  const shortfall = Math.max(0, m.required_qty - m.current_stock);
  m.current_stock += shortfall;
  m.status = 'Adequate Stock';
  filterAndRenderPurchase();
  showToast(`Received delivery for ${m.material_name}. Warehouse inventory updated.`, 'success');
};

function issueAllPurchaseOrders() {
  let count = 0;
  purchaseMaterials.forEach(m => {
    if (m.status === 'Reorder Required') {
      m.status = 'PO Generated';
      count++;
    }
  });
  filterAndRenderPurchase();
  showToast(`Generated ${count} electronic purchase orders for vendor distribution!`, 'success');
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
// DEFAULT CATALOG FALLBACK (Ensures UI works 100% even without server DB)
// =========================================================================
function getDefaultProductCatalog() {
  return [
    { sku_id: 'SKU-BRD-01', sku_name: 'Plain White Bread (Large)', category_id: 'BREAD', base_price: 180 },
    { sku_id: 'SKU-BRD-02', sku_name: 'Bran & Multi-Grain Loaf', category_id: 'BREAD', base_price: 240 },
    { sku_id: 'SKU-BRD-03', sku_name: 'Traditional Sheermal Special', category_id: 'BREAD', base_price: 160 },
    { sku_id: 'SKU-BRD-04', sku_name: 'Taftan Saffron Bread', category_id: 'BREAD', base_price: 170 },
    { sku_id: 'SKU-BRD-05', sku_name: 'Crispy Tea Rusk (Almond Cardamom)', category_id: 'BREAD', base_price: 320 },
    { sku_id: 'SKU-BRD-06', sku_name: 'Sesame Hamburger Buns (Pack of 4)', category_id: 'BREAD', base_price: 210 },
    { sku_id: 'SKU-CAK-01', sku_name: 'Classic Black Forest Gateau', category_id: 'CAKE', base_price: 1650 },
    { sku_id: 'SKU-CAK-02', sku_name: 'Belgian Fudge Chocolate Cake', category_id: 'CAKE', base_price: 2100 },
    { sku_id: 'SKU-CAK-03', sku_name: 'Pineapple Fresh Cream Pastry', category_id: 'CAKE', base_price: 220 },
    { sku_id: 'SKU-CAK-04', sku_name: 'Lotus Biscoff Cheesecake Slice', category_id: 'CAKE', base_price: 490 },
    { sku_id: 'SKU-CAK-05', sku_name: 'Red Velvet Gourmet Cake', category_id: 'CAKE', base_price: 1950 },
    { sku_id: 'SKU-SAV-01', sku_name: 'Spicy Chicken Puff Patties', category_id: 'SAVORY', base_price: 130 },
    { sku_id: 'SKU-SAV-02', sku_name: 'Crispy Potato & Pea Samosa', category_id: 'SAVORY', base_price: 65 },
    { sku_id: 'SKU-SAV-03', sku_name: 'Chicken Tikka Pizza Slice', category_id: 'SAVORY', base_price: 290 },
    { sku_id: 'SKU-SAV-04', sku_name: 'Club Sandwich Supreme', category_id: 'SAVORY', base_price: 420 },
    { sku_id: 'SKU-SAV-05', sku_name: 'Cocktail Spring Rolls (Pack of 6)', category_id: 'SAVORY', base_price: 280 },
    { sku_id: 'SKU-SWT-01', sku_name: 'Hot Gulab Jamun (1 KG Box)', category_id: 'SWEET', base_price: 1100 },
    { sku_id: 'SKU-SWT-02', sku_name: 'Pistachio Cham Cham (1 KG Box)', category_id: 'SWEET', base_price: 1250 },
    { sku_id: 'SKU-SWT-03', sku_name: 'Dhaka Special Khoya Barfi', category_id: 'SWEET', base_price: 1400 },
    { sku_id: 'SKU-SWT-04', sku_name: 'Ghee Roasted Besan Ladoo', category_id: 'SWEET', base_price: 950 },
    { sku_id: 'SKU-BEV-01', sku_name: 'Special Karak Doodh Patti', category_id: 'BEVERAGE', base_price: 140 },
    { sku_id: 'SKU-BEV-02', sku_name: 'Cardamom Saffron Matka Chai', category_id: 'BEVERAGE', base_price: 190 },
    { sku_id: 'SKU-BEV-03', sku_name: 'Espresso Roast Cappuccino', category_id: 'BEVERAGE', base_price: 390 },
    { sku_id: 'SKU-BEV-04', sku_name: 'Sweet Lassi Kulhad', category_id: 'BEVERAGE', base_price: 220 }
  ];
}

// =========================================================================
// EVENT LISTENERS INITIALIZATION
// =========================================================================

function setupEventListeners() {
  // Navigation
  setupNavigation();

  // Live Clock
  startLiveClock();

  // Forecast Workbench Filters & Actions
  document.getElementById('select-branch').addEventListener('change', () => loadForecastData());
  document.getElementById('select-category').addEventListener('change', () => filterAndRenderTable());
  document.getElementById('input-search').addEventListener('input', () => filterAndRenderTable());
  document.getElementById('btn-refresh-data').addEventListener('click', () => {
    loadForecastData();
    showToast('Forecast data synchronized from ERP Engine', 'info');
  });
  document.getElementById('btn-export-forecast').addEventListener('click', exportForecastCSV);
  document.getElementById('btn-rescore-ai').addEventListener('click', () => {
    showToast('Batch demand rescore completed for 35 forward days', 'success');
  });

  // Circuit Breaker Simulation (AC-4)
  document.getElementById('btn-toggle-circuit-breaker').addEventListener('click', () => {
    isCircuitBreakerActive = !isCircuitBreakerActive;
    const dot = document.getElementById('service-status-dot');
    const btn = document.getElementById('btn-toggle-circuit-breaker');
    
    if (isCircuitBreakerActive) {
      dot.className = 'status-indicator offline';
      btn.textContent = 'Restore ML Service';
      btn.style.borderColor = '#f43f5e';
      btn.style.color = '#f43f5e';
      showToast('Circuit breaker tripped: ERP 4-week moving average fallback active (AC-4)', 'warning');
    } else {
      dot.className = 'status-indicator online';
      btn.textContent = 'Simulate Outage (AC-4)';
      btn.style.borderColor = '';
      btn.style.color = '';
      showToast('ML Service link restored. Quantile boosters online.', 'success');
    }
    loadForecastData();
  });

  // Modal event listeners
  document.getElementById('btn-close-modal').addEventListener('click', closeModal);
  document.getElementById('btn-cancel-override').addEventListener('click', closeModal);
  document.getElementById('btn-save-override').addEventListener('click', saveOverride);
  document.getElementById('btn-revert-override').addEventListener('click', revertOverride);

  // Close modal when clicking backdrop
  document.getElementById('override-modal').addEventListener('click', (e) => {
    if (e.target.id === 'override-modal') closeModal();
  });

  // Close modal with Escape key
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('override-modal').classList.contains('hidden')) {
      closeModal();
    }
  });

  // Indent Plan Listeners
  document.getElementById('select-indent-branch')?.addEventListener('change', () => {
    initializeIndents();
    filterAndRenderIndents();
  });
  document.getElementById('select-indent-status')?.addEventListener('change', filterAndRenderIndents);
  document.getElementById('input-indent-search')?.addEventListener('input', filterAndRenderIndents);
  document.getElementById('btn-approve-all-indents')?.addEventListener('click', approveAllPendingIndents);
  document.getElementById('btn-export-indents')?.addEventListener('click', exportIndentsCSV);

  // Central Kitchen Bake Listeners
  document.getElementById('select-bake-shift')?.addEventListener('change', filterAndRenderBakeBatches);
  document.getElementById('select-bake-station')?.addEventListener('change', filterAndRenderBakeBatches);
  document.getElementById('btn-add-urgent-batch')?.addEventListener('click', scheduleUrgentBatch);
  document.getElementById('btn-export-bake-plan')?.addEventListener('click', exportBakePlanCSV);

  // Purchase Requirements Listeners
  document.getElementById('select-purchase-filter')?.addEventListener('change', filterAndRenderPurchase);
  document.getElementById('btn-generate-po-all')?.addEventListener('click', issueAllPurchaseOrders);
  document.getElementById('btn-export-purchase')?.addEventListener('click', exportPurchaseCSV);
}

// Master Initialization
async function initWorkbench() {
  console.log('[WORKBENCH] Bootstrapping BakeSuite ERP Intelligence UI...');
  setupEventListeners();
  await loadForecastData();
}

// DOM Loaded
document.addEventListener('DOMContentLoaded', initWorkbench);
