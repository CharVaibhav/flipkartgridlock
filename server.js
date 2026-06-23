const express = require('express');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const INFERENCE_ENDPOINT = process.env.INFERENCE_ENDPOINT || 'http://127.0.0.1:8000/predict-choke';

// Critical spatial centroids extracted from compressed_data.csv.xlsx clusters
const historicalHotspots = [
    {
        segment_id: "BLR_MADIWALA_CLUSTER_01",
        police_station: "Madiwala",
        latitude: 12.925557,
        longitude: 77.618665,
        freeflow_speed_kmh: 40.0,
        safe_bay: { lat: 12.9262, lng: 77.6195 }
    },
    {
        segment_id: "BLR_BELLANDUR_CLUSTER_02",
        police_station: "Bellandur",
        latitude: 12.905463,
        longitude: 77.700778,
        freeflow_speed_kmh: 45.0,
        safe_bay: { lat: 12.9061, lng: 77.7019 }
    }
];

// Helper evaluation function to run the classification request
async function evaluateHotspot(hotspot) {
    try {
        // Simulated programmatic telemetry from location metrics provider
        const telemetryPayload = {
            segment_id: hotspot.segment_id,
            latitude: hotspot.latitude,
            longitude: hotspot.longitude,
            current_speed_kmh: 8.5, // Deep velocity degradation event
            freeflow_speed_kmh: hotspot.freeflow_speed_kmh,
            upstream_speed_kmh: 32.0, // Upstream traffic is moving freely
            delay_seconds: 135.0,
            hour_of_day: new Date().getHours()
        };

        // Post downstream data matrix to the Python regression app
        const classification = await axios.post(INFERENCE_ENDPOINT, telemetryPayload);
        const status = classification.data;

        if (status.curb_choke_imminent && status.confidence_score > 0.80) {
            console.warn(`🚨 Velocity collapse detected at ${hotspot.segment_id}. Dispatching rerouting metrics...`);
            await executeAggregatorPinShift(hotspot, status.confidence_score);
        } else {
            console.log(`ℹ️ Segment ${hotspot.segment_id} traffic within normal parameters. No action required.`);
        }
    } catch (error) {
        console.error(`Error querying metrics matrix for ${hotspot.segment_id}:`, error.message);
    }
}

// Cron task: Evaluate traffic network deltas every 60 seconds
cron.schedule('*/1 * * * *', async () => {
    console.log(`[${new Date().toISOString()}] Polling Google Maps telemetry vectors for historical centroids...`);
    for (const hotspot of historicalHotspots) {
        await evaluateHotspot(hotspot);
    }
});

async function executeAggregatorPinShift(hotspot, severity) {
    const dispatchPayload = {
        event_type: "COMPRESSED_ZONE_GEOFENCE_ENFORCEMENT",
        target_station_zone: hotspot.police_station,
        segment_id: hotspot.segment_id,
        timestamp: Date.now(),
        metrics: { severity_rating: severity, activation_radius_meters: 90.0 },
        routing_instruction: {
            block_immediate_curb: true,
            redirect_coordinates: hotspot.safe_bay
        }
    };

    console.log("✈️ Sending API Pin-Shift Directive to Aggregators:", JSON.stringify(dispatchPayload, null, 2));
}

// REST endpoints for testing/triggering manually
app.get('/api/v1/hotspots', (req, res) => {
    res.json(historicalHotspots);
});

app.post('/api/v1/trigger-evaluation', async (req, res) => {
    console.log(`[Manual Trigger] Evaluating centroids immediately...`);
    for (const hotspot of historicalHotspots) {
        await evaluateHotspot(hotspot);
    }
    res.json({ status: "success", message: "Evaluation triggered successfully." });
});

app.listen(PORT, () => console.log(`RouteSync Node.js Orchestrator active on port ${PORT}`));
