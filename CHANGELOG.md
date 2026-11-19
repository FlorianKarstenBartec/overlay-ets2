# Changelog

## 1.3.0

- Windows NSIS installer (Setup.exe) – no Node.js needed for players
- Average km/h setting on first launch and via tray → Einstellungen
- Tray checkbox to start with Windows (installed build only)
- Tour HUD shows a short hint when ETS2 is running but FPH telemetry is missing

## 1.2.0

- Progress truck snaps to the right edge at the end of the bar

## 1.1.0

- Tray uses the progress-bar truck icon
- Left-click tray toggles the overlay
- German README with screenshots

## 1.0.0

First tagged release.

- Always-on-top tour HUD and small real-time clock
- Job line with destination, cargo, weight, company
- Country flags from city id and name
- Rest distance from navigation
- Duration and arrival from real-time km throughput (not game timescale)
- Ferry km locked at tour start when nav is clearly longer than the job plan, then subtracted from duration and arrival only
- Progress bar tracks navigation distance, survives overlay restarts, and adjusts when you add or remove map waypoints
- Cruise control readout
- Hide tour HUD on pause without a job, and when the game is not connected
- F9 toggle, tray quit
