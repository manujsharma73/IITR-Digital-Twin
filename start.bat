@echo off
rem Double-click to launch the IITR Digital Twin at http://localhost:8080/
if not exist "%~dp0data\osm_roads.json" (
  echo Fetching OpenStreetMap snapshot for campus roads and boundary...
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0fetch_osm.ps1"
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1" %*
