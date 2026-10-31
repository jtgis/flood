/* ==========================================================================
   app.js - Main entry point (glassmorphism layout wiring)
   ========================================================================== */

(function () {
    'use strict';

    let allStations = [];

    document.addEventListener('DOMContentLoaded', () => {
        FloodMap.init();
        FloodChart.init();
        FloodList.init(onStationSelect);

        setupSplashScreen();
        setupLeftControls();
        setupStationListPanel();
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
        const splash = document.getElementById('splash-screen');
        if (!splash) return;
        document.getElementById('splash-enter').addEventListener('click', () => {
            splash.classList.add('hidden');
            setTimeout(() => splash.remove(), 500);   // after the fade-out
        });
    }

    // -- Data loading --

    async function loadData() {
        let result;
        try {
            result = await FloodData.loadAll();
        } catch (err) {
            console.error('Failed to load data:', err);
            FloodUtils.showToast('Failed to load station data. Check console.', 8000);
            return;
        }
        allStations = result.stations;

        // Show the FEWS export date at the bottom of the station list panel
        if (result.creationDate) {
            const tsEl = document.getElementById('data-timestamp');
            if (tsEl) tsEl.textContent = `Data: ${result.creationDate}`;
        }

        // Populate map, list and legend counts
        FloodMap.setStations(allStations, onStationSelect);
        FloodList.setStations(allStations);
        FloodList.updateLegend(allStations);

        // Open a station straight away if the link has one, e.g.
        // index.html#station/01AK003 (onStationSelect sets this hash)
        const hash = window.location.hash;
        if (hash.startsWith('#station/')) {
            const id = decodeURIComponent(hash.slice('#station/'.length));
            const found = allStations.find(s => s.stationID === id || s.name === id);
            if (found) onStationSelect(found);
        }
    }

    // -- Station select --

    // Called when a station is picked from the map, the list, the arrow keys
    // or a #station/ link: highlights it everywhere and opens its panel.
    function onStationSelect(station) {
        window.location.hash = `station/${encodeURIComponent(station.stationID)}`;

        FloodMap.flyTo(station);
        FloodMap.highlightStation(station.stationID);
        FloodList.setSelected(station.stationID);

        // Open station panel
        const panel = document.getElementById('station-panel');
        panel.classList.remove('hidden');
        panel.setAttribute('aria-hidden', 'false');

        // Name + badge
        document.getElementById('panel-station-name').textContent = station.name;
        const badge = document.getElementById('panel-alert-badge');
        badge.className = `sp-badge ${station.alertLevel}`;
        badge.textContent = FloodAlerts.alertLabel(station.alertLevel);

        // Meta
        document.getElementById('panel-current-level').textContent =
            station.currentLevel != null ? `${FloodUtils.round(station.currentLevel, 2)} m` : '—';

        // e.g. "↑ Rising (0.05 m/hr)" or "→ Stable" (no rate shown when stable)
        const trend = station.trend || { direction: 'stable', rate: 0 };
        const direction = trend.direction.charAt(0).toUpperCase() + trend.direction.slice(1);
        const rateText = trend.direction !== 'stable' ? ` (${trend.rate} m/hr)` : '';
        document.getElementById('panel-trend').textContent =
            `${FloodUtils.trendArrow(trend.direction)} ${direction}${rateText}`;

        // Last reading time in the viewer's time zone, e.g. "Oct 23, 9:05 PM"
        let issuedText = '—';
        if (station.lastReadingTime) {
            issuedText = station.lastReadingTime.toLocaleString('en-US', {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
            });
        }
        document.getElementById('panel-issued').textContent = issuedText;

        // Thresholds: fills #thresh-advisory, #thresh-watch, ... (a dash if missing)
        FloodAlerts.THRESHOLD_LEVELS.forEach(level => {
            const value = station.thresholds[level];
            document.getElementById(`thresh-${level}`).textContent = value != null ? `${value} m` : '—';
        });

        // WSC link
        const wscLink = document.getElementById('panel-wsc-link');
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
        const panel = document.getElementById('station-panel');
        panel.classList.add('hidden');
        panel.setAttribute('aria-hidden', 'true');
        FloodChart.destroy();
        FloodMap.highlightStation(null);
        FloodList.setSelected(null);
        if (window.location.hash) history.replaceState(null, '', window.location.pathname);
    }

    // -- Left controls --

    function setupLeftControls() {
        document.getElementById('btn-reset').addEventListener('click', () => FloodMap.resetView());
        document.getElementById('btn-zoom-in').addEventListener('click', () => FloodMap.zoomIn());
        document.getElementById('btn-zoom-out').addEventListener('click', () => FloodMap.zoomOut());
        document.getElementById('btn-layers').addEventListener('click', () => togglePanel('layers-panel'));
        document.getElementById('btn-locate').addEventListener('click', () => {
            if (!('geolocation' in navigator)) return;
            navigator.geolocation.getCurrentPosition(
                pos => {
                    const map = FloodMap.getMap();
                    if (map) map.flyTo([pos.coords.latitude, pos.coords.longitude], 11, { duration: 0.8 });
                },
                () => FloodUtils.showToast('Location not available', 3000)
            );
        });
    }

    // -- Side panels (station list and layers) --

    function setupStationListPanel() {
        document.getElementById('station-list-close').addEventListener('click', () => {
            togglePanel('station-list-panel', false);
        });

        // Collapsible sections in station list panel
        setupCollapsible('toggle-stations', 'station-section');
    }

    function setupLayersPanel() {
        document.getElementById('layers-close').addEventListener('click', () => {
            togglePanel('layers-panel', false);
        });

        // Collapsible sections in layers panel
        setupCollapsible('toggle-basemap', 'basemap-section');
        setupCollapsible('toggle-flood-layers', 'flood-layers-section');
    }

    /**
     * Open or close one of the two side panels. Only one can be open at a
     * time, so opening one closes the other.
     *   panelId: 'station-list-panel' or 'layers-panel'
     *   open:    true to open, false to close, or leave out to flip it
     */
    function togglePanel(panelId, open) {
        const panel = document.getElementById(panelId);
        if (typeof open === 'boolean') {
            panel.classList.toggle('hidden', !open);
        } else {
            panel.classList.toggle('hidden');
        }

        if (!panel.classList.contains('hidden')) {
            const otherId = panelId === 'layers-panel' ? 'station-list-panel' : 'layers-panel';
            document.getElementById(otherId).classList.add('hidden');
        }
    }

    function setupCollapsible(headerId, sectionId) {
        const header = document.getElementById(headerId);
        const section = document.getElementById(sectionId);
        if (!header || !section) return;
        header.addEventListener('click', () => {
            header.classList.toggle('collapsed');
            section.classList.toggle('collapsed-content');
        });
    }

    // -- Overlay toggles --

    function setupOverlayToggles() {
        // Individual flood extent layer toggles
        document.querySelectorAll('[data-layer]').forEach(chk => {
            chk.addEventListener('change', () => {
                FloodMap.toggleOverlay(chk.getAttribute('data-layer'), chk.checked);
            });
        });

        // Show/hide no-data stations toggle
        const chkNoData = document.getElementById('chk-nodata');
        if (chkNoData) {
            chkNoData.addEventListener('change', () => {
                FloodMap.setShowNoData(chkNoData.checked);
                FloodList.setShowNoData(chkNoData.checked);
            });
        }
    }

    // -- Basemap radios --

    function setupBasemapRadios() {
        document.querySelectorAll('input[name="basemap"]').forEach(radio => {
            radio.addEventListener('change', () => FloodMap.switchBasemap(radio.value));
        });
    }

    // -- Bottom bar --

    function setupBottomBar() {
        document.getElementById('bb-stations').addEventListener('click', () => {
            togglePanel('station-list-panel');
        });
        document.getElementById('bb-summary').addEventListener('click', () => {
            showSummary();
            toggleModal('summary-modal', true);
        });
        document.getElementById('bb-help').addEventListener('click', () => {
            toggleModal('help-modal', true);
        });
    }

    // -- Modals --

    function setupModals() {
        // Close buttons
        document.querySelectorAll('.modal-close').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.getAttribute('data-close');
                if (id) toggleModal(id, false);
            });
        });

        // Click the dark area around a modal to close it
        document.querySelectorAll('.modal-overlay').forEach(overlay => {
            overlay.addEventListener('click', e => {
                if (e.target === overlay) overlay.classList.add('hidden');
            });
        });
    }

    function toggleModal(id, show) {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.toggle('hidden', !show);
    }

    // -- Summary --

    // Fill the summary modal: a count per alert level, then the stations
    // that currently have an alert, most severe first.
    function showSummary() {
        const body = document.getElementById('summary-body');
        if (!allStations.length) {
            body.innerHTML = '<p>No station data loaded.</p>';
            return;
        }

        const counts = FloodAlerts.countAlerts(allStations);
        const colors = FloodAlerts.COLORS;
        const dot = level => `<span class="status-dot" style="background:${colors[level]}"></span>`;

        const rows = ['flood', 'warning', 'watch', 'advisory', 'normal', 'nodata'].map(level => `
            <tr><td>${dot(level)}${FloodAlerts.alertLabel(level)}</td><td>${counts[level] || 0}</td></tr>`);

        let html = `
            <table class="summary-table">
                <thead><tr><th>Status</th><th>Count</th></tr></thead>
                <tbody>${rows.join('')}</tbody>
            </table>`;

        const alertStations = allStations
            .filter(s => s.alertLevel !== 'normal' && s.alertLevel !== 'nodata')
            .sort((a, b) => FloodAlerts.alertPriority(b.alertLevel) - FloodAlerts.alertPriority(a.alertLevel));

        if (alertStations.length > 0) {
            const items = alertStations.map(s => {
                const levelText = s.currentLevel != null ? ` (${FloodUtils.round(s.currentLevel, 2)} m)` : '';
                return `<li>${dot(s.alertLevel)} <strong>${FloodUtils.escapeHtml(s.name)}</strong> — ${FloodAlerts.alertLabel(s.alertLevel)}${levelText}</li>`;
            });
            html += `<h4 class="summary-alerts-title">Active Alerts</h4><ul class="summary-alert-list">${items.join('')}</ul>`;
        } else {
            html += '<p class="summary-empty">No active flood alerts.</p>';
        }

        body.innerHTML = html;
    }

    // -- Keyboard nav --

    /**
     * Escape:      close an open modal, otherwise close the station panel.
     * Left/Right:  while the station panel is open, show the previous/next
     *              station in the list.
     */
    function setupKeyboardNav() {
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') {
                const openModal = document.querySelector('.modal-overlay:not(.hidden)');
                if (openModal) {
                    openModal.classList.add('hidden');
                } else {
                    closePanel();
                }
                return;
            }

            const panel = document.getElementById('station-panel');
            if (!panel || panel.classList.contains('hidden')) return;
            if (e.key === 'ArrowLeft')  { e.preventDefault(); FloodList.selectByOffset(-1); }
            if (e.key === 'ArrowRight') { e.preventDefault(); FloodList.selectByOffset(1); }
        });
    }

})();
