/* ==========================================================================
   map.js - Leaflet map with glassmorphism markers + basemap switch
   ========================================================================== */

const FloodMap = (function () {
    'use strict';

    let map = null;
    let markers = [];          // [{ marker, station }] for every station with a location
    let markerGroup = null;
    const baseLayers = {};
    let currentBase = 'imagery';
    const overlayLayers = {};
    let showNoData = false;

    const NB_CENTER = [46.7, -66.2];
    const NB_BOUNDS = [[44.0, -69.5], [48.5, -62.0]];

    /* marker diameter in px per alert level */
    const MARKER_SIZES = {
        nodata:   14,
        normal:   16,
        advisory: 19,
        watch:    22,
        warning:  25,
        flood:    29
    };

    const COLORS = FloodAlerts.COLORS;

    /**
     * From a cluster's markers, return the station with the most severe
     * alert level. The cluster is coloured and labelled after this station.
     */
    function mostSevereStation(childMarkers) {
        let top = childMarkers[0]._stationData;
        childMarkers.forEach(m => {
            const station = m._stationData;
            if (FloodAlerts.alertPriority(station.alertLevel) > FloodAlerts.alertPriority(top.alertLevel)) {
                top = station;
            }
        });
        return top;
    }

    // Cluster circle diameter in px: bigger clusters get bigger circles
    function clusterSize(count) {
        if (count >= 20) return 46;
        if (count >= 10) return 40;
        if (count >= 5)  return 35;
        return 30;
    }

    // Coloured "Normal" / "Flood" / ... badge used in the hover tooltips
    function stageBubble(level) {
        const color = COLORS[level] || COLORS.nodata;
        return `<span class="popup-badge" style="background:${color}">${FloodAlerts.alertLabel(level)}</span>`;
    }

    // Hover tooltip for a station: name, alert badge and current level
    function stationTooltipHtml(station) {
        const levelText = station.currentLevel != null
            ? `${FloodUtils.round(station.currentLevel, 2)} m`
            : 'No data';
        return `
            <div class="popup-name">${FloodUtils.escapeHtml(station.name)}</div>
            <div class="popup-meta">${stageBubble(station.alertLevel)}<span class="popup-level">${levelText}</span></div>`;
    }

    function init() {
        map = L.map('map', {
            center: NB_CENTER,
            zoom: 7,
            minZoom: 5,
            maxZoom: 18,
            zoomControl: false   // we use custom buttons
        });

        // Fit to NB bounds (same as nbfiremap's fitProvinceToView)
        map.fitBounds(NB_BOUNDS);

        // NB province outline
        map.createPane('nbBoundaryPane').style.zIndex = 405;
        fetchNBBoundary();

        // City/town labels (same as nbfiremap.ca)
        map.createPane('cityLabelsPane').style.zIndex = 650;
        addCityLabels();

        // Street tiles
        baseLayers.street = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
            maxZoom: 18
        });

        // Satellite/imagery tiles (Esri)
        baseLayers.imagery = L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: '&copy; Esri',
            maxZoom: 18
        });

        baseLayers.imagery.addTo(map);

        markerGroup = L.markerClusterGroup({
            maxClusterRadius: 55,
            showCoverageOnHover: false,
            zoomToBoundsOnClick: true,
            spiderfyOnMaxZoom: true,
            iconCreateFunction: cluster => {
                const level = mostSevereStation(cluster.getAllChildMarkers()).alertLevel;
                const color = COLORS[level] || COLORS.nodata;
                const count = cluster.getChildCount();
                const size = clusterSize(count);
                return L.divIcon({
                    html: `<div class="flood-cluster" style="width:${size}px;height:${size}px;line-height:${size}px;background:${color}">${count}</div>`,
                    className: '',
                    iconSize:   [size, size],
                    iconAnchor: [size / 2, size / 2]
                });
            }
        }).addTo(map);

        /* ── cluster hover tooltip ── */
        let clusterTooltip = null;

        function removeClusterTooltip() {
            if (clusterTooltip) {
                map.removeLayer(clusterTooltip);
                clusterTooltip = null;
            }
        }

        markerGroup.on('clustermouseover', e => {
            const cluster = e.layer;
            const children = cluster.getAllChildMarkers();
            const extra = children.length - 1;

            let html = stationTooltipHtml(mostSevereStation(children));
            if (extra > 0) {
                html += `<div class="popup-more">+${extra} more station${extra > 1 ? 's' : ''}</div>`;
            }

            clusterTooltip = L.tooltip({
                direction: 'top',
                offset: [0, -10],
                className: 'station-tooltip',
                permanent: false
            })
            .setContent(html)
            .setLatLng(cluster.getLatLng())
            .addTo(map);
        });

        markerGroup.on('clustermouseout', removeClusterTooltip);
        markerGroup.on('clusterclick', removeClusterTooltip);

        // Individual historical flood extent overlays (ArcGIS MapServer — all off by default)
        const floodServiceUrl = 'https://geonb.snb.ca/arcgis/rest/services/GeoNB_ENV_Historical_Floods/MapServer';
        const floodLayerDefs = [
            { key: 'flood_8',  ids: [8], label: '1973 Flood Limits' },
            { key: 'flood_0',  ids: [0], label: '2008 & 2018 Flood Limits' },
            { key: 'flood_1',  ids: [1], label: '1976 Ice Jam – Perth-Andover' },
            { key: 'flood_2',  ids: [2], label: '1987 Ice Jam – Perth-Andover' },
            { key: 'flood_3',  ids: [3], label: '1973 Flood – Fredericton to Gagetown' },
            { key: 'flood_4',  ids: [4], label: '2008 Flood – Upper Saint John' },
            { key: 'flood_5',  ids: [5], label: '2008 Flood – Lower Saint John' },
            { key: 'flood_6',  ids: [6], label: '2018 Flood – Lower Saint John' }
        ];
        // esri-leaflet asks the ArcGIS server for one image of the current view
        // and re-requests it whenever the map is panned or zoomed.
        floodLayerDefs.forEach(def => {
            overlayLayers[def.key] = L.esri.dynamicMapLayer({
                url: floodServiceUrl,
                layers: def.ids,
                opacity: 0.55
            });
        });

        return map;
    }

    // -- NB Province Boundary --

    // Draws the New Brunswick outline from Esri's Canada province boundaries
    // (simplified to ~500 m so it downloads quickly)
    async function fetchNBBoundary() {
        const url = 'https://services6.arcgis.com/MgHatnn8VBHh0mIt/ArcGIS/rest/services/Canada_Province_Boundary/FeatureServer/2/query'
            + '?where=PRENAME%3D%27New%20Brunswick%27&outFields=PRENAME&outSR=4326&returnGeometry=true&f=geojson'
            + '&maxAllowableOffset=0.005&geometryPrecision=4';
        try {
            const geojson = await (await fetch(url)).json();
            L.geoJSON(geojson, {
                pane: 'nbBoundaryPane',
                style: { color: '#0b0f19', weight: 3, fill: false, opacity: 0.8 },
                interactive: false
            }).addTo(map);
        } catch (err) {
            console.warn('NB boundary fetch failed:', err);
        }
    }

    // -- City / Town Labels (same list as nbfiremap.ca) --

    const CITY_DATA = [
        // [name, lat, lng, population]
        // Major (≥50k) — zoom 6+
        ['Moncton', 46.0878, -64.7782, 79000],
        ['Saint John', 45.2733, -66.0633, 69000],
        ['Fredericton', 45.9636, -66.6431, 63000],
        // Large (≥15k) — zoom 7+
        ['Dieppe', 46.0842, -64.6877, 28500],
        ['Riverview', 46.0617, -64.8052, 20500],
        ['Miramichi', 47.0281, -65.5019, 17500],
        ['Quispamsis', 45.4319, -65.9469, 19500],
        ['Edmundston', 47.3730, -68.3251, 16000],
        // Medium (≥5k) — zoom 8+
        ['Rothesay', 45.3830, -65.9965, 12000],
        ['Bathurst', 47.6186, -65.6517, 12000],
        ['Oromocto', 45.8491, -66.4828, 9500],
        ['Shediac', 46.2197, -64.5403, 7000],
        ['Campbellton', 48.0075, -66.6731, 6700],
        ['Sackville', 45.8960, -64.3688, 5500],
        ['Grand Bay-Westfield', 45.3629, -66.2306, 5200],
        ['Woodstock', 46.1527, -67.6016, 5200],
        ['Grand Falls', 47.0469, -67.7394, 5200],
        ['Memramcook', 46.0020, -64.5480, 5000],
        // Small (≥2k) — zoom 9+
        ['Tracadie', 47.5081, -64.9117, 4800],
        ['St. Stephen', 45.1942, -67.2756, 4500],
        ['Hampton', 45.5322, -65.8332, 4400],
        ['Sussex', 45.7221, -65.5060, 4300],
        ['Caraquet', 47.7943, -64.9386, 4200],
        ['Dalhousie', 48.0658, -66.3737, 2900],
        ['Shippagan', 47.7400, -64.7078, 2700],
        ['Bouctouche', 46.4711, -64.7400, 2400],
        ['Minto', 46.1480, -66.0840, 2400],
        ['Cap-Pelé', 46.2260, -64.2750, 2400],
        ['Saint-Quentin', 47.5120, -67.3920, 2100],
        ['St. Andrews', 45.0730, -67.0530, 2100],
        // Towns (1k-2k) — zoom 10+
        ['Perth-Andover', 46.7372, -67.7089, 1600],
        ['Florenceville-Bristol', 46.4448, -67.6170, 1600],
        ['Neguac', 47.2420, -65.0580, 1500],
        ['St. George', 45.1290, -66.8270, 1500],
        ['Petit-Rocher', 47.7900, -65.7130, 1400],
        ['Bas-Caraquet', 47.7860, -64.9730, 1400],
        ['Richibucto', 46.6770, -64.8710, 1300],
        ['Saint-Léonard', 47.1640, -67.9250, 1300],
        ['Hillsborough', 45.9190, -64.7630, 1300],
        ['Rogersville', 46.7370, -65.4380, 1200],
        ['Chipman', 46.1680, -65.8820, 1200],
        ['McAdam', 45.5940, -67.3250, 1100],
        ['Plaster Rock', 46.9108, -67.3949, 1100],
        // Villages (<1k) — zoom 10+
        ['Nackawic', 45.9960, -67.2510, 950],
        ['Hartland', 46.2990, -67.5150, 950],
        ['Kedgwick', 47.6450, -67.3430, 950],
        ['Blacks Harbour', 45.0520, -66.7880, 900],
        ['Rexton', 46.6490, -64.8750, 830],
        ['Doaktown', 46.5550, -66.1180, 800]
    ];

    // The zoom level at which a city's label starts to show (bigger = later)
    function getCityZoomThreshold(pop) {
        if (pop >= 50000) return 6;
        if (pop >= 15000) return 7;
        if (pop >= 5000)  return 8;
        if (pop >= 2000)  return 9;
        return 10;
    }

    const cityMarkers = [];

    function addCityLabels() {
        CITY_DATA.forEach(([name, lat, lng, pop]) => {
            const marker = L.marker([lat, lng], {
                icon: L.divIcon({ className: 'city-marker-icon', iconSize: [0, 0] }),
                pane: 'cityLabelsPane',
                interactive: false,
                zIndexOffset: 1000
            });
            marker.bindTooltip(
                `<span class="city-label">${name}</span>`,
                { permanent: true, direction: 'top', className: 'city-label-tooltip', offset: [0, 2] }
            );
            marker._cityPop = pop;
            marker._cityThreshold = getCityZoomThreshold(pop);
            cityMarkers.push(marker);
        });

        // 'moveend' fires after every pan *and* every zoom, so it covers both
        map.on('moveend', updateCityVisibility);
        updateCityVisibility();
    }

    function updateCityVisibility() {
        const zoom = map.getZoom();

        // Labels that should show at this zoom; hide the rest
        const visible = cityMarkers.filter(m => {
            if (zoom >= m._cityThreshold) return true;
            if (map.hasLayer(m)) map.removeLayer(m);
            return false;
        });

        // Sort by population desc so larger cities take priority
        visible.sort((a, b) => b._cityPop - a._cityPop);

        // Hide smaller cities whose label would be within 80px of a larger one's
        const placed = [];
        visible.forEach(m => {
            const pt = map.latLngToContainerPoint(m.getLatLng());
            const tooClose = placed.some(other => pt.distanceTo(other) < 80);
            if (tooClose) {
                if (map.hasLayer(m)) map.removeLayer(m);
            } else {
                if (!map.hasLayer(m)) m.addTo(map);
                placed.push(pt);
            }
        });
    }

    function switchBasemap(key) {
        if (!baseLayers[key] || key === currentBase) return;
        map.removeLayer(baseLayers[currentBase]);
        baseLayers[key].addTo(map);
        currentBase = key;
    }

    function setStations(stations, onStationClick) {
        markerGroup.clearLayers();
        markers = [];

        stations.forEach(station => {
            if (station.lat == null || station.lng == null) return;

            const size = MARKER_SIZES[station.alertLevel] || MARKER_SIZES.normal;
            const marker = L.marker([station.lat, station.lng], {
                icon: L.divIcon({
                    className: `flood-marker ${station.alertLevel}`,
                    iconSize:   [size, size],
                    iconAnchor: [size / 2, size / 2]
                })
            });
            marker._stationData = station;   // read back by mostSevereStation()

            marker.bindTooltip(stationTooltipHtml(station), {
                direction: 'top',
                offset: [0, -(size / 2)],
                className: 'station-tooltip'
            });

            marker.on('click', () => {
                if (typeof onStationClick === 'function') onStationClick(station);
            });

            // Hide nodata markers if toggle is off
            if (station.alertLevel !== 'nodata' || showNoData) {
                marker.addTo(markerGroup);
            }
            markers.push({ marker, station });
        });
    }

    function toggleOverlay(key, visible) {
        const layer = overlayLayers[key];
        if (!layer) return;
        if (visible) {
            layer.addTo(map);
        } else {
            map.removeLayer(layer);
        }
    }

    function setShowNoData(val) {
        showNoData = val;
        markers.forEach(({ marker, station }) => {
            if (station.alertLevel !== 'nodata') return;
            if (val) {
                if (!markerGroup.hasLayer(marker)) marker.addTo(markerGroup);
            } else {
                markerGroup.removeLayer(marker);
            }
        });
    }

    function flyTo(station) {
        if (!map || station.lat == null) return;
        map.flyTo([station.lat, station.lng], 11, { duration: 0.8 });
    }

    function highlightStation(stationID) {
        markers.forEach(({ marker, station }) => {
            const el = marker.getElement();
            if (!el) return;   // marker is inside a cluster right now
            const isSelected = station.stationID === stationID;
            el.classList.toggle('selected', isSelected);
            el.style.zIndex = isSelected ? '1000' : '';
        });
    }

    function resetView() {
        if (map) map.flyToBounds(NB_BOUNDS, { duration: 0.6 });
    }

    function zoomIn() { if (map) map.zoomIn(); }
    function zoomOut() { if (map) map.zoomOut(); }

    return {
        init,
        setStations,
        flyTo,
        highlightStation,
        resetView,
        zoomIn,
        zoomOut,
        switchBasemap,
        toggleOverlay,
        setShowNoData,
        getMap: () => map
    };
})();
