/* ==========================================================================
   map.js - Leaflet map with glassmorphism markers + basemap switch
   ========================================================================== */

var FloodMap = (function () {
    'use strict';

    var map = null;
    var markers = [];
    var markerGroup = null;
    var selectedStationID = null;
    var baseLayers = {};
    var currentBase = 'imagery';
    var overlayLayers = {};
    var showNoData = false;

    var NB_CENTER = [46.7, -66.2];
    var NB_BOUNDS = [[44.0, -69.5], [48.5, -62.0]];
    var MARKER_RADIUS = 10;

    var COLORS = {
        normal:   '#3b82f6',
        advisory: '#22c55e',
        watch:    '#eab308',
        warning:  '#f97316',
        flood:    '#dc2626',
        nodata:   '#6b7280'
    };

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

        // NB province boundary (GeoNB Health Regions outline)
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
        markerGroup = L.layerGroup().addTo(map);

        // Individual historical flood extent overlays (ArcGIS MapServer — all off by default)
        var floodServiceUrl = 'https://geonb.snb.ca/arcgis/rest/services/GeoNB_ENV_Historical_Floods/MapServer';
        var floodLayerDefs = [
            { key: 'flood_8',  ids: [8], label: '1973 Flood Limits' },
            { key: 'flood_0',  ids: [0], label: '2008 & 2018 Flood Limits' },
            { key: 'flood_1',  ids: [1], label: '1976 Ice Jam – Perth-Andover' },
            { key: 'flood_2',  ids: [2], label: '1987 Ice Jam – Perth-Andover' },
            { key: 'flood_3',  ids: [3], label: '1973 Flood – Fredericton to Gagetown' },
            { key: 'flood_4',  ids: [4], label: '2008 Flood – Upper Saint John' },
            { key: 'flood_5',  ids: [5], label: '2008 Flood – Lower Saint John' },
            { key: 'flood_6',  ids: [6], label: '2018 Flood – Lower Saint John' }
        ];
        floodLayerDefs.forEach(function (def) {
            overlayLayers[def.key] = createArcGISDynamicLayer(floodServiceUrl, def.ids);
        });

        return map;
    }

    // -- NB Province Boundary --

    function fetchNBBoundary() {
        var url = 'https://services6.arcgis.com/MgHatnn8VBHh0mIt/ArcGIS/rest/services/Canada_Province_Boundary/FeatureServer/2/query'
            + '?where=PRENAME%3D%27New%20Brunswick%27&outFields=PRENAME&outSR=4326&returnGeometry=true&f=geojson'
            + '&maxAllowableOffset=0.005&geometryPrecision=4';
        fetch(url)
            .then(function (r) { return r.json(); })
            .then(function (geojson) {
                L.geoJSON(geojson, {
                    pane: 'nbBoundaryPane',
                    style: { color: '#0b0f19', weight: 3, fill: false, opacity: 0.8 },
                    interactive: false
                }).addTo(map);
            })
            .catch(function (err) {
                console.warn('NB boundary fetch failed:', err);
            });
    }

    // -- City / Town Labels (same list as nbfiremap.ca) --

    var CITY_DATA = [
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

    function getCityZoomThreshold(pop) {
        if (pop >= 50000) return 6;
        if (pop >= 15000) return 7;
        if (pop >= 5000)  return 8;
        if (pop >= 2000)  return 9;
        return 10;
    }

    var cityMarkers = [];

    function addCityLabels() {
        CITY_DATA.forEach(function (c) {
            var name = c[0], lat = c[1], lng = c[2], pop = c[3];
            var icon = L.divIcon({ className: 'city-marker-icon', iconSize: [0, 0] });
            var marker = L.marker([lat, lng], {
                icon: icon,
                pane: 'cityLabelsPane',
                interactive: false,
                zIndexOffset: 1000
            });
            marker.bindTooltip(
                '<span class="city-label">' + name + '</span>',
                { permanent: true, direction: 'top', className: 'city-label-tooltip', offset: [0, 2] }
            );
            marker._cityPop = pop;
            marker._cityThreshold = getCityZoomThreshold(pop);
            cityMarkers.push(marker);
        });

        map.on('zoomend moveend', updateCityVisibility);
        updateCityVisibility();
    }

    function updateCityVisibility() {
        var zoom = map.getZoom();
        var visible = [];

        // Gather labels that should show at this zoom
        cityMarkers.forEach(function (m) {
            if (zoom >= m._cityThreshold) {
                visible.push(m);
            } else if (map.hasLayer(m)) {
                map.removeLayer(m);
            }
        });

        // Sort by population desc so larger cities take priority
        visible.sort(function (a, b) { return b._cityPop - a._cityPop; });

        // Pixel-clustering: hide smaller cities that overlap a larger one (80px threshold)
        var placed = [];
        visible.forEach(function (m) {
            var pt = map.latLngToContainerPoint(m.getLatLng());
            var tooClose = false;
            for (var i = 0; i < placed.length; i++) {
                var d = pt.distanceTo(placed[i]);
                if (d < 80) { tooClose = true; break; }
            }
            if (tooClose) {
                if (map.hasLayer(m)) map.removeLayer(m);
            } else {
                if (!map.hasLayer(m)) m.addTo(map);
                placed.push(pt);
            }
        });
    }

    /**
     * Create an ArcGIS dynamic map layer using Leaflet's built-in capabilities.
     * Uses /export endpoint to render a map image for the current map extent.
     */
    function createArcGISDynamicLayer(serviceUrl, layerIds) {
        var DynLayer = L.Layer.extend({
            onAdd: function (map) {
                this._map = map;
                this._overlay = null;
                this._serviceUrl = serviceUrl;
                this._layers = layerIds.join(',');
                this._loading = false;
                map.on('moveend', this._update, this);
                this._update();
            },
            onRemove: function (map) {
                if (this._overlay) {
                    map.removeLayer(this._overlay);
                    this._overlay = null;
                }
                map.off('moveend', this._update, this);
            },
            _update: function () {
                if (this._loading) return;
                var bounds = this._map.getBounds();
                var size = this._map.getSize();
                if (size.x === 0 || size.y === 0) return;

                var sw = bounds.getSouthWest();
                var ne = bounds.getNorthEast();
                var bbox = sw.lng + ',' + sw.lat + ',' + ne.lng + ',' + ne.lat;
                var url = this._serviceUrl + '/export?bbox=' + bbox +
                    '&bboxSR=4326&imageSR=4326&size=' + size.x + ',' + size.y +
                    '&format=png32&transparent=true&layers=show:' + this._layers +
                    '&dpi=96&f=image';

                var me = this;
                var imageBounds = L.latLngBounds(sw, ne);
                this._loading = true;

                var img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = function () {
                    me._loading = false;
                    if (me._overlay) {
                        me._map.removeLayer(me._overlay);
                    }
                    me._overlay = L.imageOverlay(url, imageBounds, {
                        opacity: 0.55,
                        interactive: false
                    }).addTo(me._map);
                };
                img.onerror = function () {
                    me._loading = false;
                };
                img.src = url;
            }
        });
        return new DynLayer();
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

        stations.forEach(function (station) {
            if (station.lat == null || station.lng == null) return;

            var icon = L.divIcon({
                className: 'flood-marker ' + station.alertLevel,
                iconSize: [MARKER_RADIUS * 2, MARKER_RADIUS * 2],
                iconAnchor: [MARKER_RADIUS, MARKER_RADIUS]
            });

            var marker = L.marker([station.lat, station.lng], { icon: icon });

            var levelText = station.currentLevel != null
                ? FloodUtils.round(station.currentLevel, 2) + ' m'
                : 'No data';

            marker.bindTooltip(
                '<div class="popup-name">' + station.name + '</div>' +
                '<div class="popup-level">' + levelText + '</div>',
                { direction: 'top', offset: [0, -MARKER_RADIUS], className: 'station-tooltip' }
            );

            marker.on('click', function () {
                if (typeof onStationClick === 'function') onStationClick(station);
            });

            // Hide nodata markers if toggle is off
            if (station.alertLevel !== 'nodata' || showNoData) {
                marker.addTo(markerGroup);
            }
            markers.push({ marker: marker, station: station });
        });
    }

    function toggleOverlay(key, visible) {
        var layer = overlayLayers[key];
        if (!layer) return;
        if (visible) {
            layer.addTo(map);
        } else {
            map.removeLayer(layer);
        }
    }

    function setShowNoData(val) {
        showNoData = val;
        markers.forEach(function (m) {
            if (m.station.alertLevel === 'nodata') {
                if (val) {
                    if (!markerGroup.hasLayer(m.marker)) m.marker.addTo(markerGroup);
                } else {
                    markerGroup.removeLayer(m.marker);
                }
            }
        });
    }

    function flyTo(station) {
        if (!map || station.lat == null) return;
        map.flyTo([station.lat, station.lng], 11, { duration: 0.8 });
    }

    function highlightStation(stationID) {
        selectedStationID = stationID;
        markers.forEach(function (m) {
            var el = m.marker.getElement();
            if (!el) return;
            if (m.station.stationID === stationID) {
                el.classList.add('selected');
                el.style.zIndex = '1000';
            } else {
                el.classList.remove('selected');
                el.style.zIndex = '';
            }
        });
    }

    function resetView() {
        if (map) map.flyToBounds(NB_BOUNDS, { duration: 0.6 });
    }

    function zoomIn() { if (map) map.zoomIn(); }
    function zoomOut() { if (map) map.zoomOut(); }

    function invalidateSize() {
        if (map) setTimeout(function () { map.invalidateSize(); }, 100);
    }

    return {
        init: init,
        setStations: setStations,
        flyTo: flyTo,
        highlightStation: highlightStation,
        resetView: resetView,
        zoomIn: zoomIn,
        zoomOut: zoomOut,
        switchBasemap: switchBasemap,
        toggleOverlay: toggleOverlay,
        setShowNoData: setShowNoData,
        invalidateSize: invalidateSize,
        getMap: function () { return map; },
        COLORS: COLORS
    };
})();
