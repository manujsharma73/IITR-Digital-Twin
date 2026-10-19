# IIT Roorkee Digital Twin

A browser-based 3D twin of the IIT Roorkee campus. It is built with CesiumJS 1.146 (loaded from the jsDelivr CDN) and Google Photorealistic 3D Tiles. Nothing needs to be installed.

## Run

1. Double-click `start.bat`, or run `powershell -ExecutionPolicy Bypass -File serve.ps1`.
2. The browser opens at http://localhost:8080/. Use `-Port 8090` if that port is busy.
3. On first launch, paste **one** of these keys:
   - A **Google Maps Platform API key** with the *Map Tiles API* enabled. Restrict it to the referrer `http://localhost:8080/*` and to the Map Tiles API only.
   - A **Cesium ion access token** (free tier at cesium.com/ion). ion streams the Google tiles and also enables the Google place-search box.

   Keys are kept in this browser's localStorage. You can put them in `js/config.js` instead, but never commit real keys.
4. `http://localhost:8080/?osm=1` runs without keys, using flat OpenStreetMap imagery.

Do not open `index.html` directly from disk. Use the local server, because API-key referrer checks and `fetch` need an `http://` origin.

## Features

| Area | What it does |
|---|---|
| 3D base | Google Photorealistic 3D Tiles. Falls back to OSM imagery if the tiles fail. |
| Camera | Cinematic fly-in from orbit, auto-orbit, guided tour, top-down view, compass (click to face north). WASD/QE flight, arrow keys to turn, Shift for speed. |
| Time of day | Real solar elevation for Roorkee. Sky and atmosphere follow the sun. A custom tile shader adds golden-hour warmth and a night grade. Time-lapse runs at 40 simulated minutes per second. |
| Visual modes | **Photo**. **Height**: mesh height above campus road level, colour-ramped, with 5 m contours. **Blueprint**: monochrome with 3 m contours. |
| Landmarks | 33 OSM buildings with pins, labels and light beacons. Click one to fly, orbit, or take a low-angle view. |
| Geofence | The campus boundary is fetched live from OSM (Overpass) and drawn as a pulsing wall. |
| Roads + agents | The OSM road and path network inside the boundary, with up to 800 animated agents on it. |
| Tools | Measure (horizontal, vertical and 3D distance between two clicks). Screenshot with attribution. Photo mode (H). Cinematic grade with vignette and night bloom. Volumetric clouds. |

## Live traffic

**Controls › Live traffic** drapes Google's real-time traffic tiles onto the 3D mesh. These are the same green, orange and red road colours as on Google Maps. They come from the Map Tiles API 2D tiles with the `layerTraffic` overlay type.

- The overlay uses your Google key if you set one, otherwise the Cesium ion Google 2D asset.
- Tiles are limited to greater Roorkee and refresh every 5 minutes. Each refresh is billed as Map Tiles API 2D tile usage.
- Campus internal roads usually have no traffic data. Use **City view** to see the NH-334 corridor and city roads.
- Draping imagery on 3D Tiles is an experimental CesiumJS API.
- The night grade dims the traffic colours.
- These tiles are pictures. They do not give speeds you can download. Numbers you can analyse need another source, such as the Routes API's traffic-on-polyline speed intervals, or a Roads API licence.

## Caveats

- **Agents are illustrative.** They take random walks on OSM ways. They are not MATSim output and must not be shown as campus traffic. The UI says so. A natural next step is to replay MATSim `output_events.xml.gz` link-enter/leave events along the same OSM geometry.
- **Coverage is unverified.** Google does not publish a city list in its docs. If Roorkee has no high-resolution photogrammetry, the tiles show coarse terrain plus imagery. Check by zooming in on the campus.
- **Heights are estimates from the mesh.**
  - "Ground" is the median clamped height of road vertices. Road vertices are then limited to ±2.5 m of it, which assumes a flat campus and keeps tree canopy from lifting roads.
  - The landmark "mesh height" is the surface at the OSM centroid, so it can hit a tree or a lower roof section.
  - The shader's height is computed in float32 against a tangent plane, so expect about 0.5 m noise.
  - None of these is survey-grade.
- **Landmark coordinates** are OSM building centroids, fetched 2026-10-19. The Main Building is missing because it is not tagged as a named building in the queried OSM data.
- **Attribution.** Google and data-provider credits are shown on screen by Cesium and must stay visible. Landmarks, roads and boundary are © OpenStreetMap contributors (ODbL).
- **OSM data loading order.** The app first uses the local snapshot in `data\`, which `fetch_osm.ps1` writes. `start.bat` runs that script automatically if the snapshot is missing. Next it tries a 7-day localStorage cache, and last the live Overpass API. If none of these work, the boundary falls back to the bounding box and the agents are disabled.
- **Debugging.** `?debug` logs camera and layer state to the console every 3 s. `window.iitrViewer` exposes the Cesium viewer.

## Files

```
index.html        page shell and UI
css/style.css     glass UI theme
js/config.js      optional API keys
js/landmarks.js   OSM landmark list and guided-tour order
js/app.js         viewer, tiles, shaders, OSM layers, agents, camera, tools
serve.ps1         PowerShell static server (no Node/Python needed)
start.bat         double-click launcher (fetches the OSM snapshot first if missing)
fetch_osm.ps1     saves the campus boundary and roads from Overpass into data\
```
