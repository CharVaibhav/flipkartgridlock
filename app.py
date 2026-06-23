import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import uvicorn

app = FastAPI(title="RouteSync Historical Matrix Engine")

class SpatialVector(BaseModel):
    segment_id: str
    latitude: float
    longitude: float
    current_speed_kmh: float
    freeflow_speed_kmh: float
    upstream_speed_kmh: float
    delay_seconds: float
    hour_of_day: int

@app.post("/predict-choke")
async def predict_choke(vector: SpatialVector):
    try:
        # Calculate velocity drop ratio & arterial velocity divergence
        velocity_drop_ratio = vector.current_speed_kmh / max(vector.freeflow_speed_kmh, 1.0)
        arterial_divergence = vector.upstream_speed_kmh - vector.current_speed_kmh
        
        # Classification Bound: Structural Curb Blockage Signature
        # Derived from tracking "PARKING IN A MAIN ROAD" clusters
        is_curb_choke = False
        confidence = 0.0
        
        if velocity_drop_ratio < 0.35 and arterial_divergence > 12.0 and vector.delay_seconds > 60:
            is_curb_choke = True
            confidence = float(1.0 - velocity_drop_ratio)
            
        return {
            "segment_id": vector.segment_id,
            "coordinates": {"lat": vector.latitude, "lng": vector.longitude},
            "curb_choke_imminent": is_curb_choke,
            "confidence_score": round(confidence, 2),
            "delay_severity_index": round(vector.delay_seconds / 60.0, 1)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
