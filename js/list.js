/* ==========================================================================
   list.js - Station list (inside the toggled station list panel)
   ========================================================================== */

const FloodList = (function () {
    'use strict';

    let listEl = null;
    let stations = [];
    let currentSort = 'location';
    let onSelect = null;
    let selectedId = null;
    let showNoData = false;

    function init(selectCallback) {
        listEl = document.getElementById('station-list');
        onSelect = selectCallback;

        // Sort buttons (inside the station list panel)
        const sortBtns = document.querySelectorAll('.sort-btn');
        sortBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                sortBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                currentSort = btn.getAttribute('data-sort');
                render();
            });
        });
    }

    function setStations(stationData) {
        stations = stationData;
        render();
    }

    /**
     * The stations currently shown in the list, in display order.
     * No-data stations are left out unless the "Show No-Data" box is ticked.
     */
    function visibleStations() {
        return stations
            .filter(s => showNoData || s.alertLevel !== 'nodata')
            .sort(sortFn);
    }

    function render() {
        if (!listEl) return;

        listEl.innerHTML = '';
        visibleStations().forEach(station => {
            const li = document.createElement('li');
            li.className = `station-item ${station.alertLevel}`;
            if (station.stationID === selectedId) li.classList.add('selected');
            li.setAttribute('data-id', station.stationID);
            li.setAttribute('tabindex', '0');
            li.setAttribute('role', 'button');

            const levelText = station.currentLevel != null
                ? `${FloodUtils.round(station.currentLevel, 2)} m`
                : '—';
            const dotColor = FloodAlerts.COLORS[station.alertLevel] || FloodAlerts.COLORS.nodata;
            const safeName = FloodUtils.escapeHtml(station.name);

            li.innerHTML = `
                <span class="station-dot" style="background:${dotColor}"></span>
                <span class="station-name" title="${safeName}">${safeName}</span>
                <span class="station-level">${levelText}</span>
                <span class="station-trend">${FloodUtils.trendArrow(station.trend.direction)}</span>`;

            li.addEventListener('click', () => selectStation(station));
            li.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectStation(station);
                }
            });

            listEl.appendChild(li);
        });
    }

    // Clicking a list item hands the station to app.js, which opens the
    // panel and calls setSelected() so the list and map stay in sync.
    function selectStation(station) {
        if (typeof onSelect === 'function') onSelect(station);
    }

    /**
     * Highlight a station in the list (or clear it with null).
     * Called by app.js whenever a station is picked, from the list or the map.
     */
    function setSelected(stationID) {
        selectedId = stationID;
        if (!listEl) return;
        listEl.querySelectorAll('.station-item').forEach(item => {
            item.classList.toggle('selected', item.getAttribute('data-id') === selectedId);
        });
    }

    /**
     * Compare two stations for the list's current sort order:
     *   'location' - keep the order of the GeoNB feed, which runs down the
     *                Saint John River from upstream (Connors) to Saint John
     *   'name'     - A to Z
     *   'risk'     - most severe alert first, then A to Z
     */
    function sortFn(a, b) {
        if (currentSort === 'name') {
            return a.name.localeCompare(b.name);
        }
        if (currentSort === 'risk') {
            const severityDiff = FloodAlerts.alertPriority(b.alertLevel) - FloodAlerts.alertPriority(a.alertLevel);
            return severityDiff !== 0 ? severityDiff : a.name.localeCompare(b.name);
        }
        return 0;   // 'location': keep the feed order
    }

    function updateLegend(stations) {
        // counts looks like { normal: 11, advisory: 0, ... }; each goes in #count-<level>
        const counts = FloodAlerts.countAlerts(stations);
        Object.keys(counts).forEach(level => {
            const el = document.getElementById(`count-${level}`);
            if (el) el.textContent = counts[level];
        });
    }

    function setShowNoData(val) {
        showNoData = val;
        render();
    }

    /**
     * Move to the next (+1) or previous (-1) station in the visible list,
     * wrapping around at either end. Used by the left/right arrow keys.
     */
    function selectByOffset(offset) {
        const visible = visibleStations();
        if (!visible.length) return;

        const curIdx = visible.findIndex(s => s.stationID === selectedId);
        let newIdx = curIdx + offset;
        if (newIdx < 0) newIdx = visible.length - 1;
        if (newIdx >= visible.length) newIdx = 0;
        selectStation(visible[newIdx]);
    }

    return { init, setStations, setSelected, updateLegend, selectByOffset, setShowNoData };
})();
