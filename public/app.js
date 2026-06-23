// ═══════════════════════════════════════════════════
// RouteSync — Frontend Logic
// ═══════════════════════════════════════════════════

const API = window.location.origin;
let hotspots = [];
let activeIndex = 0;

// ─── BOOT ───────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setupSliders();
  loadHotspots();
  checkStatus();
  document.getElementById('simForm').addEventListener('submit', runPrediction);
  document.getElementById('btnEvalAll').addEventListener('click', triggerAll);
  document.getElementById('btnClearLogs').addEventListener('click', clearLogs);
});

// ─── SLIDERS ────────────────────────────────────────
function setupSliders() {
  const sliders = [
    { el: 'sliderSpeed', display: 'valSpeed', fmt: v => v + ' km/h' },
    { el: 'sliderFreeflow', display: 'valFreeflow', fmt: v => v + ' km/h' },
    { el: 'sliderUpstream', display: 'valUpstream', fmt: v => v + ' km/h' },
    { el: 'sliderDelay', display: 'valDelay', fmt: v => v + 's' },
    { el: 'sliderHour', display: 'valHour', fmt: v => String(v).padStart(2,'0') + ':00' },
  ];

  sliders.forEach(({ el, display, fmt }) => {
    const input = document.getElementById(el);
    const label = document.getElementById(display);
    const update = () => {
      const pct = ((input.value - input.min) / (input.max - input.min)) * 100;
      input.style.setProperty('--pct', pct + '%');
      label.textContent = fmt(input.value);
    };
    input.addEventListener('input', update);
    update();
  });
}

// ─── LOAD HOTSPOTS ──────────────────────────────────
async function loadHotspots() {
  try {
    const res = await fetch(`${API}/api/v1/hotspots`);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    hotspots = await res.json();
    document.getElementById('hotspotCount').textContent = hotspots.length + ' zones';
    renderHotspots();
    selectHotspot(0);
    addLog('info', `Loaded ${hotspots.length} spatial hotspots.`);
  } catch (err) {
    document.getElementById('hotspotList').innerHTML =
      '<li class="log-empty">Could not reach the orchestrator.</li>';
    addLog('danger', 'Failed to load hotspots: ' + err.message);
  }
}

function renderHotspots() {
  const ul = document.getElementById('hotspotList');
  ul.innerHTML = hotspots.map((h, i) => `
    <li class="hotspot-item ${i === activeIndex ? 'active' : ''}" onclick="selectHotspot(${i})">
      <div class="hotspot-station">${h.police_station}</div>
      <div class="hotspot-id">${h.segment_id}</div>
      <div class="hotspot-meta">
        <span>${h.latitude.toFixed(4)}, ${h.longitude.toFixed(4)}</span>
        <span>${h.freeflow_speed_kmh} km/h free-flow</span>
      </div>
    </li>
  `).join('');
}

function selectHotspot(i) {
  activeIndex = i;
  renderHotspots();
  const h = hotspots[i];
  if (h) {
    const ff = document.getElementById('sliderFreeflow');
    ff.value = h.freeflow_speed_kmh;
    ff.dispatchEvent(new Event('input'));
  }
}

// ─── STATUS CHECK ───────────────────────────────────
async function checkStatus() {
  // Orchestrator is online if we loaded the page
  const orch = document.getElementById('statusOrch');
  orch.className = 'pill pill-online';

  // ML engine check
  const eng = document.getElementById('statusEngine');
  try {
    const res = await fetch(`${API}/api/v1/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segment_id: 'HEALTH', latitude: 12.92, longitude: 77.61,
        current_speed_kmh: 30, freeflow_speed_kmh: 40,
        upstream_speed_kmh: 35, delay_seconds: 10, hour_of_day: 12
      })
    });
    if (res.ok) {
      eng.className = 'pill pill-online';
      eng.innerHTML = '<span class="pill-dot"></span> ML Engine';
    } else throw new Error();
  } catch {
    eng.className = 'pill pill-offline';
    eng.innerHTML = '<span class="pill-dot"></span> ML Engine';
  }
}

// ─── RUN PREDICTION ─────────────────────────────────
async function runPrediction(e) {
  e.preventDefault();
  const h = hotspots[activeIndex] || {
    segment_id: 'MANUAL', latitude: 12.925, longitude: 77.618,
    freeflow_speed_kmh: 40, safe_bay: { lat: 12.926, lng: 77.619 },
    police_station: 'Unknown'
  };

  const payload = {
    segment_id: h.segment_id,
    latitude: h.latitude,
    longitude: h.longitude,
    current_speed_kmh: parseFloat(document.getElementById('sliderSpeed').value),
    freeflow_speed_kmh: parseFloat(document.getElementById('sliderFreeflow').value),
    upstream_speed_kmh: parseFloat(document.getElementById('sliderUpstream').value),
    delay_seconds: parseFloat(document.getElementById('sliderDelay').value),
    hour_of_day: parseInt(document.getElementById('sliderHour').value)
  };

  const btn = document.getElementById('btnPredict');
  btn.classList.add('is-loading');
  btn.textContent = 'Predicting…';
  addLog('info', `Sending prediction for ${h.police_station} (${payload.current_speed_kmh} km/h, ${payload.delay_seconds}s delay)…`);

  try {
    const res = await fetch(`${API}/api/v1/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    showResult(data);

    if (data.curb_choke_imminent) {
      addLog('danger', `🚨 CHOKE at ${data.segment_id} — ${(data.confidence_score*100).toFixed(0)}% confidence. Dispatching geofence.`);
      showPayload(h, data.confidence_score);
    } else {
      addLog('success', `✅ ${data.segment_id} — Normal flow. Confidence ${(data.confidence_score*100).toFixed(0)}%.`);
    }
  } catch (err) {
    addLog('danger', 'Prediction failed: ' + err.message);
  } finally {
    btn.classList.remove('is-loading');
    btn.textContent = '⚡ Run Prediction';
  }
}

// ─── TRIGGER ALL ────────────────────────────────────
async function triggerAll() {
  const btn = document.getElementById('btnEvalAll');
  btn.classList.add('is-loading');
  btn.textContent = 'Evaluating…';
  addLog('info', 'Evaluating all tracked hotspots against the ML engine…');
  try {
    const res = await fetch(`${API}/api/v1/trigger-evaluation`, { method: 'POST' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    if (data.results && data.results.length > 0) {
      showBulkResults(data.results);
    } else {
      addLog('warning', 'No results returned from evaluation.');
    }
  } catch (err) {
    addLog('warning', 'Evaluation failed: ' + err.message);
  } finally {
    btn.classList.remove('is-loading');
    btn.textContent = '🔁 Evaluate All Hotspots';
  }
}

// ─── SHOW BULK RESULTS ──────────────────────────────
function showBulkResults(results) {
  let chokeCount = 0;
  let safeCount = 0;

  // Log each result
  results.forEach(r => {
    if (r.error) {
      addLog('warning', `⚠️ ${r.police_station || r.segment_id} — Error: ${r.error}`);
      return;
    }
    if (r.curb_choke_imminent) {
      chokeCount++;
      addLog('danger', `🚨 ${r.police_station} (${r.segment_id}) — CHOKE DETECTED. Confidence: ${(r.confidence_score*100).toFixed(0)}%. Severity: ${r.delay_severity_index}x.`);
      if (r.safe_bay) {
        showPayload({ police_station: r.police_station, segment_id: r.segment_id, safe_bay: r.safe_bay }, r.confidence_score);
      }
    } else {
      safeCount++;
      addLog('success', `✅ ${r.police_station} (${r.segment_id}) — Normal flow. Confidence: ${(r.confidence_score*100).toFixed(0)}%.`);
    }
  });

  // Show summary in the result panel
  const panel = document.getElementById('resultPanel');
  panel.style.display = 'block';

  const banner = document.getElementById('resultBanner');
  const label = document.getElementById('resultLabel');

  if (chokeCount > 0) {
    banner.className = 'result-banner danger';
    label.innerHTML = `🚨 ${chokeCount} Choke${chokeCount > 1 ? 's' : ''} Detected / ${results.length} Zones`;
  } else {
    banner.className = 'result-banner safe';
    label.innerHTML = `✅ All ${results.length} Zones Normal`;
  }

  const firstValid = results.find(r => !r.error);
  document.getElementById('resultModel').textContent = firstValid?.model_used || 'Unknown';
  document.getElementById('mConfidence').textContent = chokeCount > 0
    ? results.filter(r => r.curb_choke_imminent).map(r => (r.confidence_score*100).toFixed(0) + '%').join(', ')
    : (firstValid ? (firstValid.confidence_score * 100).toFixed(1) + '%' : '—');
  document.getElementById('mSeverity').textContent = firstValid ? firstValid.delay_severity_index + 'x' : '—';
  document.getElementById('mSegment').textContent = `${safeCount} safe · ${chokeCount} alert`;

  addLog('info', `Evaluation complete: ${safeCount} safe, ${chokeCount} choke alert(s) across ${results.length} zones.`);

  const result = panel.querySelector('.result');
  result.style.animation = 'none';
  result.offsetHeight;
  result.style.animation = '';
}

// ─── SHOW RESULT ────────────────────────────────────
function showResult(data) {
  const panel = document.getElementById('resultPanel');
  panel.style.display = 'block';

  const banner = document.getElementById('resultBanner');
  const label = document.getElementById('resultLabel');

  if (data.curb_choke_imminent) {
    banner.className = 'result-banner danger';
    label.innerHTML = '🚨 Curb Choke Imminent';
  } else {
    banner.className = 'result-banner safe';
    label.innerHTML = '✅ Normal Traffic Flow';
  }

  document.getElementById('resultModel').textContent = data.model_used || 'Unknown';
  document.getElementById('mConfidence').textContent = (data.confidence_score * 100).toFixed(1) + '%';
  document.getElementById('mSeverity').textContent = data.delay_severity_index + 'x';
  document.getElementById('mSegment').textContent = data.segment_id.replace('BLR_','').replace('_CLUSTER_',' #');

  // Re-animate
  const result = panel.querySelector('.result');
  result.style.animation = 'none';
  result.offsetHeight;
  result.style.animation = '';
}

// ─── SHOW PAYLOAD ───────────────────────────────────
function showPayload(hotspot, severity) {
  document.getElementById('payloadSection').style.display = 'block';

  const payload = {
    event_type: "COMPRESSED_ZONE_GEOFENCE_ENFORCEMENT",
    target_station_zone: hotspot.police_station,
    segment_id: hotspot.segment_id,
    timestamp: Date.now(),
    metrics: {
      severity_rating: parseFloat(severity.toFixed(2)),
      activation_radius_meters: 90.0
    },
    routing_instruction: {
      block_immediate_curb: true,
      redirect_coordinates: hotspot.safe_bay
    }
  };

  document.getElementById('payloadCode').innerHTML = highlight(JSON.stringify(payload, null, 2));
}

function highlight(json) {
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    m => {
      let c = 'json-number';
      if (/^"/.test(m)) { c = /:$/.test(m) ? 'json-key' : 'json-string'; }
      else if (/true|false/.test(m)) { c = 'json-bool'; }
      return `<span class="${c}">${m}</span>`;
    }
  );
}

// ─── ACTIVITY LOG ───────────────────────────────────
function addLog(type, msg) {
  const body = document.getElementById('logBody');
  const empty = document.getElementById('logEmpty');
  if (empty) empty.remove();

  const time = new Date().toLocaleTimeString('en-IN', { hour12: false, hour:'2-digit', minute:'2-digit', second:'2-digit' });

  const el = document.createElement('div');
  el.className = 'log-entry';
  el.innerHTML = `
    <div class="log-dot ${type}"></div>
    <div>
      <div class="log-msg">${msg}</div>
      <div class="log-time">${time}</div>
    </div>`;
  body.prepend(el);

  while (body.children.length > 40) body.lastElementChild.remove();
}

function clearLogs() {
  document.getElementById('logBody').innerHTML =
    '<div class="log-empty" id="logEmpty">No activity yet. Run a prediction to get started.</div>';
}
