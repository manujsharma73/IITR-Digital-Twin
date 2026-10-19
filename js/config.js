/*
 * IITR Digital Twin – configuration
 *
 * Google Photorealistic 3D Tiles can be streamed in two ways. Fill in ONE (or both):
 *
 *  1. GOOGLE_MAPS_API_KEY – a Google Maps Platform key with the "Map Tiles API" enabled.
 *     Restrict it to HTTP referrer  http://localhost:8080/*  and to the Map Tiles API only.
 *
 *  2. CESIUM_ION_TOKEN – a Cesium ion access token. ion streams the Google tiles for you
 *     (asset "Google Photorealistic 3D Tiles") and also enables the Google geocoder search box.
 *
 * If both are left empty, the app asks for them on first launch and keeps them in this
 * browser's localStorage only. Do NOT commit real keys to a public repository.
 */
window.IITR_CONFIG = {
  GOOGLE_MAPS_API_KEY: "",
  CESIUM_ION_TOKEN: "",
};
