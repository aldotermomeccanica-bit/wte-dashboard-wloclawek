const state = {
  dashboard: null,
  config: null,
  history: [],
  lastNonDetail: 'overview',
  currentView: { type: 'tab', tab: 'overview' },
  viewStack: [],
  sCurveMode: localStorage.getItem('wteSCurveMode') || 'A',
};

const $ = (id) => document.getElementById(id);

async function fetchJSON(url, options) {
  const res = await fetch(url, { cache: 'no-store', ...(options || {}) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function fmtCurrency(v) {
  const n = Number(v || 0);
  return new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(n) + ' PLN';
}
function fmtSignedCurrency(v) {
  const n = Number(v || 0);
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  return sign + new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(Math.abs(n)) + ' PLN';
}
function fmtPct(v) { return `${Number(v || 0).toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`; }
function fmtPct2(v) { return `${Number(v || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`; }
function fmtCurrencyCompact(v) {
  const n = Number(v || 0);
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} mld PLN`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} mln PLN`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(0)} k PLN`;
  return `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(n)} PLN`;
}
function fmtAxisCurrency(v) {
  const n = Number(v || 0);
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(n / 1_000_000_000)} mld PLN`;
  if (abs >= 1_000_000) return `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(n / 1_000_000)} mln PLN`;
  return `${new Intl.NumberFormat('it-IT', { maximumFractionDigits: 0 }).format(n)} PLN`;
}
function fmtDate(v) {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
}
function toneClass(tone) { return ['green', 'amber', 'red', 'blue', 'neutral'].includes(tone) ? tone : 'neutral'; }
function normalizeStatus(status) { return String(status || '').trim().toLowerCase(); }
function statusTone(status) {
  const s = normalizeStatus(status);
  // Cromatica allineata al grafico a torta:
  // Closed / ordinato = verde; Planned / da ordinare = rosso; tutte le altre fasi = giallo.
  if (['finalized', 'closed', 'pct/approval'].includes(s)) return 'green';
  if (s === 'planned') return 'red';
  if (s) return 'amber';
  return 'neutral';
}
function rootPillTone(row) {
  const status = normalizeStatus(row?.dominantStatus);
  if (['finalized', 'closed', 'pct/approval'].includes(status)) return 'green';
  if (status === 'planned') return 'red';
  if (status) return 'amber';
  return toneClass(row?.health);
}
function pill(status) { return `<span class="pill ${toneClass(statusTone(status))}">${status || '—'}</span>`; }
function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
}

function setTab(tab, remember = true) {
  document.querySelectorAll('.tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === `${tab}-tab`));
  if (remember && tab !== 'detail') state.lastNonDetail = tab;
  if (tab !== 'detail') state.currentView = { type: 'tab', tab };
}

function restoreView(view) {
  if (!view) return setTab(state.lastNonDetail, false);
  if (view.type === 'detail') {
    $('detail-title').textContent = view.title || '';
    $('detail-subtitle').textContent = view.subtitle || '—';
    $('detail-metrics').innerHTML = view.metricsHtml || '';
    $('detail-content').innerHTML = view.contentHtml || '';
    document.querySelectorAll('.tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === 'detail'));
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === 'detail-tab'));
    state.currentView = view;
    return;
  }
  setTab(view.tab || state.lastNonDetail, false);
}

function bindTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => setTab(btn.dataset.tab));
  });
  $('back-button').addEventListener('click', () => {
    const previousView = state.viewStack.pop();
    restoreView(previousView);
  });
}

function makeMetric(label, value, hint) {
  return `<div class="detail-metric"><div class="label">${label}</div><div class="value">${value}</div><div class="hint meta-text">${hint || ''}</div></div>`;
}

function polyline(points) { return points.map(p => `${p.x},${p.y}`).join(' '); }

function lineChartSvg(curve, { height = 360, showContracted = false } = {}) {
  const labels = curve.labels || [];
  const width = 980;
  const pad = { top: 24, right: 24, bottom: 94, left: 150 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const procValues = curve.procAbs || [];
  const budgetValues = curve.budgetAbs || [];
  const contractedValues = curve.contractedAbs || [];
  const allValues = procValues.concat(budgetValues).concat(showContracted ? contractedValues : []);
  const maxY = Math.max(...allValues, 0);
  if (!labels.length || maxY <= 0) return '<div class="meta-text">Nessun dato disponibile per la curva.</div>';

  const roundedMax = Math.ceil(maxY / 100000000) * 100000000;
  const tickCount = 6;
  const tickStep = roundedMax / tickCount;
  const x = (i) => pad.left + (labels.length === 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
  const y = (v) => pad.top + plotH - (v / roundedMax) * plotH;
  const makePoints = (arr) => arr.map((v, i) => ({ x: x(i), y: y(v), v, label: labels[i] }));
  const proc = makePoints(procValues);
  const budget = makePoints(budgetValues);
  const contracted = makePoints(contractedValues);
  const grid = Array.from({ length: tickCount + 1 }, (_, i) => i * tickStep).map(v => `
    <line x1="${pad.left}" y1="${y(v)}" x2="${width - pad.right}" y2="${y(v)}" stroke="rgba(27,49,80,.10)" stroke-width="1" />
    <text x="${pad.left - 16}" y="${y(v) + 4}" text-anchor="end" fill="#6f8199" font-size="11">${fmtAxisCurrency(v)}</text>
  `).join('');
  const labelStep = Math.max(1, Number(curve.xLabelEvery || 2));
  const xLabelY = pad.top + plotH + 36;
  const xLabels = labels.map((label, i) => {
    if (i % labelStep !== 0 && i !== labels.length - 1) return '';
    return `
      <text x="${x(i)}" y="${xLabelY}" transform="rotate(-90 ${x(i)} ${xLabelY})" text-anchor="end" fill="#6f8199" font-size="10.5">${label}</text>
    `;
  }).join('');
  const dots = (pts, color) => pts.map((p, i) => {
    if (i % labelStep !== 0 && i !== pts.length - 1) return '';
    return `<circle cx="${p.x}" cy="${p.y}" r="2.6" fill="${color}"><title>${p.label}: ${fmtCurrency(p.v)}</title></circle>`;
  }).join('');
  const marker = curve.currentMarker;
  const markerSvg = marker ? `
    <circle cx="${x(marker.index)}" cy="${y(marker.procAbs)}" r="5.4" fill="#C61E1E" stroke="white" stroke-width="1.5">
      <title>${marker.label}: ${fmtCurrency(marker.procAbs)} ${esc(curve.markerMeaning || 'procurement cumulativo')}</title>
    </circle>` : '';

  return `
    <div class="chart-legend chart-legend-top">
      <span class="legend-chip"><i style="background:#2f68c8"></i>${esc(curve.procLegend || 'Procurement schedule cumulativo')}</span>
      <span class="legend-chip"><i style="background:#7EA73B"></i>Budget Baseline cumulativo</span>
      ${showContracted ? '<span class="legend-chip"><i style="background:#9AA5B5"></i>Contracted cumulativo</span>' : ''}
      ${marker ? '<span class="legend-chip"><i style="background:#C61E1E; width:10px; height:10px; border-radius:50%"></i>Stato attuale</span>' : ''}
    </div>
    <svg class="svg-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Curva S cumulata in PLN">
      ${grid}
      <path d="M ${polyline(proc)}" fill="none" stroke="#2f68c8" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M ${polyline(budget)}" fill="none" stroke="#7EA73B" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" />
      ${showContracted ? `<path d="M ${polyline(contracted)}" fill="none" stroke="#9AA5B5" stroke-width="2.4" stroke-dasharray="6 5" stroke-linecap="round" stroke-linejoin="round" />` : ''}
      ${dots(proc, '#2f68c8')}
      ${dots(budget, '#7EA73B')}
      ${showContracted ? dots(contracted, '#9AA5B5') : ''}
      ${markerSvg}
      ${xLabels}
    </svg>
  `;
}

function portfolioCurveSvg(curve, { height = 360, statusProgress = { headers: [], rows: [] }, ecDecision = { headers: [], rows: [] }, erRegister = { sections: [] } } = {}) {
  const labels = curve.labels || [];
  const series = (curve.series || []).filter(s => (s.values || []).some(v => v !== null && v !== undefined));
  const width = 980;
  const pad = { top: 26, right: 28, bottom: 76, left: 58 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  if (!labels.length || !series.length) return '<div class="meta-text">Carica il file S-Curve in Admin oppure lascialo nella cartella data/current per visualizzare il grafico.</div>';
  const x = (i) => pad.left + (labels.length === 1 ? plotW / 2 : (i / (labels.length - 1)) * plotW);
  const y = (v) => pad.top + plotH - ((Number(v || 0) / 100) * plotH);
  const fmtPctLabel = (v) => `${Number(v).toLocaleString('it-IT', {maximumFractionDigits:1, minimumFractionDigits:0})}%`;
  const valueAtLabel = (values = [], label) => {
    if (!label) return null;
    const idx = labels.findIndex(l => String(l).toLowerCase() === String(label).toLowerCase());
    if (idx === -1) return null;
    const v = values[idx];
    return v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v);
  };
  const lastNumeric = (values = []) => {
    for (let i = values.length - 1; i >= 0; i -= 1) {
      const v = values[i];
      if (v !== null && v !== undefined && !Number.isNaN(Number(v))) return Number(v);
    }
    return null;
  };
  const tickVals = [0, 25, 50, 75, 100];
  const grid = tickVals.map(v => `
    <line x1="${pad.left}" y1="${y(v)}" x2="${width - pad.right}" y2="${y(v)}" stroke="rgba(27,49,80,.10)" stroke-width="1" />
    <text x="${pad.left - 10}" y="${y(v) + 4}" text-anchor="end" fill="#6f8199" font-size="11">${v}%</text>
  `).join('');
  const labelStep = Math.max(1, Math.ceil(labels.length / 8));
  const xLabelY = pad.top + plotH + 22;
  const xLabels = labels.map((label, i) => {
    if (i % labelStep !== 0 && i !== labels.length - 1) return '';
    return `<text x="${x(i)}" y="${xLabelY}" text-anchor="middle" fill="#6f8199" font-size="10.5">${label}</text>`;
  }).join('');
  const paths = series.map((s) => {
    const points = [];
    const labelsSvg = [];
    let d = '';
    const isExecuted = /executed/i.test(String(s.name || '')) || String(s.color || '').toLowerCase() === '#7ea73b';
    (s.values || []).forEach((v, i) => {
      if (v === null || v === undefined || Number.isNaN(Number(v))) return;
      const px = x(i), py = y(v);
      points.push(`<circle cx="${px}" cy="${py}" r="2.7" fill="${s.color || '#2f68c8'}"><title>${s.name}: ${labels[i]} · ${Number(v).toLocaleString('it-IT', {maximumFractionDigits:1, minimumFractionDigits:1})}%</title></circle>`);
      if (isExecuted) {
        const labelY = Math.max(pad.top + 12, py - 10);
        labelsSvg.push(`<text x="${px}" y="${labelY}" text-anchor="middle" fill="${s.color || '#7EA73B'}" font-size="11" font-weight="700">${fmtPctLabel(v)}</text>`);
      }
      d += d ? ` L ${px} ${py}` : `M ${px} ${py}`;
    });
    return `${d ? `<path d="${d}" fill="none" stroke="${s.color || '#2f68c8'}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" />` : ''}${points.join('')}${labelsSvg.join('')}`;
  }).join('');
  const legend = series.map(s => `<span class="legend-chip"><i style="background:${s.color || '#2f68c8'}"></i>${esc(s.name)}</span>`).join('');
  const executedSeries = series.find(s => /executed/i.test(String(s.name || ''))) || series.find(s => String(s.color || '').toLowerCase() === '#7ea73b') || series[1] || series[0];
  const plannedSeries = series.find(s => /planned|plan/i.test(String(s.name || ''))) || series.find(s => String(s.color || '').toLowerCase() === '#2f68c8') || series[0] || executedSeries;
  const executedValues = executedSeries?.values || [];
  let referenceIndex = -1;
  for (let i = executedValues.length - 1; i >= 0; i -= 1) {
    const v = executedValues[i];
    if (v !== null && v !== undefined && !Number.isNaN(Number(v))) {
      referenceIndex = i;
      break;
    }
  }
  const referenceLabel = referenceIndex >= 0 ? labels[referenceIndex] : (labels[labels.length - 1] || null);
  const executedLast = referenceIndex >= 0 ? Number(executedValues[referenceIndex]) : lastNumeric(executedValues);
  const plannedValues = plannedSeries?.values || [];
  const plannedLast = referenceIndex >= 0 && plannedValues[referenceIndex] !== null && plannedValues[referenceIndex] !== undefined && !Number.isNaN(Number(plannedValues[referenceIndex]))
    ? Number(plannedValues[referenceIndex])
    : (referenceLabel !== null ? valueAtLabel(plannedValues, referenceLabel) : null) ?? lastNumeric(plannedValues);
  const statusRows = (statusProgress.rows || []).map((row) => ({
    category: row[0],
    actual: row[1],
    baseline: row[2],
  })).filter((row) => row.category);
  const detailRowsHtml = statusRows.map((row) => `
            <tr>
              <td>${esc(row.category)}</td>
              <td>${row.actual === null || row.actual === undefined || row.actual === '' ? '—' : fmtPctLabel(row.actual)}</td>
              <td>${row.baseline === null || row.baseline === undefined || row.baseline === '' ? '—' : fmtPctLabel(row.baseline)}</td>
            </tr>`).join('');
  const summaryTable = `
    <div class="delay-curve-summary">
      <div class="delay-curve-summary-title">Riepilogo finale</div>
      <div class="delay-curve-summary-subtitle">Confronto di percentuali tra Eseguito e Pianificato nel mese di riferimento: <strong>${esc(referenceLabel || '—')}</strong>.</div>
      <div class="table-wrap delay-curve-table-wrap">
        <table class="delay-curve-table">
          <thead>
            <tr>
              <th>Category</th>
              <th>Actual progress</th>
              <th>Baseline percentage forecast</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Project realization</td>
              <td>${executedLast === null ? '—' : fmtPctLabel(executedLast)}</td>
              <td>${plannedLast === null ? '—' : fmtPctLabel(plannedLast)}</td>
            </tr>
            ${detailRowsHtml}
          </tbody>
        </table>
      </div>
      <div class="delay-curve-ec-block">
        <div class="detail-note-title">EC decision</div>
        <p class="delay-curve-ec-subtitle">Tabella letta dal file presente in data/current oppure aggiornato in locale.</p>
        ${ecDecisionTableHtml(ecDecision, 'portfolio-ec-table-wrap')}
      </div>
      <div class="delay-curve-ec-block er-register-block">
        <div class="detail-note-title">ER decision / recommendation register</div>
        <p class="delay-curve-ec-subtitle">Tabella letta dal file <strong>ER_decision, recommendation register.xlsx</strong> in data/current. Se aggiorni quel file, la dashboard si aggiorna al refresh.</p>
        ${erRegisterHtml(erRegister)}
      </div>
    </div>`;
  return `
    <div class="delay-curve-head">
      <div>
        <div class="eyebrow dark">Portfolio</div>
        <h3>Project S-Curve</h3>
        <p>Dati letti dal file S-Curve presente in data/current o caricato in Admin.</p>
      </div>
      <div class="chart-legend chart-legend-top">${legend}</div>
    </div>
    <svg class="svg-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Project S-Curve">
      ${grid}
      ${paths}
      ${xLabels}
    </svg>
    ${summaryTable}
  `;
}

function donutSvg(items) {
  const width = 220, height = 220, r = 72, cx = 110, cy = 110;
  const colors = ['#2f68c8', '#58a66f', '#d69222', '#8455d8', '#da5d53', '#4b8fb9', '#7ca542', '#a1772d'];
  const total = items.reduce((sum, item) => sum + Number(item.updatedBudget || 0), 0) || 1;
  let angle = -Math.PI / 2;
  const arcs = items.slice(0, 6).map((item, i) => {
    const share = Number(item.updatedBudget || 0) / total;
    const next = angle + share * Math.PI * 2;
    const large = next - angle > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(angle), y1 = cy + r * Math.sin(angle);
    const x2 = cx + r * Math.cos(next), y2 = cy + r * Math.sin(next);
    const x3 = cx + (r - 22) * Math.cos(next), y3 = cy + (r - 22) * Math.sin(next);
    const x4 = cx + (r - 22) * Math.cos(angle), y4 = cy + (r - 22) * Math.sin(angle);
    const path = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${r - 22} ${r - 22} 0 ${large} 0 ${x4} ${y4} Z`;
    const seg = `<path d="${path}" fill="${colors[i % colors.length]}"><title>${item.code || item.name}: ${fmtCurrency(item.updatedBudget)} · ${fmtPct(item.sharePct)}</title></path>`;
    angle = next;
    return seg;
  }).join('');
  return `
    <svg class="svg-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Suddivisione costi">
      ${arcs}
      <circle cx="${cx}" cy="${cy}" r="38" fill="white" />
      <text x="${cx}" y="${cy - 4}" text-anchor="middle" fill="#6f8199" font-size="11">Top roots</text>
      <text x="${cx}" y="${cy + 18}" text-anchor="middle" fill="#1b3150" font-size="22" font-weight="800">${items.length}</text>
    </svg>
  `;
}

function orderPieSvg(items) {
  if (!items.length) return '<div class="meta-text">Nessun dato ordini disponibile.</div>';

  // The slices and the labels must use the same dynamic value-based logic.
  // This avoids the previous issue where "Da ordinare" had a custom fixed pointer
  // and could visually drift away from its slice when percentages changed.
  const width = 430, height = 285, cx = 215, cy = 132, r = 72;
  const toneMap = { green: '#2F9D58', amber: '#D59C1A', red: '#A61515', blue: '#2F68C8', neutral: '#B0B7C3' };
  const total = items.reduce((sum, item) => sum + Number(item.value || 0), 0) || 1;

  let angle = -Math.PI / 2;
  const raw = items.map((item) => {
    const share = Number(item.value || 0) / total;
    const startAngle = angle;
    const endAngle = angle + share * Math.PI * 2;
    const mid = startAngle + (endAngle - startAngle) / 2;
    angle = endAngle;
    return { item, startAngle, endAngle, mid, share };
  });

  // Build slice paths first.
  const segments = raw.map(({ item, startAngle, endAngle }) => {
    const large = endAngle - startAngle > Math.PI ? 1 : 0;
    const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle), y2 = cy + r * Math.sin(endAngle);
    const path = `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
    const color = toneMap[item.tone] || '#B0B7C3';
    return `<path d="${path}" fill="${color}" stroke="white" stroke-width="3"><title>${item.label}: ${fmtCurrency(item.value)} · ${item.sharePct}%</title></path>`;
  }).join('');

  // Dynamic label layout by side. All categories follow the same rule:
  // side depends on the slice midpoint, then label rows are clamped/spaced inside the SVG.
  const labelData = raw.map(({ item, mid }) => {
    const color = toneMap[item.tone] || '#B0B7C3';
    const side = Math.cos(mid) >= 0 ? 1 : -1;
    const edgeX = cx + (r + 4) * Math.cos(mid);
    const edgeY = cy + (r + 4) * Math.sin(mid);
    return {
      item,
      mid,
      side,
      color,
      edgeX,
      edgeY,
      labelY: Math.max(42, Math.min(height - 42, edgeY)),
    };
  });

  [-1, 1].forEach((side) => {
    const rows = labelData.filter((d) => d.side === side).sort((a, b) => a.labelY - b.labelY);
    const minGap = 47;
    for (let i = 1; i < rows.length; i += 1) {
      if (rows[i].labelY - rows[i - 1].labelY < minGap) {
        rows[i].labelY = rows[i - 1].labelY + minGap;
      }
    }
    const overflow = rows.length ? rows[rows.length - 1].labelY - (height - 42) : 0;
    if (overflow > 0) rows.forEach((row) => { row.labelY -= overflow; });
    for (let i = rows.length - 2; i >= 0; i -= 1) {
      if (rows[i + 1].labelY - rows[i].labelY < minGap) {
        rows[i].labelY = rows[i + 1].labelY - minGap;
      }
    }
    const underflow = rows.length ? 42 - rows[0].labelY : 0;
    if (underflow > 0) rows.forEach((row) => { row.labelY += underflow; });
  });

  const labels = labelData.map((d) => {
    const anchor = d.side > 0 ? 'start' : 'end';
    const textX = d.side > 0 ? width - 110 : 110;
    const lineEndX = d.side > 0 ? textX - 10 : textX + 10;
    const elbowX = cx + d.side * (r + 18);
    const labelY = d.labelY;
    return `
      <g class="pie-label-group">
        <path d="M ${d.edgeX} ${d.edgeY} L ${elbowX} ${labelY} L ${lineEndX} ${labelY}" fill="none" stroke="${d.color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="${d.edgeX}" cy="${d.edgeY}" r="2.8" fill="${d.color}" />
        <text x="${textX}" y="${labelY - 4}" text-anchor="${anchor}" fill="#18314F" font-size="13" font-weight="800">${d.item.label}</text>
        <text x="${textX}" y="${labelY + 13}" text-anchor="${anchor}" fill="#5A6F89" font-size="11.3" font-weight="700">Val. ${d.item.sharePct}% · N. ${d.item.countPct ?? '—'}%</text>
      </g>`;
  }).join('');

  return `
    <svg class="svg-chart order-pie-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Mix ordini">
      ${segments}
      ${labels}
      <circle cx="${cx}" cy="${cy}" r="3.6" fill="#ffffff" stroke="#d8e2ef" stroke-width="1.6" />
    </svg>
  `;
}

function metricTile({ key, label, value, hint, progress, tone = 'neutral', customHtml = '', extraClass = '', clickable = true }) {
  const isDeltaInline = key === 'delta-baseline';
  const isMoneyWide = ['baseline-budget', 'updated-budget', 'delta-baseline', 'contracted'].includes(key);
  const customClass = customHtml ? 'has-custom-content' : '';
  const clickableClass = clickable ? 'clickable' : 'not-clickable';
  const dataAttr = clickable ? `data-kpi="${key}"` : '';
  return `
    <article class="kpi-tile ${tone} ${clickableClass} ${isDeltaInline ? 'delta-inline' : ''} ${isMoneyWide ? 'money-wide' : ''} ${customClass} ${extraClass}" ${dataAttr}>
      ${customHtml || `
        <div class="label">${label}</div>
        <div class="value">${value}${isDeltaInline && hint ? ` <span class="inline-hint">(${String(hint).replace(/[()]/g, '')})</span>` : ''}</div>
        <div class="hint">${isDeltaInline ? '' : (hint || '')}</div>
        <div class="kpi-track"><span style="width:${Math.max(4, Math.min(100, progress || 0))}%"></span></div>
      `}
    </article>
  `;
}

const baselineBudgetOverviewHtml = `
  <div class="baseline-budget-overview">
    <div class="baseline-budget-overview-title">BASELINE BUDGET</div>
    <div class="baseline-budget-overview-row"><span>Costi diretti:</span><strong>501.457.853,00 PLN</strong></div>
    <div class="baseline-budget-overview-row"><span>Costi indiretti:</span><strong>40.355.205,00 PLN</strong></div>
    <div class="baseline-budget-overview-row"><span>Costi garanzia, difetti, imprevisti:</span><strong>22.098.535 PLN</strong></div>
    <div class="baseline-budget-overview-row baseline-total"><span>Totale costi:</span><strong>563.911.593,00 PLN</strong></div>
    <div class="baseline-budget-overview-row"><span>Ricavi base:</span><strong>627.086.000,00 PLN</strong></div>
    <div class="baseline-budget-overview-row"><span>Margine:</span><strong>63.174.407,00 PLN</strong></div>
    <div class="baseline-budget-overview-row"><span>% sui costi:</span><strong>11,20%</strong></div>
  </div>
`;

function fmtMoney2(value) {
  const n = Number(value || 0);
  return `${n.toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} PLN`;
}

function updatedBudgetOverviewHtml(summary) {
  const b = summary.updatedBudgetBreakdown || {};
  const marginPct = Number(b.totalCosts || 0) ? (Number(b.margin || 0) / Number(b.totalCosts || 0) * 100) : Number(b.marginPct || 0);
  return `
    <div class="baseline-budget-overview updated-budget-overview">
      <div class="baseline-budget-overview-title">UPDATED BUDGET</div>
      <div class="baseline-budget-overview-row"><span>Costi diretti:</span><strong>${fmtMoney2(b.directCosts)}</strong></div>
      <div class="baseline-budget-overview-row"><span>Costi indiretti:</span><strong>${fmtMoney2(b.indirectCosts)}</strong></div>
      <div class="baseline-budget-overview-row"><span>Costi garanzia, difetti, imprevisti:</span><strong>${fmtMoney2(b.contingency)}</strong></div>
      <div class="baseline-budget-overview-row baseline-total"><span>Totale costi:</span><strong>${fmtMoney2(b.totalCosts)}</strong></div>
      <div class="baseline-budget-overview-row"><span>Ricavi base:</span><strong>${fmtMoney2(b.baseRevenue)}</strong></div>
      <div class="baseline-budget-overview-row"><span>Margine:</span><strong>${fmtMoney2(b.margin)}</strong></div>
      <div class="baseline-budget-overview-row"><span>% sui costi:</span><strong>${fmtPct2(marginPct)}</strong></div>
    </div>
  `;
}

function costDetailOverviewHtml(summary) {
  const detail = summary.costDetail || state.dashboard?.overview?.costDetail || {};
  const rows = detail.rows || [];
  const orderedPct = Number(detail.orderedPct || 0);
  const toOrderPct = Number(detail.toOrderPct || 0);
  const money = (v) => fmtCurrency(Number(v || 0)).replace(' PLN', '');
  if (!rows.length) {
    return `
      <div class="cost-detail-overview">
        <div class="cost-detail-head"><span>Dettaglio Costi (PLN)</span><em>Dati non disponibili</em></div>
      </div>
    `;
  }
  return `
    <div class="cost-detail-overview">
      <div class="cost-detail-head">
        <span>Dettaglio Costi (PLN)</span>
        <em>ordini diretti · root 1-7</em>
      </div>
      <div class="cost-detail-grid cost-detail-grid-head">
        <span></span><strong>Ordinato</strong><strong>Da Ordinare*</strong>
      </div>
      <div class="cost-detail-rows">
        ${rows.map(r => `
          <div class="cost-detail-grid">
            <span>${esc(r.label)}</span>
            <strong>${money(r.ordered)}</strong>
            <strong>${money(r.toOrder)}</strong>
          </div>
        `).join('')}
      </div>
      <div class="cost-detail-grid cost-detail-total">
        <span>Totale</span>
        <strong>${money(detail.ordered)} (${fmtPct(orderedPct)})</strong>
        <strong>${money(detail.toOrder)} (${fmtPct(toOrderPct)})</strong>
      </div>
    </div>
  `;
}

function renderHero(summary) {
  const status = $('overall-status');
  if (status) status.style.display = 'none';
  $('executive-message').innerHTML = 'Numeri chiave e curva S per capire subito ordini,<br>budget aggiornato e stato reale.';
  const deltaTone = Number(summary.varianceAmount || 0) >= 0 ? 'amber' : 'green';
  const items = [
    { key: 'baseline-budget', label: 'Baseline Budget', value: fmtCurrency(summary.budgetAbTotal), hint: 'Budget di riferimento (AB)', progress: 100, tone: 'neutral', customHtml: baselineBudgetOverviewHtml, extraClass: 'baseline-breakdown-tile', clickable: false },
    { key: 'updated-budget-breakdown', label: 'Updated Budget', value: fmtCurrency(summary.updatedBudgetTotal), hint: '', progress: 100, tone: 'neutral', customHtml: updatedBudgetOverviewHtml(summary), extraClass: 'updated-breakdown-tile', clickable: false },
    { key: 'cost-detail', label: 'Dettaglio Costi', value: '', hint: '', progress: 100, tone: 'neutral', customHtml: costDetailOverviewHtml(summary), extraClass: 'cost-detail-tile', clickable: false },
    { key: 'contracted', label: 'Contracted', value: fmtCurrency(summary.contractedTotal), hint: `${fmtPct(summary.contractCoveragePct)} copertura`, progress: summary.contractCoveragePct, tone: summary.contractCoveragePct >= 70 ? 'green' : 'amber' },
    { key: 'overdue', label: 'Overdue', value: `${summary.overdueCount}`, hint: summary.overdueCount > 0 ? 'Da seguire' : 'Sotto controllo', progress: Math.min(100, summary.overdueCount * 8 + 6), tone: summary.overdueCount > 0 ? 'red' : 'green' },
  ];
  const target = $('hero-kpis');
  if (target) target.innerHTML = items.map(metricTile).join('');
}

function renderOverviewNote(summary) {
  const target = $('overview-note');
  if (!target) return;
  const overview = state.dashboard?.overview || {};
  const curve = activeSCurve(overview);
  const marker = curve?.currentMarker || {};
  const modeTitle = curve?.shortLabel || (curve?.mode === 'B' ? 'Opzione B' : 'Opzione A');
  const month = marker.label || summary.curveCurrentMonth || 'mese corrente';
  const meaning = curve?.markerMeaning || 'Stato attuale = valore cumulativo della curva blu al mese corrente.';
  target.innerHTML = `<strong>${esc(modeTitle)}</strong> · ${esc(meaning)} <span class="note-soft">Mese: <strong>${esc(month)}</strong>.</span>`;
}

function activeSCurve(overview) {
  const options = overview?.sCurveOptions || {};
  return options[state.sCurveMode] || overview?.sCurve || {};
}

function bindSCurveModeToggle() {
  const wrap = $('scurve-mode-toggle');
  if (!wrap || wrap.dataset.bound === '1') return;
  wrap.dataset.bound = '1';
  wrap.addEventListener('click', (event) => {
    const btn = event.target.closest('[data-scurve-mode]');
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    state.sCurveMode = btn.dataset.scurveMode || 'A';
    localStorage.setItem('wteSCurveMode', state.sCurveMode);
    const overview = state.dashboard?.overview || {};
    const curve = activeSCurve(overview);
    renderCurve(curve);
    renderCurveSummary(curve);
    renderOverviewNote(state.dashboard?.summary || {});
    updateSCurveModeToggle();
  });
}

function updateSCurveModeToggle() {
  document.querySelectorAll('[data-scurve-mode]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.scurveMode === state.sCurveMode);
  });
}

function renderCurve(curve) {
  const target = $('curve-chart');
  if (!target) return;
  const description = curve.description || 'Curva S cumulativa in PLN.';
  const modeTitle = curve.title || 'Curva S cumulata';
  target.innerHTML = `<div class="scurve-mode-description"><strong>${esc(modeTitle)}</strong><span>${esc(description)}</span></div>${lineChartSvg(curve, { showContracted: false })}`;
  updateSCurveModeToggle();
}

function renderCurveSummary(curve) {
  const target = $('curve-summary');
  if (!target) return;
  const marker = curve?.currentMarker || {};
  const proc = Number(marker.procAbs || 0);
  const budget = Number(marker.budgetAbs || 0);
  const delta = proc - budget;
  const deltaTone = delta >= 0 ? 'green' : 'red';
  const markerLabel = marker.label || '—';
  target.innerHTML = `
    <div class="curve-summary-grid">
      <div class="curve-stat clickable" data-detail="curve">
        <span class="label">Mese attuale</span>
        <strong>${esc(markerLabel)}</strong>
      </div>
      <div class="curve-stat clickable" data-detail="curve">
        <span class="label">Proc. cumulativo</span>
        <strong>${fmtCurrencyCompact(proc)}</strong>
      </div>
      <div class="curve-stat clickable" data-detail="curve">
        <span class="label">Budget cumulativo</span>
        <strong>${fmtCurrencyCompact(budget)}</strong>
      </div>
      <div class="curve-stat ${deltaTone} clickable" data-detail="curve">
        <span class="label">Scostamento</span>
        <strong>${delta >= 0 ? '+' : ''}${fmtCurrencyCompact(delta)}</strong>
      </div>
    </div>
  `;
}

function renderSnapshot(summary, criticalPackages) {
  const cards = [
    { key: 'closed-finalized-pct', label: 'Closed + PCT', metric: `${summary.closedCount + summary.pctApprovalCount}`, meta: fmtCurrency(summary.pctApprovalValue), tone: 'green' },
    { key: 'contract-preparation', label: 'Contract preparation', metric: `${summary.contractPrepCount}`, meta: fmtCurrency(summary.contractPrepValue), tone: 'amber' },
    { key: 'specifiche-emesse', label: 'Pacchetti in definizione', metric: `${summary.specsIssuedCount || 0}`, meta: fmtCurrency(summary.specsIssuedValue || 0), tone: 'amber' },
    { key: 'packages-overdue', label: 'Packages overdue', metric: `${summary.overdueCount}`, meta: summary.overdueCount > 0 ? 'Need escalation' : 'Under control', tone: summary.overdueCount > 0 ? 'red' : 'green' },
  ];
  const snap = $('snapshot-grid');
  if (snap) snap.innerHTML = cards.map(c => `
    <div class="snapshot-card ${c.tone} clickable" data-kpi="${c.key}">
      <div class="eyebrow dark">${c.label}</div>
      <div class="metric">${c.metric}</div>
      <div class="meta">${c.meta}</div>
    </div>
  `).join('');

  const crit = $('critical-list');
  if (crit) crit.innerHTML = criticalPackages.slice(0, 4).map(row => `
    <article class="critical-item" data-package="${row.code}">
      <div class="top"><strong>${row.code} · ${esc(row.name)}</strong>${pill(row.status)}</div>
      <p>${fmtCurrency(row.updatedBudget)} · ${row.overdueDays ? row.overdueDays + ' d late' : 'on schedule'} · ${fmtDate(row.deadlineClosing)}</p>
    </article>
  `).join('');
}

function renderCostBreakdown(items) {
  $('cost-donut').innerHTML = donutSvg(items);
  $('cost-breakdown-list').innerHTML = items.slice(0, 6).map(item => `
    <div class="legend-row clickable" data-root="${item.code}">
      <div class="legend-row-head"><strong>${item.code} · ${esc(item.name)}</strong><span class="meta-text">${fmtPct(item.sharePct)}</span></div>
      <div class="meta-text">${fmtCurrency(item.updatedBudget)} · Baseline Budget ${fmtCurrency(item.budgetAb)}</div>
      <div class="progress-track"><span class="progress-${toneClass(item.health)}" style="width:${Math.max(3, item.sharePct)}%"></span></div>
    </div>
  `).join('');
}

function renderCategories(items) {
  const max = Math.max(...items.map(x => x.updatedBudget), 1);
  $('category-bars').innerHTML = items.slice(0, 8).map(item => `
    <div class="bar-row clickable" data-category="${esc(item.name)}">
      <div class="bar-row-head"><strong>${esc(item.name)}</strong><span class="meta-text">${item.count} item · ${fmtCurrency(item.updatedBudget)}</span></div>
      <div class="bar-shell"><span class="progress-blue" style="width:${(item.updatedBudget / max) * 100}%"></span></div>
    </div>
  `).join('');
}

function orderCard(title, bucket, tone, detailKey) {
  return `
    <article class="order-card clickable" data-detail="${detailKey}">
      <header>
        <h3>${title}</h3>
        <span class="pill ${tone}">${bucket.count} items</span>
      </header>
      <div class="order-metrics">
        <div><div class="big">${fmtCurrency(bucket.value)}</div><div class="small">Valore totale</div></div>
      </div>
      <div class="order-lines">
        ${(bucket.items || []).slice(0,3).map(item => `
          <div class="order-line" data-package="${item.code}">
            <div class="order-line-head"><strong>${item.code} · ${esc(item.name)}</strong>${pill(item.status)}</div>
            <div class="meta-text">${fmtCurrency(item.updatedBudget)} · ${fmtDate(item.deadlineClosing || item.deadlineProc || item.startProc)}</div>
          </div>
        `).join('')}
      </div>
    </article>
  `;
}

function renderOrdersStatus(ordersClosing, specsIssued, orderMix = []) {
  const target = $('orders-status');
  if (!target) return;
  target.innerHTML = `
    <div class="minimal-orders-layout">
      <div class="order-pie-card clickable" data-detail="orders-status">
        <div class="subhead-row compact-sub"><h3>Mix ordini diretti</h3><span class="meta-text">solo ordini diretti · fetta = valore · N. = pacchetti</span></div>
        ${orderPieSvg(orderMix)}
        <div class="pie-scope-note">Nota: il grafico considera solo gli ordini diretti (root group 1–7). Sono esclusi indiretti, servizi e rischi/opportunità.</div>
      </div>
      <div class="minimal-order-summary">
        <div class="order-card clickable compact-order-card compact-order-metric-card" data-detail="orders-status">
          <header>
            <h3>Ordini in chiusura</h3>
            <span class="pill amber">${ordersClosing.count}</span>
          </header>
          <div class="order-card-value">${fmtCurrency(ordersClosing.value)}</div>
        </div>
        <div class="order-card clickable compact-order-card compact-order-metric-card" data-detail="orders-status">
          <header>
            <h3>Pacchetti in definizione</h3>
            <span class="pill amber">${specsIssued.count}</span>
          </header>
          <div class="order-card-value">${fmtCurrency(specsIssued.value)}</div>
        </div>
      </div>
    </div>
  `;
}

function timelineHtml(timeline) {
  const months = timeline.labels || [];
  if (!months.length) return '<div class="meta-text">Nessun dato timeline disponibile.</div>';
  const items = timeline.items || [];
  const monthCount = months.length;
  const idx = Object.fromEntries((timeline.months || []).map((m, i) => [m, i]));
  const header = [`<div class="cell head">Package</div>`].concat(months.map(m => `<div class="cell head">${m}</div>`)).join('');
  const rows = items.map(item => {
    const start = idx[(item.start || item.end || '').slice(0,7)] ?? 0;
    const end = idx[(item.end || item.start || '').slice(0,7)] ?? start;
    const left = (start / Math.max(monthCount, 1)) * 100;
    const width = ((Math.max(end, start) - start + 1) / Math.max(monthCount, 1)) * 100;
    return `
      <div class="cell label-cell clickable" data-package="${item.code}">
        <div class="label-title">${item.code} · ${esc(item.name)}</div>
        <div class="label-sub">${fmtCurrency(item.updatedBudget)} · ${item.overdueDays ? item.overdueDays + ' d late' : 'on schedule'}</div>
      </div>
      <div class="cell timeline-bar-cell clickable" data-package="${item.code}" style="grid-column: 2 / span ${monthCount}; border-right:0;">
        <div class="timeline-bar ${toneClass(item.tone)}" style="left:${left}%; width:${Math.max(width, 9)}%">${item.status || 'planned'}</div>
      </div>
    `;
  }).join('');
  return `<div class="timeline-grid" style="--month-count:${monthCount}">${header}${rows}</div>`;
}

function renderTimeline(timeline) {
  $('timeline-view').innerHTML = timelineHtml(timeline);
}

function renderRoots(rows) {
  $('root-grid').innerHTML = rows.map(row => `
    <article class="root-card clickable" data-root="${row.code}">
      <div class="legend-row-head"><strong>${row.code} · ${esc(row.name)}</strong><span class="pill ${rootPillTone(row)}">${row.dominantStatus || 'No status'}</span></div>
      <div class="row"><span>Updated Budget</span><strong>${fmtCurrency(row.updatedBudget)}</strong></div>
      <div class="row"><span>Contracted</span><strong>${fmtCurrency(row.contractedValue)}</strong></div>
      <div class="row"><span>Completion</span><strong>${fmtPct(row.completionPct)}</strong></div>
      <div class="row"><span>Coverage</span><strong>${fmtPct(row.contractCoveragePct)}</strong></div>
    </article>
  `).join('');
}

function renderToAwardByRootChart(rows) {
  const target = $('to-award-root-chart');
  if (!target) return;
  if (!rows.length) {
    target.innerHTML = '';
    return;
  }
  const data = rows.map(row => {
    const contracted = Number(row.contractedValue || 0);
    const updated = Number(row.updatedBudget || 0);
    const toAward = Math.max(updated - contracted, 0);
    return { ...row, contracted, updated, toAward };
  }).sort((a, b) => b.toAward - a.toAward);

  const rowsHtml = data.map(row => {
    const total = Math.max(row.updated, 0);
    const contractedPct = total > 0 ? Math.min((row.contracted / total) * 100, 100) : 0;
    const toAwardPct = total > 0 ? Math.min((row.toAward / total) * 100, 100 - contractedPct) : 0;
    return `
      <div class="to-award-row clickable" data-root="${row.code}">
        <div class="to-award-row-head">
          <strong>${row.code} · ${esc(row.name)}</strong>
          <span class="meta-text">${fmtCurrency(row.updated)} updated budget</span>
        </div>
        <div class="to-award-row-body">
          <div class="to-award-bar-shell">
            <span class="to-award-bar contracted" style="width:${contractedPct}%"></span>
            <span class="to-award-bar open" style="left:${contractedPct}%; width:${toAwardPct}%"></span>
          </div>
          <div class="to-award-value">${fmtCurrency(row.toAward)}</div>
        </div>
      </div>`;
  }).join('');

  target.innerHTML = `
    <div class="to-award-section-head">
      <div>
        <div class="eyebrow dark">Portfolio</div>
        <h3>To award by root group</h3>
      </div>
      <div class="to-award-legend">
        <span class="legend-badge"><i class="legend-dot blue"></i>Contracted</span>
        <span class="legend-badge"><i class="legend-dot red"></i>To award</span>
      </div>
    </div>
    <div class="to-award-chart-list">${rowsHtml}</div>
  `;
}

function renderDelayBars(rows) {
  const max = Math.max(...rows.map(x => x.value), 1);
  $('delay-bars').innerHTML = rows.map(row => `
    <div class="bar-row clickable" data-delay-root="${row.code}">
      <div class="bar-row-head"><strong>${row.code} · ${esc(row.name)}</strong><span class="meta-text">${row.count} delayed · ${fmtCurrency(row.value)}</span></div>
      <div class="bar-shell"><span class="progress-red" style="width:${(row.value / max) * 100}%"></span></div>
    </div>
  `).join('');
}

function renderOverruns(rows) {
  $('overrun-table').innerHTML = rows.map(row => `
    <tr data-package="${row.code}" class="clickable">
      <td><strong>${row.code}</strong></td>
      <td>${esc(row.name)}</td>
      <td>${fmtCurrency(row.budgetAb)}</td>
      <td>${fmtCurrency(row.updatedBudget)}</td>
      <td>${fmtCurrency(row.varianceAmount)}</td>
    </tr>
  `).join('');
}

function currentMonthInputValue() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabelFromValue(monthValue) {
  if (!monthValue || !/^\d{4}-\d{2}$/.test(monthValue)) return 'mese selezionato';
  const [year, month] = monthValue.split('-').map(Number);
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString('it-IT', { month: 'long', year: 'numeric' });
}

function monthMatches(dateStr, monthValue) {
  return Boolean(dateStr && monthValue && String(dateStr).slice(0, 7) === monthValue);
}

function monthMilestones(row, monthValue) {
  return [
    { key: 'startProc', label: 'Start Proc.', value: row.startProc },
    { key: 'deadlineProc', label: 'Deadline Proc.', value: row.deadlineProc },
    { key: 'deadlineClosing', label: 'Deadline Closing', value: row.deadlineClosing },
  ].filter(item => monthMatches(item.value, monthValue));
}

function plannedRowsForMonth(monthValue) {
  return (state.dashboard?.directPackages || [])
    .filter(row => (row.depth || 0) >= 2)
    .map(row => {
      const milestones = monthMilestones(row, monthValue);
      const firstDate = milestones.map(m => m.value).sort()[0] || null;
      return {
        ...row,
        monthMilestones: milestones,
        monthMilestoneLabel: milestones.map(m => `${m.label}: ${fmtDate(m.value)}`).join(' · '),
        monthPlanDate: firstDate,
      };
    })
    .filter(row => row.monthMilestones.length > 0)
    .sort((a, b) => {
      const ad = a.monthPlanDate || '9999-12-31';
      const bd = b.monthPlanDate || '9999-12-31';
      return ad.localeCompare(bd) || Number(b.updatedBudget || 0) - Number(a.updatedBudget || 0);
    });
}

function showMonthlyPlanDetail(monthValue) {
  const selectedMonth = monthValue || currentMonthInputValue();
  const rows = plannedRowsForMonth(selectedMonth);
  const overdueRows = rows.filter(r => Number(r.overdueDays || 0) > 0);
  const totalValue = rows.reduce((sum, row) => sum + Number(row.updatedBudget || 0), 0);
  const contractedValue = rows.reduce((sum, row) => sum + Number(row.contractedValue || 0), 0);
  const subtitle = `Attività pianificate nel procurement schedule per ${monthLabelFromValue(selectedMonth)}.`;
  const metrics = [
    makeMetric('Attività trovate', `${rows.length}`, 'nel mese selezionato'),
    makeMetric('Valore Updated Budget', fmtCurrency(totalValue), ''),
    makeMetric('Contracted', fmtCurrency(contractedValue), ''),
    makeMetric('Scadute', `${overdueRows.length}`, 'evidenziate in rosso'),
  ].join('');

  const legend = `
    <div class="detail-legend">
      <span class="legend-badge"><i class="legend-dot blue"></i>Attività pianificata nel mese selezionato</span>
      <span class="legend-badge"><i class="legend-dot red"></i>Attività scaduta / in ritardo</span>
    </div>`;

  const empty = '<div class="detail-card"><div class="meta-text">Nessuna attività pianificata per il mese selezionato.</div></div>';
  const content = rows.length ? legend + tableFromRows(rows, [
    { label: 'WBS', key: 'code', render: r => `<strong>${r.code}</strong>` },
    { label: 'Package', key: 'name', render: r => esc(r.name) },
    { label: 'Milestone nel mese', key: 'monthMilestoneLabel', render: r => esc(r.monthMilestoneLabel) },
    { label: 'Status', key: 'status', render: r => pill(r.status) },
    { label: 'Updated Budget', key: 'updatedBudget', className: 'nowrap-cell col-money', render: r => fmtCurrency(r.updatedBudget) },
    { label: 'Contracted', key: 'contractedValue', className: 'nowrap-cell col-money', render: r => fmtCurrency(r.contractedValue) },
    { label: 'Ritardo', key: 'overdueDays', render: r => Number(r.overdueDays || 0) > 0 ? `<strong>${r.overdueDays} d</strong>` : '—' },
  ], { rowClass: r => Number(r.overdueDays || 0) > 0 ? 'row-overdue' : '' }) : empty;

  openDetail('Procurement monthly check', subtitle, metrics, content);
}

function bindMonthCheck() {
  const input = $('month-check-input');
  const button = $('month-check-button');
  const hint = $('month-check-hint');
  if (!input || !button) return;
  if (!input.value) input.value = currentMonthInputValue();
  button.addEventListener('click', () => {
    const value = input.value || currentMonthInputValue();
    if (hint) hint.textContent = `Filtro pronto: ${monthLabelFromValue(value)}.`;
    showMonthlyPlanDetail(value);
  });
}

function renderVersionsInfo(meta) {
  const versions = meta?.versions || {};
  const budgetNode = $('budget-version');
  const procurementNode = $('procurement-version');
  const updatedNode = $('versions-updated');
  if (budgetNode) budgetNode.textContent = versions.budgetVersion || '—';
  if (procurementNode) procurementNode.textContent = versions.procurementVersion || '—';
  if (updatedNode) updatedNode.textContent = '';
}

function renderDashboard(data) {
  state.dashboard = data;
  const { meta, summary, overview } = data;
  $('project-title').textContent = meta.projectTitle;
  $('generated-at').textContent = meta.generatedAt ? new Date(meta.generatedAt).toLocaleString('it-IT') : '—';
  renderVersionsInfo(meta);
  const sourceFilesNode = $('source-files');
  if (sourceFilesNode) sourceFilesNode.textContent = [meta.sourceFiles.budget, meta.sourceFiles.procurement, meta.sourceFiles.scurve, meta.sourceFiles.ecdecision, meta.sourceFiles.statusprogress, meta.sourceFiles.erregister, meta.sourceFiles.milestones].filter(Boolean).join(' · ') || '—';
  const monthInput = $('month-check-input');
  if (monthInput && !monthInput.value) monthInput.value = currentMonthInputValue();
  renderHero(summary);
  renderOverviewNote(summary);
  bindSCurveModeToggle();
  const activeCurve = activeSCurve(overview);
  renderCurve(activeCurve);
  renderCurveSummary(activeCurve);
  renderSnapshot(summary, data.criticalPackages || []);
  renderOrdersStatus(overview.ordersClosing || { count:0, value:0, items:[] }, overview.specsIssued || { count:0, value:0, items:[] }, overview.orderMix || []);
  renderRoots(data.rootGroups || []);
  renderToAwardByRootChart(data.rootGroups || []);
  renderProgramMilestones(data.programMilestones || { headers: [], rows: [] });
  renderDelayBars(data.delayedByRoot || []);
  renderDelayCurve(data.portfolioCurve || {}, data.statusProgress || { headers: [], rows: [] }, data.ecDecision || { headers: [], rows: [] }, data.erRegister || { sections: [] });
  renderOverruns(data.topOverruns || []);
  renderEcDecision(data.ecDecision || { headers: [], rows: [] });
}

function fmtEcCell(value, header = "") {
  if (value === null || value === undefined || value === "") return "—";
  const h = String(header || "").toLowerCase();
  if (typeof value === "number") {
    if (h.includes("amount")) return fmtCurrency(value);
    return Number.isInteger(value) ? value.toLocaleString("it-IT") : value.toLocaleString("it-IT", { maximumFractionDigits: 2 });
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return fmtDate(value);
  }
  return esc(value);
}

function ecDecisionTableHtml(ec, extraClass = "") {
  const headers = ec.headers || [];
  const rows = ec.rows || [];
  if (!headers.length || !rows.length) {
    return `<div class="meta-text">Nessun dato disponibile. Inserisci o aggiorna il file EC decision in data/current.</div>`;
  }
  const thead = headers.map(h => `<th>${esc(h)}</th>`).join("");
  const tbody = rows.map(row => `<tr>${row.map((cell, idx) => `<td>${fmtEcCell(cell, headers[idx])}</td>`).join("")}</tr>`).join("");
  return `<div class="table-wrap admin-ec-table-wrap ${extraClass}"><table class="admin-ec-table"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`;
}

function erRegisterHtml(register) {
  const sections = register?.sections || [];
  if (!sections.length) {
    return `<div class="meta-text">Nessun dato disponibile. Inserisci il file ER_decision, recommendation register.xlsx in data/current.</div>`;
  }
  return sections.map(section => {
    const title = section.title || section.sourceSheet || 'ER register';
    const headers = section.headers || [];
    const rows = section.rows || [];
    if (!headers.length || !rows.length) {
      return `<div class="er-register-section"><div class="er-register-title">${esc(title)}</div><div class="meta-text">Nessun dato disponibile per questo sheet.</div></div>`;
    }
    const table = ecDecisionTableHtml(section, 'portfolio-er-table-wrap');
    return `<div class="er-register-section"><div class="er-register-title">${esc(title)}</div>${table}</div>`;
  }).join('');
}

function programMilestonesHtml(milestones) {
  const headers = milestones?.headers || [];
  const rows = milestones?.rows || [];
  if (!headers.length || !rows.length) {
    return `<div class="meta-text">Nessun dato disponibile. Inserisci o aggiorna il file Programma Wloclawek_Milestones.xlsx in data/current.</div>`;
  }
  const thead = headers.map(h => `<th>${esc(h)}</th>`).join("");
  const tbody = rows.map((rowObj) => {
    const cells = Array.isArray(rowObj) ? rowObj : (rowObj.cells || []);
    const isGroup = !Array.isArray(rowObj) && rowObj.isGroup;
    if (isGroup) {
      return `<tr class="program-milestones-group"><td colspan="${headers.length}">${esc(cells[1] || '')}</td></tr>`;
    }
    return `<tr>${headers.map((h, idx) => `<td>${fmtEcCell(cells[idx], h)}</td>`).join("")}</tr>`;
  }).join("");
  return `<div class="table-wrap program-milestones-table-wrap"><table class="program-milestones-table"><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table></div>`;
}

function renderProgramMilestones(milestones) {
  const node = $("programme-milestones");
  if (!node) return;
  node.innerHTML = `
    <div class="programme-milestones-head">
      <div>
        <div class="detail-note-title">Programma Wloclawek - Milestones</div>
        <p>Tabella letta dal file <strong>Programma Wloclawek_Milestones.xlsx</strong> in data/current. Se aggiorni quel file, la dashboard si aggiorna al refresh.</p>
      </div>
    </div>
    ${programMilestonesHtml(milestones)}
  `;
}

function renderEcDecision(ec) {
  const node = $("ec-decision-table");
  if (!node) return;
  node.innerHTML = ecDecisionTableHtml(ec);
}

function renderDelayCurve(curve, statusProgress, ecDecision, erRegister) {
  const target = $('delay-curve');
  if (!target) return;
  target.innerHTML = portfolioCurveSvg(curve || {}, { statusProgress: statusProgress || { headers: [], rows: [] }, ecDecision: ecDecision || { headers: [], rows: [] }, erRegister: erRegister || { sections: [] } });
}

function packageByCode(code) {
  return (state.dashboard?.directPackages || []).find(x => x.code === code);
}

function openDetail(title, subtitle, metricsHtml, contentHtml) {
  if (state.currentView) state.viewStack.push({ ...state.currentView });
  $('detail-title').textContent = title;
  $('detail-subtitle').textContent = subtitle || '—';
  $('detail-metrics').innerHTML = metricsHtml || '';
  $('detail-content').innerHTML = contentHtml || '';
  document.querySelectorAll('.tab').forEach(btn => btn.classList.toggle('active', btn.dataset.tab === 'detail'));
  document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.toggle('active', panel.id === 'detail-tab'));
  state.currentView = { type: 'detail', title, subtitle, metricsHtml, contentHtml };
}

function tableFromRows(rows, columns, options = {}) {
  const rowClassFn = options.rowClass || (() => '');
  const tableClass = options.tableClass || '';
  return `
    <div class="table-wrap"><table${tableClass ? ` class="${tableClass}"` : ''}><thead><tr>${columns.map(c => `<th${c.className ? ` class="${c.className}"` : ''}>${c.label}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(row => {
      const classes = [row.code ? 'clickable' : '', rowClassFn(row)].filter(Boolean).join(' ');
      const attrs = `${row.code ? `data-package="${row.code}"` : ''}${classes ? ` class="${classes}"` : ''}`.trim();
      return `<tr ${attrs}>${columns.map(c => `<td${c.className ? ` class="${c.className}"` : ''}>${c.render ? c.render(row) : esc(row[c.key])}</td>`).join('')}</tr>`;
    }).join('')}</tbody></table></div>
  `;
}

function procurementDetailColumns({ includeSupplier = false } = {}) {
  const cols = [
    { label: 'WBS', key: 'code', render: r => `<strong>${r.code}</strong>` },
    { label: 'Package', key: 'name' },
    { label: 'Status', key: 'status', render: r => pill(r.status) },
  ];
  if (includeSupplier) {
    cols.push({
      label: 'Subappaltatore / Fornitore',
      key: 'company',
      className: 'col-supplier',
      render: r => esc(r.company || '—'),
    });
  }
  cols.push(
    { label: 'Updated Budget', key: 'updatedBudget', className: 'nowrap-cell col-money', render: r => fmtCurrency(r.updatedBudget) },
    { label: 'Contracted', key: 'contractedValue', className: 'nowrap-cell col-money', render: r => fmtCurrency(r.contractedValue) },
    { label: 'Delta', key: 'deltaToContract', className: 'nowrap-cell col-money', render: r => fmtSignedCurrency(contractDelta(r)) },
    { label: 'Deadline', key: 'deadlineClosing', render: r => fmtDate(r.deadlineClosing) },
  );
  return cols;
}

function showPackageDetail(code) {
  const pkg = packageByCode(code);
  if (!pkg) return;
  const metrics = [
    makeMetric('Updated Budget', fmtCurrency(pkg.updatedBudget), 'Nuovo budget aggiornato'),
    makeMetric('Baseline Budget', fmtCurrency(pkg.budgetAb), 'Budget di riferimento'),
    makeMetric('Contracted', fmtCurrency(pkg.contractedValue), fmtPct(pkg.updatedBudget ? (pkg.contractedValue / pkg.updatedBudget * 100) : 0)),
    makeMetric('Variance', fmtPct(pkg.variancePct), fmtCurrency(pkg.varianceAmount)),
  ].join('');
  const content = `
    <div class="detail-card">
      <h3>Package data</h3>
      <div class="detail-grid">
        <div class="item"><div class="key">WBS</div><div class="val">${pkg.code}</div></div>
        <div class="item"><div class="key">Package</div><div class="val">${esc(pkg.name)}</div></div>
        <div class="item"><div class="key">Status</div><div class="val">${pill(pkg.status)}</div></div>
        <div class="item"><div class="key">Category</div><div class="val">${esc(pkg.category || '—')}</div></div>
        <div class="item"><div class="key">Buyer</div><div class="val">${esc(pkg.buyer || '—')}</div></div>
        <div class="item"><div class="key">Company</div><div class="val">${esc(pkg.company || '—')}</div></div>
        <div class="item"><div class="key">Site Resp.</div><div class="val">${esc(pkg.siteResp || '—')}</div></div>
        <div class="item"><div class="key">TME Resp.</div><div class="val">${esc(pkg.tmeResp || '—')}</div></div>
        <div class="item"><div class="key">Start Proc.</div><div class="val">${fmtDate(pkg.startProc)}</div></div>
        <div class="item"><div class="key">Deadline Proc.</div><div class="val">${fmtDate(pkg.deadlineProc)}</div></div>
        <div class="item"><div class="key">Deadline Closing</div><div class="val">${fmtDate(pkg.deadlineClosing)}</div></div>
        <div class="item"><div class="key">Execution</div><div class="val">${fmtDate(pkg.startExecution)} → ${fmtDate(pkg.endExecution)}</div></div>
        <div class="item"><div class="key">Overdue</div><div class="val">${pkg.overdueDays ? pkg.overdueDays + ' days' : 'No'}</div></div>
        <div class="item"><div class="key">Comment</div><div class="val">${esc(pkg.comment || '—')}</div></div>
      </div>
    </div>
  `;
  openDetail(`${pkg.code} · ${pkg.name}`, 'Dettaglio package. Con il pulsante Back torni alla vista precedente.', metrics, content);
}

function showRootDetail(code) {
  const root = (state.dashboard?.rootGroups || []).find(x => x.code === code);
  if (!root) return;
  const rows = (state.dashboard?.directPackages || [])
    .filter(x => x.rootCode === code && String(x.code || '').includes('.'))
    .sort((a,b) => (b.updatedBudget - a.updatedBudget));
  const metrics = [
    makeMetric('Updated Budget', fmtCurrency(root.updatedBudget), ''),
    makeMetric('Contracted', fmtCurrency(root.contractedValue), fmtPct(root.contractCoveragePct)),
    makeMetric('Completion', fmtPct(root.completionPct), root.dominantStatus || 'No status'),
    makeMetric('Coverage', fmtPct(root.contractCoveragePct), 'Contracted / Updated Budget'),
  ].join('');
  const content = tableFromRows(rows, procurementDetailColumns({ includeSupplier: true }), { tableClass: 'supplier-detail-table' });
  openDetail(`${root.code} · ${root.name}`, 'Dettaglio root group.', metrics, content);
}


function showDelayedRootDetail(code) {
  const root = (state.dashboard?.rootGroups || []).find(x => x.code === code) || { code, name: code };
  const rows = (state.dashboard?.directPackages || [])
    .filter(x => x.rootCode === code && String(x.code || '').includes('.') && Number(x.overdueDays || 0) > 0)
    .sort((a,b) => Number(b.overdueDays || 0) - Number(a.overdueDays || 0) || Number(b.updatedBudget || 0) - Number(a.updatedBudget || 0));
  const totalValue = rows.reduce((sum, r) => sum + Number(r.updatedBudget || 0), 0);
  const maxDelay = rows.reduce((max, r) => Math.max(max, Number(r.overdueDays || 0)), 0);
  const metrics = [
    makeMetric('Delayed packages', `${rows.length}`, ''),
    makeMetric('Delayed value', fmtCurrency(totalValue), 'Updated Budget'),
    makeMetric('Max delay', maxDelay ? `${maxDelay} days` : '—', ''),
    makeMetric('Root group', `${root.code}`, esc(root.name || '')),
  ].join('');
  const content = rows.length ? tableFromRows(rows, [
    { label: 'WBS', key: 'code', render: r => `<strong>${r.code}</strong>` },
    { label: 'Package', key: 'name' },
    { label: 'Status', key: 'status', render: r => pill(r.status) },
    { label: 'Updated Budget', key: 'updatedBudget', className: 'nowrap-cell col-money', render: r => fmtCurrency(r.updatedBudget) },
    { label: 'Contracted', key: 'contractedValue', className: 'nowrap-cell col-money', render: r => fmtCurrency(r.contractedValue) },
    { label: 'Delay', key: 'overdueDays', render: r => `<strong>${r.overdueDays} d</strong>` },
    { label: 'Deadline', key: 'deadlineClosing', render: r => fmtDate(r.deadlineClosing) },
  ], { rowClass: () => 'row-overdue' }) : '<div class="detail-card"><p class="meta-text">Nessuna attività in ritardo per questo root group.</p></div>';
  openDetail(`${root.code} · ${root.name}`, 'Attività in ritardo per root group selezionato da Delayed by root group.', metrics, content);
}

function showCurveDetail() {
  const curve = activeSCurve(state.dashboard?.overview || {});
  const rows = (curve.labels || []).map((label, i) => ({
    label,
    procPct: curve.procPct?.[i] || 0,
    budgetPct: curve.budgetPct?.[i] || 0,
    procAbs: curve.procAbs?.[i] || 0,
    budgetAbs: curve.budgetAbs?.[i] || 0,
  }));
  const metrics = [
    makeMetric('Procurement cumulativo', fmtCurrency(curve.currentMarker?.procAbs || rows.at(-1)?.procAbs || 0), curve.currentMarker?.label || 'mese corrente'),
    makeMetric('Budget Baseline cumulativo', fmtCurrency(curve.currentMarker?.budgetAbs || rows.at(-1)?.budgetAbs || 0), curve.currentMarker?.label || 'mese corrente'),
    makeMetric('Scostamento', fmtSignedCurrency((curve.currentMarker?.procAbs || rows.at(-1)?.procAbs || 0) - (curve.currentMarker?.budgetAbs || rows.at(-1)?.budgetAbs || 0)), curve.currentMarker?.label || 'mese corrente'),
    makeMetric('Months', `${rows.length}`, 'dic-2025 → dic-2028'),
  ].join('');
  const content = `
    <div class="detail-card detail-chart">${lineChartSvg(curve, { height: 430, showContracted: false })}</div>
    ${tableFromRows(rows, [
      { label: 'Month', key: 'label' },
      { label: 'Procurement cumulative', key: 'procAbs', className: 'nowrap-cell col-money', render: r => fmtCurrency(r.procAbs) },
      { label: 'Budget Baseline cumulative', key: 'budgetAbs', className: 'nowrap-cell col-money', render: r => fmtCurrency(r.budgetAbs) },
      { label: 'Procurement %', key: 'procPct', render: r => fmtPct(r.procPct) },
      { label: 'Budget Baseline %', key: 'budgetPct', render: r => fmtPct(r.budgetPct) },
    ], { tableClass: 'equal-cols-table' })}
    ${curveExplanationHtml}
  `;
  openDetail('Curva S cumulata', `${curve.title || 'Curva S'} - ${curve.description || ''}`, metrics, content);
}

function showCostBreakdownDetail() {
  const items = state.dashboard?.overview?.costBreakdown || [];
  const metrics = [
    makeMetric('Root groups', `${items.length}`, 'visibili in home'),
    makeMetric('Largest group', items[0] ? items[0].code : '—', items[0] ? fmtCurrency(items[0].updatedBudget) : ''),
    makeMetric('Budget total', fmtCurrency(state.dashboard?.summary?.updatedBudgetTotal || 0), ''),
    makeMetric('Baseline Budget', fmtCurrency(state.dashboard?.summary?.budgetAbTotal || 0), ''),
  ].join('');
  const content = `
    <div class="detail-card detail-chart">${donutSvg(items)}</div>
    ${tableFromRows(items, [
      { label: 'Root', key: 'code', render: r => `<strong>${r.code}</strong>` },
      { label: 'Description', key: 'name' },
      { label: 'Updated Budget', key: 'updatedBudget', className: 'nowrap-cell col-money', render: r => fmtCurrency(r.updatedBudget) },
      { label: 'Baseline Budget', key: 'budgetAb', className: 'nowrap-cell col-money', render: r => fmtCurrency(r.budgetAb) },
      { label: 'Share', key: 'sharePct', render: r => fmtPct(r.sharePct) },
    ])}
  `;
  openDetail('Suddivisione costi', 'Ispirata alla logica del file Status.', metrics, content);
}

function showCategoriesDetail() {
  const items = state.dashboard?.overview?.categoryBreakdown || [];
  const max = Math.max(...items.map(x => x.updatedBudget), 1);
  const bars = `<div class="detail-card">${items.map(item => `
      <div class="bar-row">
        <div class="bar-row-head"><strong>${esc(item.name)}</strong><span class="meta-text">${item.count} item · ${fmtCurrency(item.updatedBudget)}</span></div>
        <div class="bar-shell"><span class="progress-blue" style="width:${(item.updatedBudget / max) * 100}%"></span></div>
      </div>`).join('')}</div>`;
  const content = `${bars}${tableFromRows(items, [
    { label: 'Category', key: 'name' },
    { label: 'Items', key: 'count' },
    { label: 'Updated Budget', key: 'updatedBudget', className: 'nowrap-cell col-money', render: r => fmtCurrency(r.updatedBudget) },
    { label: 'Contracted', key: 'contractedValue', className: 'nowrap-cell col-money', render: r => fmtCurrency(r.contractedValue) },
    { label: 'Share', key: 'sharePct', render: r => fmtPct(r.sharePct) },
  ])}`;
  openDetail('Dettaglio costi diretti', 'Top categorie aggregate dal procurement schedule.', '', content);
}

const ordersStatusOverviewHtml = `
  <div class="detail-note detail-note-bottom orders-status-overview-note">
    <div class="detail-note-group">
      <div class="detail-note-title">Ordini in chiusura</div>
      <p><strong>Ordini in chiusura = package in stato Contract prep. + PCT Approval</strong></p>
      <p>Mostra quindi i package che si trovano nelle fasi più avanzate del procurement process, vicine alla chiusura / finalizzazione.</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Pacchetti in definizione</div>
      <p><strong>Pacchetti in definizione = package in stato Enquiry + Negotiation</strong></p>
      <p>Mostra quindi i package per cui il processo tecnico/commerciale è già avviato, ma che non risultano ancora nella fase finale di chiusura.</p>
    </div>
  </div>
`;

const ordersStatusExplanationHtml = `
  <div class="detail-note detail-note-bottom">
    <div class="detail-note-group">
      <div class="detail-note-title">Ordini in chiusura</div>
      <p><strong>Ordini in chiusura = Contract prep. + PCT Approval</strong></p>
      <p>Mostra quindi i package che si trovano nelle fasi più avanzate del procurement process, vicine alla chiusura / finalizzazione.</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Pacchetti in definizione</div>
      <p><strong>Pacchetti in definizione = package in stato Enquiry + Negotiation</strong></p>
      <p>Mostra quindi i package per cui il processo tecnico/commerciale è già avviato, ma che non risultano ancora nella fase finale di chiusura.</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">PCT Approval</div>
      <p><strong>PCT Approval = package in stato PCT Approval</strong></p>
      <p>Mostra quindi i package che risultano in una fase molto avanzata del processo di procurement.</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Contract prep.</div>
      <p><strong>Contract prep. = package in stato Contract preparation</strong></p>
      <p>Mostra quindi i package che si trovano nella fase di preparazione del contratto, prima della chiusura finale.</p>
    </div>
  </div>
`;

function showOrdersStatusDetail() {
  const oc = state.dashboard?.overview?.ordersClosing || { items: [], count: 0, value: 0 };
  const sp = state.dashboard?.overview?.specsIssued || { items: [], count: 0, value: 0 };
  const mix = state.dashboard?.overview?.orderMix || [];
  const metrics = [
    makeMetric('Ordini in chiusura', `${oc.count}`, fmtCurrency(oc.value)),
    makeMetric('Pacchetti in definizione', `${sp.count}`, fmtCurrency(sp.value)),
    makeMetric('PCT Approval', `${state.dashboard?.summary?.pctApprovalCount || 0}`, fmtCurrency(state.dashboard?.summary?.pctApprovalValue || 0)),
    makeMetric('Contract prep.', `${state.dashboard?.summary?.contractPrepCount || 0}`, fmtCurrency(state.dashboard?.summary?.contractPrepValue || 0)),
  ].join('');
  const mkTable = (title, rows) => `<div class="detail-card"><h3>${title}</h3>${tableFromRows(rows, [
    { label: 'WBS', key: 'code', render: r => `<strong>${r.code}</strong>` },
    { label: 'Package', key: 'name' },
    { label: 'Status', key: 'status', render: r => pill(r.status) },
    { label: 'Updated Budget', key: 'updatedBudget', className: 'nowrap-cell col-money', render: r => fmtCurrency(r.updatedBudget) },
    { label: 'Deadline', key: 'deadlineClosing', render: r => fmtDate(r.deadlineClosing || r.deadlineProc || r.startProc) },
  ])}</div>`;
  const mixCard = `<div class="detail-card detail-chart">${orderPieSvg(mix)}</div>`;
  openDetail('Ordini in chiusura / pacchetti in definizione', 'Vista sintetica derivata dal procurement status.', metrics, mixCard + mkTable('Ordini in chiusura', oc.items || []) + mkTable('Pacchetti in definizione', sp.items || []) + ordersStatusExplanationHtml);
}

function showTimelineDetail() {
  const timeline = state.dashboard?.overview?.timeline || {};
  const metrics = [
    makeMetric('Timeline items', `${(timeline.items || []).length}`, ''),
    makeMetric('Months visible', `${(timeline.months || []).length}`, ''),
    makeMetric('Open packages', `${state.dashboard?.summary?.openCount || 0}`, ''),
    makeMetric('Overdue', `${state.dashboard?.summary?.overdueCount || 0}`, ''),
  ].join('');
  const content = `<div class="detail-card">${timelineHtml(timeline)}</div>`;
  openDetail('Procurement task timeline', 'Milestone vicine e cliccabili.', metrics, content);
}

function contractDelta(row) {
  return Number(row?.updatedBudget || 0) - Number(row?.contractedValue || 0);
}

const overdueExplanationHtml = `
  <div class="detail-note detail-note-bottom">
    <div class="detail-note-group">
      <div class="detail-note-title">Overdue count</div>
      <p>Mostra quanti package di procurement sono oltre la Deadline Closing e non risultano ancora closed, finalized o PCT approval.</p>
      <p>È quindi un indicatore di ritardo sul processo di procurement, non del numero totale di contratti firmati.</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Value to award</div>
      <p><strong>Value to award = Updated Budget Total - Contracted Total</strong></p>
      <p>Mostra quindi il valore economico che, allo stato attuale, risulta ancora da assegnare / contrattualizzare.</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Open count</div>
      <p><strong>Open count = tutte le righe ancora aperte nel procurement process</strong></p>
      <p>Mostra quindi il numero totale di package che non risultano ancora chiusi nel processo di procurement.</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Weighted progress</div>
      <p><strong>Weighted progress = (valore degli item in stato closed/finalized/PCT approval) / (totale Updated Budget)</strong></p>
      <p>Mostra quindi l’avanzamento del procurement in termini di valore economico, e non come semplice numero di package chiusi.</p>
    </div>
  </div>
`;


const contractedExplanationHtml = `
  <div class="detail-note detail-note-bottom">
    <div class="detail-note-group">
      <div class="detail-note-title">Contracted</div>
      <p><strong>Contracted = valore totale già contrattualizzato nel procurement process</strong></p>
      <p>Mostra quindi il valore economico dei package che, allo stato attuale, risultano già coperti da contratto.</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Coverage</div>
      <p><strong>Coverage = Contracted / Updated Budget Total</strong></p>
      <p>Mostra quindi quale quota del budget aggiornato risulta già coperta da contratti assegnati.</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Open value</div>
      <p><strong>Open value = Updated Budget Total - Contracted Total</strong></p>
      <p>Mostra quindi il valore economico che, allo stato attuale, risulta ancora da assegnare / contrattualizzare.</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Packages</div>
      <p><strong>Packages = numero di package con valore Contracted maggiore di zero</strong></p>
      <p>Mostra quindi quanti package risultano già associati a un valore contrattualizzato.</p>
    </div>
  </div>
`;


const deltaBaselineExplanationHtml = `
  <div class="detail-note detail-note-bottom">
    <div class="detail-note-group">
      <div class="detail-note-title">Delta</div>
      <p><strong>Delta = Updated Budget Total - Baseline Budget Total</strong></p>
      <p>Mostra quindi lo scostamento economico complessivo tra il budget aggiornato del procurement schedule e il budget di riferimento (Baseline Budget).</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Baseline Budget</div>
      <p><strong>Baseline Budget = valore totale di riferimento preso dal file Budget (colonna AB)</strong></p>
      <p>Mostra quindi il budget base usato come riferimento iniziale per confrontare gli aggiornamenti successivi.</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Updated Budget</div>
      <p><strong>Updated Budget = valore totale aggiornato preso dal procurement schedule</strong></p>
      <p>Mostra quindi il budget aggiornato più recente, utile per misurare come si è mosso il costo previsto rispetto alla baseline.</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Contracted</div>
      <p><strong>Contracted = valore totale già contrattualizzato nel procurement process</strong></p>
      <p>Mostra quindi il valore economico dei package che, allo stato attuale, risultano già coperti da contratto.</p>
    </div>
  </div>
`;


const updatedBudgetExplanationHtml = `
  <div class="detail-note detail-note-bottom">
    <div class="detail-note-group">
      <div class="detail-note-title">Updated Budget</div>
      <p><strong>Updated Budget = valore totale aggiornato preso dal procurement schedule</strong></p>
      <p>Mostra quindi il budget aggiornato più recente, utile per misurare il costo previsto attuale del procurement.</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Baseline Budget</div>
      <p><strong>Baseline Budget = valore totale di riferimento preso dal file Budget (colonna AB)</strong></p>
      <p>Mostra quindi il budget base usato come riferimento iniziale per confrontare gli aggiornamenti successivi.</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Delta vs Baseline</div>
      <p><strong>Delta vs Baseline = Updated Budget Total - Baseline Budget Total</strong></p>
      <p>Mostra quindi lo scostamento economico complessivo tra il budget aggiornato del procurement schedule e il budget di riferimento (Baseline Budget).</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Contracted</div>
      <p><strong>Contracted = valore totale già contrattualizzato nel procurement process</strong></p>
      <p>Mostra quindi il valore economico dei package che, allo stato attuale, risultano già coperti da contratto.</p>
    </div>
  </div>
`;


const budgetChangesExplanationHtml = `
  <div class="detail-note detail-note-bottom">
    <div class="detail-note-group">
      <div class="detail-note-title">Updated Budget</div>
      <p><strong>Updated Budget = valore totale aggiornato preso dal procurement schedule</strong></p>
      <p>Mostra quindi il budget aggiornato più recente, utile per misurare il costo previsto attuale del procurement.</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Baseline Budget</div>
      <p><strong>Baseline Budget = valore totale di riferimento preso dal file Budget (colonna AB)</strong></p>
      <p>Mostra quindi il budget base usato come riferimento iniziale per confrontare gli aggiornamenti successivi.</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Delta vs Baseline</div>
      <p><strong>Delta vs Baseline = Updated Budget Total - Baseline Budget Total</strong></p>
      <p>Mostra quindi lo scostamento economico complessivo tra il budget aggiornato del procurement schedule e il budget di riferimento (Baseline Budget).</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Packages changed</div>
      <p><strong>Packages changed = numero di package con variazione tra Updated Budget e Baseline Budget</strong></p>
      <p>Mostra quindi su quanti package si registrano differenze economiche rispetto alla baseline iniziale.</p>
    </div>
  </div>
`;


const criticalExplanationHtml = `
  <div class="detail-note detail-note-bottom">
    <div class="detail-note-group">
      <div class="detail-note-title">Critical packages</div>
      <p><strong>Critical packages = elenco dei package considerati più rilevanti per rischio, valore o impatto sul progetto</strong></p>
      <p>Mostra quindi i package che richiedono maggiore attenzione manageriale, perché possono incidere in modo significativo su costi, tempi o avanzamento del procurement.</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Overdue total</div>
      <p><strong>Overdue total = numero totale di package con Deadline Closing già superata e non ancora in stato closed, finalized o PCT approval</strong></p>
      <p>Mostra quindi quanti package risultano oggi in ritardo nel processo di procurement.</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Value to award</div>
      <p><strong>Value to award = Updated Budget Total - Contracted Total</strong></p>
      <p>Mostra quindi il valore economico che, allo stato attuale, risulta ancora da assegnare / contrattualizzare.</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Completion</div>
      <p><strong>Completion = (valore degli item in stato closed/finalized/PCT approval) / (totale Updated Budget)</strong></p>
      <p>Mostra quindi l’avanzamento del procurement in termini di valore economico, e non come semplice numero di package chiusi.</p>
    </div>
  </div>
`;

const baselineBudgetExplanationHtml = `
  <div class="detail-note detail-note-bottom">
    <div class="detail-note-group">
      <div class="detail-note-title">Baseline Budget</div>
      <p><strong>Baseline Budget = valore totale di riferimento preso dal file Budget (colonna AB)</strong></p>
      <p>Mostra quindi il budget base usato come riferimento iniziale per confrontare gli aggiornamenti successivi.</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Updated Budget</div>
      <p><strong>Updated Budget = valore totale aggiornato preso dal procurement schedule</strong></p>
      <p>Mostra quindi il budget aggiornato più recente, utile per misurare il costo previsto attuale del procurement.</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Delta vs Baseline</div>
      <p><strong>Delta vs Baseline = Updated Budget Total - Baseline Budget Total</strong></p>
      <p>Mostra quindi lo scostamento economico complessivo tra il budget aggiornato del procurement schedule e il budget di riferimento (Baseline Budget).</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Contracted</div>
      <p><strong>Contracted = valore totale già contrattualizzato nel procurement process</strong></p>
      <p>Mostra quindi il valore economico dei package che, allo stato attuale, risultano già coperti da contratto.</p>
    </div>
  </div>
`;



const curveExplanationHtml = `
  <div class="detail-note detail-note-bottom">
    <div class="detail-note-group">
      <div class="detail-note-title">Procurement schedule cumulativo</div>
      <p><strong>Linea blu = valore cumulato del procurement schedule in PLN</strong></p>
      <p>È costruita allocando per ciascun package il relativo Updated Budget al mese di riferimento del procurement, sulla base delle date del procurement schedule (prioritariamente Deadline Closing, poi Deadline Proc, poi Start Proc).</p>
      <p>Mostra quindi come cresce nel tempo il valore cumulato degli ordini / package secondo la pianificazione del procurement.</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Budget Baseline cumulativo</div>
      <p><strong>Linea verde = valore cumulato della curva budget / programma cliente in PLN</strong></p>
      <p>È costruita leggendo dal file Budget la curva di riferimento mensile e trasformandola in un cumulato nel tempo.</p>
      <p>Mostra quindi dove dovrebbe collocarsi il valore cumulato secondo il piano / programma cliente di riferimento.</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Lettura del confronto</div>
      <p><strong>Il confronto tra linea blu e linea verde mostra se il procurement sta anticipando o inseguendo il profilo previsto dal piano.</strong></p>
      <p>Se la linea blu è sopra la linea verde, il procurement risulta avanti rispetto al profilo di riferimento; se la linea blu è sotto la linea verde, risulta sotto il profilo previsto.</p>
    </div>
    <hr />
    <div class="detail-note-group">
      <div class="detail-note-title">Stato attuale</div>
      <p><strong>Il punto rosso evidenzia il mese di riferimento attuale sulla Curva S.</strong></p>
      <p>Serve quindi a leggere, nel mese corrente, la posizione del procurement cumulato rispetto al budget / programma cliente cumulativo.</p>
    </div>
  </div>
`;

function showCriticalDetail() {
  const rows = (state.dashboard?.criticalPackages || []).filter(r => String(r.code || '').includes('.'));
  const metrics = [
    makeMetric('Critical packages', `${rows.length}`, ''),
    makeMetric('Overdue total', `${state.dashboard?.summary?.overdueCount || 0}`, ''),
    makeMetric('Value to award', fmtCurrency(state.dashboard?.summary?.valueToAward || 0), ''),
    makeMetric('Completion', fmtPct(state.dashboard?.summary?.completionPct || 0), ''),
  ].join('');
  const content = tableFromRows(rows, [
    { label: 'WBS', key: 'code', render: r => `<strong>${r.code}</strong>` },
    { label: 'Package', key: 'name' },
    { label: 'Status', key: 'status', render: r => pill(r.status) },
    { label: 'Updated Budget', key: 'updatedBudget', className: 'nowrap-cell col-money', render: r => fmtCurrency(r.updatedBudget) },
    { label: 'Contracted', key: 'contractedValue', className: 'nowrap-cell col-money', render: r => fmtCurrency(r.contractedValue) },
    { label: 'Delta', key: 'deltaToContract', className: 'nowrap-cell col-money', render: r => fmtSignedCurrency(contractDelta(r)) },
    { label: 'Delay', key: 'overdueDays', render: r => r.overdueDays ? `${r.overdueDays} d` : '—' },
  ]) + criticalExplanationHtml;
  openDetail('Top critical packages', 'Vista completa per escalation.', metrics, content);
}

function showKpiDetail(key) {
  const rows = state.dashboard?.directPackages || [];
  const packageRows = rows.filter(r => String(r.code || '').includes('.'));
  const summary = state.dashboard?.summary || {};
  const openRows = packageRows.filter(r => !['finalized', 'closed', 'PCT/approval'].includes(r.status));
  const map = {
    'completion': {
      title: 'Procurement completion', subtitle: 'Closed / finalized + PCT Approval',
      metrics: [makeMetric('Completion', fmtPct(summary.completionPct), ''), makeMetric('Closed count', `${summary.closedCount}`, ''), makeMetric('PCT Approval', `${summary.pctApprovalCount}`, ''), makeMetric('Value', fmtCurrency(summary.pctApprovalValue), '')].join(''),
      rows: packageRows.filter(r => ['finalized', 'closed', 'PCT/approval'].includes(r.status)),
    },
    'baseline-budget': { title: 'Baseline Budget', subtitle: 'Budget baseline complessivo e dettaglio procurement packages.', metrics: [makeMetric('Baseline Budget', fmtCurrency(563911593), 'Totale costi'), makeMetric('Contracted', fmtCurrency(summary.contractedTotal), '')].join(''), rows: packageRows.sort((a,b)=>b.budgetAb-a.budgetAb).slice(0,40), noteHtml: baselineBudgetExplanationHtml },
    'updated-budget': { title: 'Updated Budget', subtitle: 'Budget aggiornato dal procurement schedule', metrics: [makeMetric('Updated Budget', fmtCurrency(summary.updatedBudgetTotal), ''), makeMetric('Baseline Budget', fmtCurrency(summary.budgetAbTotal), ''), makeMetric('Delta vs Baseline', fmtSignedCurrency(summary.varianceAmount), ''), makeMetric('Contracted', fmtCurrency(summary.contractedTotal), '')].join(''), rows: packageRows.sort((a,b)=>b.updatedBudget-a.updatedBudget).slice(0,40), noteHtml: updatedBudgetExplanationHtml },
    'contracted': { title: 'Contracted value', subtitle: 'Valore già contrattualizzato', metrics: [makeMetric('Contracted', fmtCurrency(summary.contractedTotal), ''), makeMetric('Coverage', fmtPct(summary.contractCoveragePct), ''), makeMetric('Open value', fmtCurrency(summary.valueToAward), ''), makeMetric('Packages', `${packageRows.filter(r => r.contractedValue > 0).length}`, '')].join(''), rows: packageRows.filter(r => r.contractedValue > 0).sort((a,b)=>b.contractedValue-a.contractedValue).slice(0,40), noteHtml: contractedExplanationHtml },
    'delta-baseline': { title: 'Delta vs Baseline', subtitle: 'Scostamento del budget aggiornato rispetto alla baseline AB', metrics: [makeMetric('Delta', fmtSignedCurrency(summary.varianceAmount), ''), makeMetric('Baseline Budget', fmtCurrency(summary.budgetAbTotal), ''), makeMetric('Updated Budget', fmtCurrency(summary.updatedBudgetTotal), ''), makeMetric('Contracted', fmtCurrency(summary.contractedTotal), '')].join(''), rows: (state.dashboard?.topOverruns || []).filter(r => String(r.code || '').includes('.')), noteHtml: deltaBaselineExplanationHtml },
    'contract-prep': { title: 'Contract preparation', subtitle: 'Pacchetti in contract preparation', metrics: [makeMetric('Count', `${summary.contractPrepCount}`, ''), makeMetric('Value', fmtCurrency(summary.contractPrepValue), ''), makeMetric('Open count', `${summary.openCount}`, ''), makeMetric('Overdue', `${summary.overdueCount}`, '')].join(''), rows: packageRows.filter(r => r.status === 'contract prep.') },
    'pct-approval': { title: 'PCT Approval + finalized', subtitle: 'Pacchetti già molto avanti o chiusi', metrics: [makeMetric('Count', `${summary.pctApprovalCount + summary.closedCount}`, ''), makeMetric('Value', fmtCurrency(summary.pctApprovalValue), ''), makeMetric('Completion', fmtPct(summary.completionPct), ''), makeMetric('Weighted progress', fmtPct(summary.weightedProgressPct), '')].join(''), rows: packageRows.filter(r => ['PCT/approval','finalized','closed'].includes(r.status)) },
    'overdue': { title: 'Overdue packages', subtitle: '', metrics: [makeMetric('Overdue count', `${summary.overdueCount}`, ''), makeMetric('Value to award', fmtCurrency(summary.valueToAward), ''), makeMetric('Open count', `${summary.openCount}`, ''), makeMetric('Weighted progress', fmtPct(summary.weightedProgressPct), '')].join(''), rows: openRows.filter(r => r.overdueDays > 0), noteHtml: overdueExplanationHtml },
    'closed-finalized-pct': { title: 'Closed / Finalized + PCT', subtitle: '', metrics: '', rows: packageRows.filter(r => ['PCT/approval','finalized','closed'].includes(r.status)) },
    'contract-preparation': { title: 'Contract Preparation', subtitle: '', metrics: '', rows: packageRows.filter(r => r.status === 'contract prep.') },
    'specifiche-emesse': { title: 'Pacchetti in definizione', subtitle: '', metrics: '', rows: packageRows.filter(r => ['enquiry','negotiation'].includes(r.status)) },
    'packages-overdue': { title: 'Packages overdue', subtitle: '', metrics: '', rows: openRows.filter(r => r.overdueDays > 0), noteHtml: overdueExplanationHtml },
  };
  const conf = map[key];
  if (!conf) return;
  if (key === 'updated-budget') {
    const changedRows = packageRows
      .filter(r => Math.abs(Number(r.varianceAmount || 0)) > 0.01)
      .sort((a, b) => Math.abs(Number(b.varianceAmount || 0)) - Math.abs(Number(a.varianceAmount || 0)));
    const increasedCount = changedRows.filter(r => Number(r.varianceAmount || 0) > 0.01).length;
    const reducedCount = changedRows.filter(r => Number(r.varianceAmount || 0) < -0.01).length;
    const metrics = [
      makeMetric('Updated Budget', fmtCurrency(summary.updatedBudgetTotal), ''),
      makeMetric('Baseline Budget', fmtCurrency(summary.budgetAbTotal), ''),
      makeMetric('Delta vs Baseline', fmtSignedCurrency(summary.varianceAmount), ''),
      makeMetric('Packages changed', `${changedRows.length}`, `${increasedCount} up · ${reducedCount} down`),
    ].join('');
    const content = tableFromRows(changedRows, [
      { label: 'WBS', key: 'code', render: r => `<strong>${r.code}</strong>` },
      { label: 'Package', key: 'name' },
      { label: 'Baseline Budget', key: 'budgetAb', className: 'nowrap-cell col-money', render: r => fmtCurrency(r.budgetAb) },
      { label: 'Updated Budget', key: 'updatedBudget', className: 'nowrap-cell col-money', render: r => fmtCurrency(r.updatedBudget) },
      { label: 'Delta vs Baseline', key: 'varianceAmount', className: 'nowrap-cell col-money', render: r => fmtSignedCurrency(r.varianceAmount) },
      { label: 'Delta %', key: 'variancePct', className: 'nowrap-cell col-money', render: r => fmtPct(r.variancePct) },
      { label: 'Contracted', key: 'contractedValue', className: 'nowrap-cell col-money', render: r => fmtCurrency(r.contractedValue) },
      { label: 'Status', key: 'status', render: r => pill(r.status) },
    ]) + budgetChangesExplanationHtml;
    openDetail('Budget Changes', 'Package con variazioni economiche rispetto alla baseline.', metrics, content);
    return;
  }
  const includeSupplier = key === 'contracted';
  const content = tableFromRows(conf.rows || [], procurementDetailColumns({ includeSupplier }), includeSupplier ? { tableClass: 'supplier-detail-table' } : {}) + (conf.noteHtml || '');
  openDetail(conf.title, conf.subtitle, conf.metrics, content);
}

function bindGlobalClicks() {
  document.addEventListener('click', (e) => {
    const packageNode = e.target.closest('[data-package]');
    if (packageNode) return showPackageDetail(packageNode.dataset.package);
    const delayRootNode = e.target.closest('[data-delay-root]');
    if (delayRootNode) return showDelayedRootDetail(delayRootNode.dataset.delayRoot);
    const rootNode = e.target.closest('[data-root]');
    if (rootNode) return showRootDetail(rootNode.dataset.root);
    const kpiNode = e.target.closest('[data-kpi]');
    if (kpiNode) return showKpiDetail(kpiNode.dataset.kpi);
    const detailNode = e.target.closest('[data-detail]');
    if (detailNode) {
      const type = detailNode.dataset.detail;
      if (type === 'curve') return showCurveDetail();
      if (type === 'cost-breakdown') return showCostBreakdownDetail();
      if (type === 'categories') return showCategoriesDetail();
      if (type === 'orders-status') return showOrdersStatusDetail();
      if (type === 'timeline') return showTimelineDetail();
      if (type === 'critical') return showCriticalDetail();
    }
  });
}

async function loadConfig() {
  const cfg = await Promise.resolve({});
  state.config = cfg;
  const form = $('config-form');
  form.project_title.value = cfg.project_title || '';
  form.executive_note.value = cfg.executive_note || '';
  form.budget_total_column.value = cfg.budget.total_column || 'AB';
  form.updated_budget_column.value = cfg.procurement.updated_budget_column || 'S';
  form.contracted_column.value = cfg.procurement.contracted_column || 'T';
  form.completed_statuses.value = (cfg.completed_statuses || []).join(', ');
  form.variance_amber_pct.value = cfg.thresholds.variance_amber_pct ?? 2;
  form.variance_red_pct.value = cfg.thresholds.variance_red_pct ?? 6;
}

async function loadHistory() {
  const historyTarget = $('history-list');
  if (!historyTarget) return;
  state.history = await Promise.resolve([]);
  historyTarget.innerHTML = state.history.map(item => `
    <div class="history-item">
      <div>
        <div class="history-head"><strong>${item.file}</strong></div>
        <div class="meta-text">${new Date(item.modified * 1000).toLocaleString('it-IT')}</div>
      </div>
      <button data-restore="${item.file}">Ripristina</button>
    </div>
  `).join('');
  document.querySelectorAll('[data-restore]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetchJSON('/api/admin/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: btn.dataset.restore })
      });
      await loadDashboard();
      await loadHistory();
    });
  });
}

async function loadReports() {
  const rows = await Promise.resolve([]);
  const node = $('report-list');
  if (!node) return;
  node.innerHTML = rows.slice(0, 8).map(item => `
    <div class="history-item">
      <div>
        <div class="history-head"><strong>${item.file}</strong></div>
        <div class="meta-text">${new Date(item.modified * 1000).toLocaleString('it-IT')}</div>
      </div>
      <a class="report-link" href="/reports/${encodeURIComponent(item.file)}">Download</a>
    </div>
  `).join('') || '<div class="meta-text">Nessun report Excel generato.</div>';
}

function bindForms() {
  $('upload-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const feedback = $('upload-feedback');
    feedback.textContent = 'Upload in corso...';
    const formData = new FormData(e.target);
    try {
      await fetchJSON('/api/admin/upload', { method: 'POST', body: formData });
      feedback.textContent = 'Snapshot pubblicato con successo.';
      await loadDashboard();
      await loadHistory();
      await loadReports();
      setTab('overview');
    } catch (err) {
      feedback.textContent = err.message || 'Errore upload.';
    }
  });

  $('config-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    const payload = {
      project_title: form.project_title.value,
      executive_note: form.executive_note.value,
      completed_statuses: form.completed_statuses.value.split(',').map(x => x.trim()).filter(Boolean),
      budget: { total_column: form.budget_total_column.value.trim().toUpperCase() || 'AB' },
      procurement: {
        updated_budget_column: form.updated_budget_column.value.trim().toUpperCase() || 'S',
        contracted_column: form.contracted_column.value.trim().toUpperCase() || 'T',
      },
      thresholds: {
        variance_amber_pct: Number(form.variance_amber_pct.value || 2),
        variance_red_pct: Number(form.variance_red_pct.value || 6),
      }
    };
    const feedback = $('config-feedback');
    try {
      await fetchJSON('/api/admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      feedback.textContent = 'Parametri salvati.';
      await Promise.all([loadConfig(), loadDashboard(), loadReports()]);
    } catch (err) {
      feedback.textContent = err.message || 'Errore salvataggio parametri.';
    }
  });
}


function downloadViaHiddenFrame(url) {
  const frame = document.createElement('iframe');
  frame.style.display = 'none';
  frame.src = url + (url.includes('?') ? '&' : '?') + 'ts=' + Date.now();
  document.body.appendChild(frame);
  setTimeout(() => frame.remove(), 30000);
}

function setReportButtonsBusy(isBusy, activeButton = null) {
  const buttons = [$('generate-report-button'), $('generate-pdf-button')].filter(Boolean);
  buttons.forEach(btn => {
    btn.classList.toggle('is-busy', isBusy);
    btn.setAttribute('aria-busy', isBusy ? 'true' : 'false');
    if (isBusy) {
      btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
      btn.textContent = btn === activeButton ? 'Aggiorno dati…' : (btn.dataset.originalText || btn.textContent);
    } else if (btn.dataset.originalText) {
      btn.textContent = btn.dataset.originalText;
    }
  });
}

async function refreshDashboardData() {
  const data = await fetchJSON('./data/dashboard-data.json?v=20260522125549&ts=' + Date.now());
  renderDashboard(data);
  return data;
}

function bindReportButtons() {
  const reportLinks = [
    { id: 'generate-report-button', href: './reports/WTE_Dashboard_Report.xlsx' },
    { id: 'generate-pdf-button', href: './reports/WTE_CEO_Premium_Report_Option_A.pdf' },
    { id: 'generate-pdf-b-button', href: './reports/WTE_CEO_Premium_Report_Option_B.pdf' },
  ];
  reportLinks.forEach(({ id, href }) => {
    const btn = $(id);
    if (!btn) return;
    btn.href = href;
    btn.setAttribute('download', '');
    btn.title = 'File statico generato dalla versione locale. Per aggiornarlo, genera prima Excel/PDF in locale, poi esegui BUILD_GITHUB_VERSION e ripubblica docs/ su GitHub.';
  });
}

async function loadDashboard() {
  const data = await fetchJSON('./data/dashboard-data.json?v=20260522125549&ts=' + Date.now());
  renderDashboard(data);
}

(async function init() {
  bindTabs();
  bindGlobalClicks();
  bindMonthCheck();
  bindReportButtons();
  await loadDashboard();
})();
