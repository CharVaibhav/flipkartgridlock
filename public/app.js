// ═══════════════════════════════════════════════════
// RouteSync Frontend Application
// ═══════════════════════════════════════════════════

const API_BASE = window.location.origin;
let hotspots = [];
let selectedHotspot = null;
let safeCount = 0;
let alertCount = 0;

// ─── INITIALIZATION ─────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  initSliders();
  loadHotspots();
  checkEngineStatus();

  document.getElementById('simForm').addEventListener('submit', handlePredict);
  document.getElementById('btnTriggerAll').addEventListener('click', handleTriggerAll);
  document.getElementById('btnClearLogs').addEventListener('click', clearLogs);
});

// ─── SLIDER SETUP ───────────────────────────────────
function initSliders() {
  const sliders = [
    { id: 'sliderSpeed', display: 'valSpeed', suffix: ' km/h' },
    { id: 'sliderFreeflow', display: 'valFreeflow', suffix: ' km/h' },
    { id: 'sliderUpstream', display: 'valUpstream', suffix: ' km/h' },
    { id: 'sliderDelay', display: 'valDelay', suffix: 's' },
    { id: 'sliderHour', display: 'valHour', suffix: ':00' },
  ];

  sliders.forEach(({ id, display, suffix }) => {
    const slider = document.getElementById(id);
    const label = document.getElementById(display);

    const updateSlider = () => {
      const pct = ((slider.value - slider.min) / (slider.max - slider.min)) * 100;
      slider.style.setProperty('--val', pct + '%');
      label.textContent = slider.value + suffix;
    };

    slider.addEventListener('input', updateSlider);
    updateSlider();
  });
}

// ─── LOAD HOTSPOTS ──────────────────────────────────
async function loadHotspots() {
  try {
    const res = await fetch(`${API_BASE}/api/v1/hotspots`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    hotspots = await res.json();

    document.getElementById('statHotspots').textContent = hotspots.length;
    renderHotspots();
    addLog('info', `Loaded ${hotspots.length} tracked spatial hotspots from orchestrator.`);

    // Auto-select first hotspot
    if (hotspots.length > 0) {
      selectHotspot(0);
    }
  } catch (err) {
    document.getElementById('statHotspots').textContent = '!';
    document.getElementById('hotspotList').innerHTML =
      `<div class="log-empty"><div class="log-empty-icon">⚠️</div>Failed to load hotspots. Is the orchestrator running?</div>`;
    addLog('danger', `Failed to fetch hotspots: ${err.message}`);
  }
}

// ─── RENDER HOTSPOTS ────────────────────────────────
function renderHotspots() {
  const container = document.getElementById('hotspotList');
  container.innerHTML = hotspots.map((h, i) => `
    <div class="hotspot-item ${selectedHotspot === i ? 'selected' : ''}" data-index="${i}" onclick="selectHotspot(${i})">
      <div class="hotspot-top">
        <span class="hotspot-name">🏛️ ${h.police_station}</span>
        <span class="hotspot-segment">${h.segment_id}</span>
      </div>
      <div class="hotspot-coords">
        <span>Lat: ${h.latitude.toFixed(6)}</span>
        <span>Lng: ${h.longitude.toFixed(6)}</span>
      </div>
      <div class="hotspot-speed">
        Free-flow: <strong>${h.freeflow_speed_kmh} km/h</strong> · Safe Bay: <strong>${h.safe_bay.lat.toFixed(4)}, ${h.safe_bay.lng.toFixed(4)}</strong>
      </div>
    </div>
  `).join('');
}

// ─── SELECT HOTSPOT ─────────────────────────────────
function selectHotspot(index) {
  selectedHotspot = index;
  renderHotspots();

  const h = hotspots[index];
  document.getElementById('sliderFreeflow').value = h.freeflow_speed_kmh;
  document.getElementById('sliderFreeflow').dispatchEvent(new Event('input'));
}

// ─── CHECK ENGINE STATUS ────────────────────────────
async function checkEngineStatus() {
  // Check orchestrator (we're already loaded if this works)
  const orchBadge = document.getElementById('orchestratorStatus');
  try {
    await fetch(`${API_BASE}/api/v1/hotspots`);
    orchBadge.className = 'status-badge online';
    orchBadge.innerHTML = '<span class="pulse-dot"></span> Orchestrator Online';
  } catch {
    orchBadge.className = 'status-badge offline';
    orchBadge.innerHTML = '<span class="pulse-dot"></span> Orchestrator Offline';
  }

  // Check ML engine through proxy
  const engBadge = document.getElementById('engineStatus');
  try {
    const res = await fetch(`${API_BASE}/api/v1/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        segment_id: 'HEALTH_CHECK',
        latitude: 12.9255, longitude: 77.6186,
        current_speed_kmh: 30, freeflow_speed_kmh: 40,
        upstream_speed_kmh: 35, delay_seconds: 10, hour_of_day: 12
      })
    });
    if (res.ok) {
      const data = await res.json();
      engBadge.className = 'status-badge online';
      engBadge.innerHTML = '<span class="pulse-dot"></span> ML Engine Online';
      document.getElementById('statModel').textContent = data.model_used || 'Active';
    } else {
      throw new Error('not ok');
    }
  } catch {
    engBadge.className = 'status-badge offline';
    engBadge.innerHTML = '<span class="pulse-dot"></span> ML Engine Offline';
    document.getElementById('statModel').textContent = 'Offline';
  }
}

// ─── HANDLE PREDICT ─────────────────────────────────
async function handlePredict(e) {
  e.preventDefault();

  if (selectedHotspot === null && hotspots.length > 0) {
    selectHotspot(0);
  }

  const h = hotspots[selectedHotspot] || {
    segment_id: 'CUSTOM_SIM',
    latitude: 12.9255,
    longitude: 77.6186,
    freeflow_speed_kmh: 40,
    safe_bay: { lat: 12.9262, lng: 77.6195 }
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
  btn.classList.add('loading');

  addLog('info', `Sending prediction request for ${payload.segment_id} @ ${payload.current_speed_kmh} km/h...`);

  try {
    const res = await fetch(`${API_BASE}/api/v1/predict`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    showResult(data);

    if (data.curb_choke_imminent) {
      alertCount++;
      document.getElementById('statAlerts').textContent = alertCount;
      addLog('danger', `🚨 CHOKE ALERT at ${data.segment_id}: Confidence ${(data.confidence_score * 100).toFixed(0)}% — Dispatching pin-shift.`);
      showDispatchPayload(h, data.confidence_score);
    } else {
      safeCount++;
      document.getElementById('statSafe').textContent = safeCount;
      addLog('success', `✅ ${data.segment_id} is within normal parameters. Confidence: ${(data.confidence_score * 100).toFixed(0)}%.`);
    }
  } catch (err) {
    addLog('danger', `Prediction failed: ${err.message}. Make sure the Python ML Engine is running.`);
  } finally {
    btn.classList.remove('loading');
  }
}

// ─── HANDLE TRIGGER ALL ─────────────────────────────
async function handleTriggerAll() {
  const btn = document.getElementById('btnTriggerAll');
  btn.classList.add('loading');

  addLog('info', '🔁 Triggering immediate evaluation of all tracked hotspots...');

  try {
    const res = await fetch(`${API_BASE}/api/v1/trigger-evaluation`, { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    addLog('success', `Evaluation complete: ${data.message}`);
  } catch (err) {
    addLog('warning', `Trigger evaluation failed: ${err.message}`);
  } finally {
    btn.classList.remove('loading');
  }
}

// ─── SHOW RESULT ────────────────────────────────────
function showResult(data) {
  const panel = document.getElementById('resultPanel');
  panel.style.display = 'block';

  const statusEl = document.getElementById('resultStatus');
  const iconEl = document.getElementById('resultIcon');
  const textEl = document.getElementById('resultText');

  if (data.curb_choke_imminent) {
    statusEl.className = 'result-status danger';
    iconEl.textContent = '🚨';
    textEl.textContent = 'Curb Choke Imminent';
  } else {
    statusEl.className = 'result-status safe';
    iconEl.textContent = '✅';
    textEl.textContent = 'Normal Traffic Flow';
  }

  document.getElementById('resultModelTag').textContent = data.model_used || 'Unknown';
  document.getElementById('metricConfidence').textContent = (data.confidence_score * 100).toFixed(1) + '%';
  document.getElementById('metricDelaySeverity').textContent = data.delay_severity_index;
  document.getElementById('metricSegment').textContent = data.segment_id.replace('BLR_', '').replace('_CLUSTER_', ' #');

  // Re-trigger animation
  panel.style.animation = 'none';
  panel.offsetHeight;
  panel.style.animation = '';
}

// ─── SHOW DISPATCH PAYLOAD ──────────────────────────
function showDispatchPayload(hotspot, severity) {
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

  const code = document.getElementById('payloadCode');
  code.innerHTML = syntaxHighlight(JSON.stringify(payload, null, 2));
}

// ─── JSON SYNTAX HIGHLIGHTING ───────────────────────
function syntaxHighlight(json) {
  return json.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g,
    (match) => {
      let cls = 'json-number';
      if (/^"/.test(match)) {
        if (/:$/.test(match)) {
          cls = 'json-key';
          match = match.replace(/:$/, '') + ':';
        } else {
          cls = 'json-string';
        }
      } else if (/true|false/.test(match)) {
        cls = 'json-bool';
      } else if (/null/.test(match)) {
        cls = 'json-null';
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );
}

// ─── ACTIVITY LOG ───────────────────────────────────
function addLog(type, message) {
  const container = document.getElementById('logContainer');
  const emptyEl = document.getElementById('logEmpty');
  if (emptyEl) emptyEl.remove();

  const icons = {
    info: 'ℹ️',
    success: '✅',
    warning: '⚠️',
    danger: '🚨'
  };

  const now = new Date();
  const time = now.toLocaleTimeString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML = `
    <div class="log-icon ${type}">${icons[type] || 'ℹ️'}</div>
    <div class="log-content">
      <div class="log-message">${message}</div>
      <div class="log-time">${time}</div>
    </div>
  `;

  container.prepend(entry);

  // Keep max 50 entries
  while (container.children.length > 50) {
    container.lastElementChild.remove();
  }
}

function clearLogs() {
  const container = document.getElementById('logContainer');
  container.innerHTML = `
    <div class="log-empty" id="logEmpty">
      <div class="log-empty-icon">📭</div>
      No activity yet. Run a prediction or trigger an evaluation.
    </div>
  `;
}
