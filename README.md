# nbflood

Real-time water level monitoring dashboard for New Brunswick rivers. A modern, glassmorphism-styled web app that visualises flood station data, forecasts, and historical flood extents on an interactive map.

> **Disclaimer:** This is an unofficial community project. Always refer to the [official GeoNB River Watch](https://geonb.snb.ca/rwm/#en) for authoritative flood information.

![Built with](https://img.shields.io/badge/built%20with-HTML%20%2F%20CSS%20%2F%20JS-blue)
![Leaflet](https://img.shields.io/badge/map-Leaflet%201.9-green)
![Chart.js](https://img.shields.io/badge/charts-Chart.js%204-orange)

## Features

- **Live station markers** coloured by flood risk level (normal → advisory → watch → warning → flood)
- **Water level charts** with observed data, FEWS-NB forecasts, and WSC real-time readings over a ±3 day window
- **Historical flood extents** — toggle individual layers from 1973, 1976, 1987, 2008, and 2018 flood events
- **NB province boundary** overlay with city/town labels (44 place names with zoom-dependent visibility)
- **Glassmorphism UI** inspired by [nbfiremap.ca](https://nbfiremap.ca) — frosted glass panels, smooth animations
- **Satellite & street basemaps** — Esri World Imagery (default) and OpenStreetMap
- **Station list** — sortable by location, name, or risk level
- **Flood summary table** — quick overview of all station statuses
- **Fully static** — no build tools, no server, just open `index.html`

## Quick Start

1. Clone or download this repository
2. Open `index.html` in a modern browser
3. That's it — all data is fetched from public APIs at runtime

```
nbflood/
├── index.html          # Main page
├── css/
│   └── style.css       # Full glassmorphism theme
└── js/
    ├── utils.js        # Shared utilities
    ├── alerts.js       # Alert level definitions & colours
    ├── data.js         # Data fetching (GeoNB XML + WSC API)
    ├── map.js          # Leaflet map, markers, overlays, city labels
    ├── list.js         # Station list panel
    ├── chart.js        # Chart.js water level graphs
    └── app.js          # App init & UI wiring
```

## Data Sources

| Source | Provider | What it provides |
|--------|----------|------------------|
| [GeoNB River Watch](https://geonb.snb.ca/rwm/#en) | Province of NB, Dept. of Environment & Local Government | Flood alert thresholds, forecast water levels, station metadata |
| [Water Survey of Canada](https://wateroffice.ec.gc.ca/) | Environment and Climate Change Canada | Real-time hydrometric gauge data via EC GeoMet OGC API |
| [GeoNB Historical Floods](https://geonb.snb.ca/arcgis/rest/services/GeoNB_ENV_Historical_Floods/MapServer) | Province of NB | Historical flood extent & limit layers (1973–2018) |
| [Canada Province Boundary](https://services6.arcgis.com/MgHatnn8VBHh0mIt/ArcGIS/rest/services/Canada_Province_Boundary/FeatureServer) | ArcGIS Online | NB province boundary geometry |
| [Esri World Imagery](https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer) | Esri | Satellite imagery basemap tiles |
| [OpenStreetMap](https://www.openstreetmap.org/) | OSM Contributors | Street map basemap tiles |

## Tech Stack

- **[Leaflet 1.9.4](https://leafletjs.com/)** — Interactive map with custom markers, image overlays, and GeoJSON layers
- **[Esri Leaflet 3.0](https://esri.github.io/esri-leaflet/)** — ArcGIS feature layer integration
- **[Chart.js 4.4](https://www.chartjs.org/)** — Water level time-series charts with gradient fills and threshold annotations
- **[chartjs-plugin-annotation](https://www.chartjs.org/chartjs-plugin-annotation/)** — Threshold lines on charts
- **[chartjs-adapter-date-fns](https://github.com/chartjs/chartjs-adapter-date-fns)** — Date/time axis formatting
- **Vanilla JS** — No frameworks, no build step, ES5-compatible

## Browser Support

Works in all modern browsers (Chrome, Firefox, Edge, Safari). Requires JavaScript enabled and internet access for data fetching.

## Acknowledgements

Special thanks to:

- **Government of New Brunswick** — for making flood monitoring data publicly available through GeoNB
- **Environment and Climate Change Canada** — for the Water Survey of Canada real-time hydrometric data
- **[nbfiremap.ca](https://nbfiremap.ca)** — UI design inspiration and city/town label data
- **Leaflet, Chart.js, Esri** — open-source libraries that make this possible
- **OpenStreetMap contributors** — community-maintained map data

## License

This project is provided as-is for informational and educational purposes. Data is sourced from public government APIs and is subject to their respective terms of use.
