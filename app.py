from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn
import json
import os
import math

app = FastAPI(title="RouteSync Historical Matrix Engine")

# Load model and hotspots globally on startup
model = None
hotspots = []

# Load XGBoost model if available
try:
    import xgboost as xgb
    import numpy as np
    if os.path.exists('choke_model.json'):
        model = xgb.XGBClassifier()
        model.load_model('choke_model.json')
        print("XGBoost choke model loaded successfully.")
    else:
        print("Model file 'choke_model.json' not found. Running in rule-based fallback mode.")
except Exception as e:
    print(f"Failed to load XGBoost model ({e}). Running in rule-based fallback mode.")

# Load K-Means hotspots if available
try:
    if os.path.exists('hotspots.json'):
        with open('hotspots.json', 'r') as f:
            hotspots = json.load(f)
        print(f"Loaded {len(hotspots)} historical hotspots.")
    else:
        print("Hotspots file 'hotspots.json' not found.")
except Exception as e:
    print(f"Failed to load hotspots: {e}")

class SpatialVector(BaseModel):
    segment_id: str
    latitude: float
    longitude: float
    current_speed_kmh: float
    freeflow_speed_kmh: float
    upstream_speed_kmh: float
    delay_seconds: float
    hour_of_day: int

def calculate_distance(lat1, lon1, lat2, lon2):
    return math.sqrt((lat1 - lat2)**2 + (lon1 - lon2)**2)

@app.post("/predict-choke")
async def predict_choke(vector: SpatialVector):
    try:
        # Calculate base telemetry ratios
        velocity_drop_ratio = vector.current_speed_kmh / max(vector.freeflow_speed_kmh, 1.0)
        arterial_divergence = vector.upstream_speed_kmh - vector.current_speed_kmh

        is_curb_choke = False
        confidence = 0.0

        # If model and hotspots are loaded, run ML prediction
        if model is not None and len(hotspots) > 0:
            # 1. Find distance to nearest hotspot
            min_dist = float('inf')
            for hs in hotspots:
                dist = calculate_distance(vector.latitude, vector.longitude, hs['latitude'], hs['longitude'])
                if dist < min_dist:
                    min_dist = dist
            
            # 2. Format features for model:
            # dist_to_hotspot, velocity_drop_ratio, arterial_divergence, delay_seconds, hour_of_day
            features = np.array([[min_dist, velocity_drop_ratio, arterial_divergence, vector.delay_seconds, vector.hour_of_day]])
            
            # 3. Predict using XGBoost
            prediction = model.predict(features)[0]
            probabilities = model.predict_proba(features)[0]
            
            is_curb_choke = bool(prediction == 1)
            confidence = float(probabilities[1])
        else:
            # Fallback to rule-based logic
            if velocity_drop_ratio < 0.35 and arterial_divergence > 12.0 and vector.delay_seconds > 60:
                is_curb_choke = True
                confidence = float(1.0 - velocity_drop_ratio)

        return {
            "segment_id": vector.segment_id,
            "coordinates": {"lat": vector.latitude, "lng": vector.longitude},
            "curb_choke_imminent": is_curb_choke,
            "confidence_score": round(confidence, 2),
            "delay_severity_index": round(vector.delay_seconds / 60.0, 1),
            "model_used": "XGBoost" if model is not None else "Rule-Based Heuristic"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)

