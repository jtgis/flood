/* ==========================================================================
   app.js - Main entry point (glassmorphism layout wiring)
   ========================================================================== */

(function () {
    'use strict';

    var allStations = [];

    document.addEventListener('DOMContentLoaded', function () {
        FloodMap.init();
        FloodChart.init();
        FloodList.init(onStationSelect);

        setupSplashScreen();
        setupLeftControls();
        setupLegendPanel();
        setupLayersPanel();
        setupBottomBar();
        setupModals();
        setupKeyboardNav();
        setupBasemapRadios();
        setupOverlayToggles();
        setupPanelClose();

        loadData();
    });

    // -- Splash Screen --

    function setupSplashScreen() {
        var splash = document.getElementById('splash-screen');
        if (!splash) return;
        document.getElementById('splash-enter').addEventListener('click', function () {
            splash.classList.add('hidden');
            setTimeout(function () { splash.remove(); }, 500);
        });
    }

    // -- Data loading --

    function loadData() {
        FloodData.loadAll()
            .then(function (result) {
                allStations = result.stations;

                // Update timestamp in legend
                if (result.creationDate) {
                    var tsEl = document.getElementById('data-timestamp');
                    if (tsEl) tsEl.textContent = 'Data: ' + result.creationDate;
                }

                // Populate map
                FloodMap.setStations(allStations, onStationSelect);

                // Populate list & legend counts
                FloodList.setStations(allStations);
                FloodList.updateLegend(allStations);

                // Check URL hash
                var hash = window.location.hash;
                if (hash && hash.indexOf('#station/') === 0) {
                    var id = decodeURIComponent(hash.replace('#station/', ''));
                    var found = allStations.find(function (s) { return s.stationID === id || s.name === id; });
                    if (found) onStationSelect(found);
                }
            })
            .catch(function (err) {
                console.error('Failed to load data:', err);
                FloodUtils.showToast('Failed to load station data. Check console.', 8000);
            });
    }

    // -- Station select --

    function onStationSelect(station) {
        window.location.hash = 'station/' + encodeURIComponent(station.stationID);

        FloodMap.flyTo(station);
        FloodMap.highlightStation(station.stationID);

        // Open station panel
        var panel = document.getElementById('station-panel');
        panel.classList.remove('hidden');
        panel.setAttribute('aria-hidden', 'false');

        // Name + badge
        document.getElementById('panel-station-name').textContent = station.name;
        var badge = document.getElementById('panel-alert-badge');
        badge.className = 'sp-badge ' + station.alertLevel;
        badge.textContent = FloodAlerts.alertLabel(station.alertLevel);

        // Meta
        document.getElementById('panel-current-level').textContent =
            station.currentLevel != null ? FloodUtils.round(station.currentLevel, 2) + ' m' : '\u2014';

        var trend = station.trend || { direction: 'stable', rate: 0 };
        var trendEl = document.getElementById('panel-trend');
        trendEl.textContent = FloodUtils.trendArrow(trend.direction) + ' ' +
            trend.direction.charAt(0).toUpperCase() + trend.direction.slice(1) +
            (trend.rate > 0 ? ' (' + trend.rate + ' m/hr)' : '');

        var issuedText = '\u2014';
        if (station.lastReadingTime) {
            var d = station.lastReadingTime;
            var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
            issuedText = months[d.getMonth()] + ' ' + d.getDate() + ', ' +
                         ((d.getHours() % 12) || 12) + ':' +
                         (d.getMinutes() < 10 ? '0' : '') + d.getMinutes() + ' ' +
                         (d.getHours() >= 12 ? 'PM' : 'AM');
        }
        document.getElementById('panel-issued').textContent = issuedText;

        // Thresholds
        var th = station.thresholds;
        document.getElementById('thresh-advisory').textContent = th.advisory != null ? th.advisory + ' m' : '\u2014';
        document.getElementById('thresh-watch').textContent    = th.watch != null    ? th.watch + ' m'    : '\u2014';
        document.getElementById('thresh-warning').textContent  = th.warning != null  ? th.warning + ' m'  : '\u2014';
        document.getElementById('thresh-flood').textContent    = th.flood != null    ? th.flood + ' m'    : '\u2014';
        document.getElementById('thresh-record').textContent   = th.record != null   ? th.record + ' m'   : '\u2014';

        // WSC link
        var wscLink = document.getElementById('panel-wsc-link');
        if (station.wscUrlEn && station.wscUrlEn !== 'NONE') {
            wscLink.href = station.wscUrlEn;
            wscLink.style.display = '';
        } else {
            wscLink.style.display = 'none';
        }

        // Chart
        FloodChart.show(station);
    }

    // -- Panel close --

    function setupPanelClose() {
        document.getElementById('panel-close').addEventListener('click', closePanel);
    }

    function closePanel() {
        var panel = document.getElementById('station-panel');
        panel.classList.add('hidden');
        panel.setAttribute('aria-hidden', 'true');
        FloodChart.destroy();
        FloodMap.highlightStation(null);
        if (window.location.hash) history.replaceState(null, '', window.location.pathname);
    }

    // -- Left controls --

    function setupLeftControls() {
        document.getElementById('btn-reset').addEventListener('click', function () {
            FloodMap.resetView();
        });
        document.getElementById('btn-zoom-in').addEventListener('click', function () {
            FloodMap.zoomIn();
        });
        document.getElementById('btn-zoom-out').addEventListener('click', function () {
            FloodMap.zoomOut();
        });
        document.getElementById('btn-layers').addEventListener('click', function () {
            toggleLayersPanel();
        });
        document.getElementById('btn-locate').addEventListener('click', function () {
            if ('geolocation' in navigator) {
                navigator.geolocation.getCurrentPosition(function (pos) {
                    var map = FloodMap.getMap();
                    if (map) map.flyTo([pos.coords.latitude, pos.coords.longitude], 11, { duration: 0.8 });
                }, function () {
                    FloodUtils.showToast('Location not available', 3000);
                });
            }
        });
    }

    // -- Legend panel --

    function setupLegendPanel() {
        document.getElementById('legend-close').addEventListener('click', function () {
            toggleLegendPanel(false);
        });

        // Collapsible sections in stations panel
        setupCollapsible('toggle-stations', 'station-section');
    }

    function setupLayersPanel() {
        document.getElementById('layers-close').addEventListener('click', function () {
            toggleLayersPanel(false);
        });

        // Collapsible sections in layers panel
        setupCollapsible('toggle-basemap', 'basemap-section');
        setupCollapsible('toggle-flood-layers', 'flood-layers-section');
    }

    function toggleLegendPanel(forceState) {
        var panel = document.getElementById('legend-panel');
        if (typeof forceState === 'boolean') {
            panel.classList.toggle('hidden', !forceState);
        } else {
            panel.classList.toggle('hidden');
        }
        // Close layers panel when opening stations
        if (!panel.classList.contains('hidden')) {
            document.getElementById('layers-panel').classList.add('hidden');
        }
    }

    function toggleLayersPanel(forceState) {
        var panel = document.getElementById('layers-panel');
        if (typeof forceState === 'boolean') {
            panel.classList.toggle('hidden', !forceState);
        } else {
            panel.classList.toggle('hidden');
        }
        // Close stations panel when opening layers
        if (!panel.classList.contains('hidden')) {
            document.getElementById('legend-panel').classList.add('hidden');
        }
    }

    function setupCollapsible(headerId, sectionId) {
        var header = document.getElementById(headerId);
        var section = document.getElementById(sectionId);
        if (!header || !section) return;
        header.addEventListener('click', function () {
            header.classList.toggle('collapsed');
            section.classList.toggle('collapsed-content');
        });
    }

    // -- Overlay toggles --

    function setupOverlayToggles() {
        // Individual flood extent layer toggles
        var floodCheckboxes = document.querySelectorAll('[data-layer]');
        floodCheckboxes.forEach(function (chk) {
            chk.addEventListener('change', function () {
                FloodMap.toggleOverlay(chk.getAttribute('data-layer'), chk.checked);
            });
        });

        // Show/hide no-data stations toggle
        var chkNoData = document.getElementById('chk-nodata');
        if (chkNoData) {
            chkNoData.addEventListener('change', function () {
                FloodMap.setShowNoData(chkNoData.checked);
                FloodList.setShowNoData(chkNoData.checked);
            });
        }
    }

    // -- Basemap radios --

    function setupBasemapRadios() {
        var radios = document.querySelectorAll('input[name="basemap"]');
        radios.forEach(function (radio) {
            radio.addEventListener('change', function () {
                FloodMap.switchBasemap(radio.value);
            });
        });
    }

    // -- Bottom bar --

    function setupBottomBar() {
        document.getElementById('bb-stations').addEventListener('click', function () {
            toggleLegendPanel();
        });
        document.getElementById('bb-summary').addEventListener('click', function () {
            showSummary();
            toggleModal('summary-modal', true);
        });
        document.getElementById('bb-help').addEventListener('click', function () {
            toggleModal('help-modal', true);
        });
    }

    // -- Modals --

    function setupModals() {
        // Close buttons
        document.querySelectorAll('.modal-close').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var id = btn.getAttribute('data-close');
                if (id) toggleModal(id, false);
            });
        });

        // Click overlay to close
        document.querySelectorAll('.modal-overlay').forEach(function (overlay) {
            overlay.addEventListener('click', function (e) {
                if (e.target === overlay) overlay.classList.add('hidden');
            });
        });
    }

    function toggleModal(id, show) {
        var el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('hidden', !show);
    }

    // -- Summary --

    function showSummary() {
        var body = document.getElementById('summary-body');
        if (!allStations.length) {
            body.innerHTML = '<p>No station data loaded.</p>';
            return;
        }

        var counts = FloodAlerts.countAlerts(allStations);
        var colors = FloodMap.COLORS;

        var html = '<table class="summary-table"><thead><tr><th>Status</th><th>Count</th></tr></thead><tbody>';
        var levels = ['flood', 'warning', 'watch', 'advisory', 'normal', 'nodata'];
        levels.forEach(function (lvl) {
            html += '<tr><td><span class="status-dot" style="background:' + colors[lvl] + '"></span>' +
                FloodAlerts.alertLabel(lvl) + '</td><td>' + (counts[lvl] || 0) + '</td></tr>';
        });
        html += '</tbody></table>';

        // List stations with active alerts
        var alertStations = allStations.filter(function (s) {
            return s.alertLevel !== 'normal' && s.alertLevel !== 'nodata';
        }).sort(function (a, b) {
            return FloodAlerts.alertPriority(b.alertLevel) - FloodAlerts.alertPriority(a.alertLevel);
        });

        if (alertStations.length > 0) {
            html += '<h4 style="margin:12px 0 6px;font-size:13px;">Active Alerts</h4><ul style="list-style:none;padding:0;">';
            alertStations.forEach(function (s) {
                html += '<li style="padding:4px 0;font-size:12px;">' +
                    '<span class="status-dot" style="background:' + colors[s.alertLevel] + '"></span> ' +
                    '<strong>' + s.name + '</strong> \u2014 ' + FloodAlerts.alertLabel(s.alertLevel);
                if (s.currentLevel != null) html += ' (' + FloodUtils.round(s.currentLevel, 2) + ' m)';
                html += '</li>';
            });
            html += '</ul>';
        } else {
            html += '<p style="margin-top:10px;font-size:13px;">No active flood alerts.</p>';
        }

        body.innerHTML = html;
    }

    // -- Keyboard nav --

    function setupKeyboardNav() {
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') {
                // Close modals first, then panel
                var openModal = document.querySelector('.modal-overlay:not(.hidden)');
                if (openModal) { openModal.classList.add('hidden'); return; }
                closePanel();
                return;
            }
            var panel = document.getElementById('station-panel');
            if (panel && !panel.classList.contains('hidden')) {
                if (e.key === 'ArrowLeft')  { e.preventDefault(); FloodList.selectByOffset(-1); }
                if (e.key === 'ArrowRight') { e.preventDefault(); FloodList.selectByOffset(1); }
            }
        });
    }

})();
