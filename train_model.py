import pandas as pd
import numpy as np
from sklearn.cluster import KMeans
from xgboost import XGBClassifier
import json
import os

def main():
    csv_path = 'jan to may police violation_anonymized791b166.csv'
    print("Loading cleaned dataset...")
    df = pd.read_csv(csv_path)

    # 1. Spatial Hotspot Extraction
    print("Extracting spatial clusters using K-Means...")
    coords = df[['latitude', 'longitude']].dropna()
    
    # We fit KMeans to find 20 major hotspot coordinates in Bengaluru
    kmeans = KMeans(n_clusters=20, random_state=42, n_init='auto')
    kmeans.fit(coords)
    
    # Assign cluster labels back to dataframe to extract police station names
    df_clustered = df.loc[coords.index].copy()
    df_clustered['cluster'] = kmeans.labels_
    
    centroids = kmeans.cluster_centers_
    hotspots = []
    for idx, center in enumerate(centroids):
        # Find the most common police station in this cluster
        cluster_rows = df_clustered[df_clustered['cluster'] == idx]
        station = 'Unknown'
        if 'police_station' in cluster_rows.columns:
            top_station = cluster_rows['police_station'].dropna().value_counts()
            if len(top_station) > 0:
                station = top_station.index[0]
        
        lat = float(center[0])
        lng = float(center[1])
        hotspots.append({
            "segment_id": f"BLR_{station.upper().replace(' ', '_')}_CLUSTER_{idx:02d}",
            "police_station": station,
            "latitude": lat,
            "longitude": lng,
            "freeflow_speed_kmh": round(float(np.random.uniform(35, 50)), 1),
            "safe_bay": { "lat": round(lat + 0.001, 6), "lng": round(lng + 0.001, 6) }
        })
        
    # Save the hotspots for app.py and server.js
    with open('hotspots.json', 'w') as f:
        json.dump(hotspots, f, indent=2)
    print(f"Saved {len(hotspots)} spatial hotspots to hotspots.json")

    # 2. Synthetic Telemetry Data Generation for Training
    # We simulate 10,000 traffic scenarios to train the XGBoost classifier.
    # The features are: distance_to_nearest_hotspot, velocity_drop_ratio, arterial_divergence, delay_seconds, hour_of_day
    print("Generating simulated telemetry training data...")
    np.random.seed(42)
    n_samples = 10000

    # Draw random distances to nearest hotspot (in degrees, ~0 to 0.05 degrees)
    dist_to_hotspot = np.random.exponential(scale=0.01, size=n_samples)
    
    # Draw speeds
    freeflow = np.random.uniform(30.0, 50.0, size=n_samples)
    current = np.random.uniform(5.0, 45.0, size=n_samples)
    upstream = np.random.uniform(20.0, 45.0, size=n_samples)
    delay = np.random.exponential(scale=100.0, size=n_samples)
    hour = np.random.randint(0, 24, size=n_samples)

    # Derive engineered features
    velocity_drop_ratio = current / freeflow
    arterial_divergence = upstream - current

    # Define label function: A curb choke occurs when:
    # 1. The telemetry suggests a major bottleneck (drop < 0.35, divergence > 12, delay > 60 seconds)
    # 2. AND the location is close to a historical violation hotspot (distance < 0.015 degrees)
    is_choke = []
    for i in range(n_samples):
        rule_telemetry = (velocity_drop_ratio[i] < 0.35) and (arterial_divergence[i] > 12.0) and (delay[i] > 60.0)
        near_hotspot = dist_to_hotspot[i] < 0.015
        
        # We add some minor noise to simulate real-world variance
        if rule_telemetry and near_hotspot:
            label = 1 if np.random.random() > 0.05 else 0
        else:
            label = 1 if np.random.random() < 0.02 else 0
        is_choke.append(label)

    train_df = pd.DataFrame({
        'dist_to_hotspot': dist_to_hotspot,
        'velocity_drop_ratio': velocity_drop_ratio,
        'arterial_divergence': arterial_divergence,
        'delay_seconds': delay,
        'hour_of_day': hour,
        'is_curb_choke': is_choke
    })

    # 3. Train XGBoost Model
    print("Training XGBoost Anomaly Classifier...")
    X = train_df[['dist_to_hotspot', 'velocity_drop_ratio', 'arterial_divergence', 'delay_seconds', 'hour_of_day']]
    y = train_df['is_curb_choke']

    model = XGBClassifier(
        n_estimators=100,
        max_depth=5,
        learning_rate=0.1,
        random_state=42,
        use_label_encoder=False,
        eval_metric='logloss'
    )
    model.fit(X, y)

    # Save trained XGBoost model
    model.save_model('choke_model.json')
    print("Model saved to choke_model.json successfully!")

if __name__ == "__main__":
    main()
