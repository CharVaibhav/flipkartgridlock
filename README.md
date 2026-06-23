# RouteSync

RouteSync is a hybrid traffic orchestrator and spatial analysis system. It polls location telemetry from historical hotspots and predicts imminent curb/parking choke events to dynamically trigger route modifications (such as aggregator pin shifts).

---

## Production Deployment

- **Live Service URL:** [https://routesync-orchestrator.onrender.com](https://routesync-orchestrator.onrender.com)

---

## Architecture Overview

1. **Model Training Pipeline (`train_model.py`):** Processes the historical traffic violation dataset, extracts 20 high-density hotspot centroids using K-Means, trains an XGBoost classifier, and exports `choke_model.json` and `hotspots.json`.
2. **Python ML Engine (`app.py`):** A FastAPI service that dynamically predicts curb chokes using the trained XGBoost model and calculates distance to the nearest hotspot. If model files are not present, it gracefully falls back to rule-based heuristics.
3. **Node.js Orchestrator (`server.js`):** An Express server running a cron task to periodically query telemetry, evaluate hotspots against the Python Engine, and dispatch rerouting directives.

---

## Local Execution Instructions

### Prerequisites
- Node.js (v18+)
- Python (3.8+)

### 1. Train and Start the Python Engine
Install dependencies, train the XGBoost model, and run the FastAPI server:
```bash
# Install Python packages
pip install -r requirements.txt

# Train the model and generate hotspots.json & choke_model.json
python train_model.py

# Start the server (binds to port 8000)
python app.py
```

### 2. Run the Node.js Orchestrator
Install dependencies and run the Node server in a separate terminal:
```bash
# Install NPM packages
npm install

# Start the server (binds to port 3000)
npm start
```
*For development auto-reloading, run `npm run dev`.*

---

## Environment Variables
- `PORT`: Overrides default port bindings (`3000` for Node, `8000` for Python).
- `INFERENCE_ENDPOINT`: (Node.js only) URL of the Python FastAPI prediction endpoint. Defaults to `http://127.0.0.1:8000/predict-choke`.

---

## API Endpoints

### Python Engine (`:8000`)
- `POST /predict-choke`: Evaluates telemetry spatial vectors to identify potential road blockages.

### Node.js Orchestrator (`:3000`)
- `GET /api/v1/hotspots`: Returns list of critical tracked centroids.
- `POST /api/v1/trigger-evaluation`: Manually trigger evaluation of all tracked hotspots immediately.
