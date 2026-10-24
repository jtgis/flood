/* ==========================================================================
   list.js - Station list (inside toggled legend panel)
   ========================================================================== */

var FloodList = (function () {
    'use strict';

    var listEl = null;
    var stations = [];
    var currentSort = 'location';
    var onSelect = null;
    var selectedId = null;
    var showNoData = false;

    function init(selectCallback) {
        listEl = document.getElementById('station-list');
        onSelect = selectCallback;

        // Sort buttons (inside legend panel)
        var sortBtns = document.querySelectorAll('.sort-btn');
        sortBtns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                sortBtns.forEach(function (b) { b.classList.remove('active'); });
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
        var filtered = stations.filter(function (s) {
            return showNoData || s.alertLevel !== 'nodata';
        });
        return filtered.sort(sortFn);
    }

    function render() {
        if (!listEl) return;

        listEl.innerHTML = '';
        visibleStations().forEach(function (station) {
            var li = document.createElement('li');
            li.className = 'station-item ' + station.alertLevel;
            if (station.stationID === selectedId) li.classList.add('selected');
            li.setAttribute('data-id', station.stationID);
            li.setAttribute('tabindex', '0');
            li.setAttribute('role', 'button');

            var levelText = station.currentLevel != null
                ? FloodUtils.round(station.currentLevel, 2) + ' m'
                : '\u2014';

            var dotColor = FloodMap.COLORS[station.alertLevel] || FloodMap.COLORS.nodata;

            li.innerHTML =
                '<span class="station-dot" style="background:' + dotColor + '"></span>' +
                '<span class="station-name" title="' + station.name + '">' + station.name + '</span>' +
                '<span class="station-level">' + levelText + '</span>' +
                '<span class="station-trend">' + FloodUtils.trendArrow(station.trend.direction) + '</span>';

            li.addEventListener('click', function () { selectStation(station); });
            li.addEventListener('keydown', function (e) {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectStation(station); }
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
        listEl.querySelectorAll('.station-item').forEach(function (item) {
            item.classList.toggle('selected', item.getAttribute('data-id') === selectedId);
        });
    }

    function sortFn(a, b) {
        switch (currentSort) {
            case 'name':
                return a.name.localeCompare(b.name);
            case 'risk':
                var pa = FloodAlerts.alertPriority(a.alertLevel);
                var pb = FloodAlerts.alertPriority(b.alertLevel);
                if (pa !== pb) return pb - pa;
                return a.name.localeCompare(b.name);
            case 'location':
            default:
                return 0;
        }
    }

    function updateLegend(stations) {
        var counts = FloodAlerts.countAlerts(stations);
        var el;
        el = document.getElementById('count-normal');   if (el) el.textContent = counts.normal;
        el = document.getElementById('count-advisory'); if (el) el.textContent = counts.advisory;
        el = document.getElementById('count-watch');    if (el) el.textContent = counts.watch;
        el = document.getElementById('count-warning');  if (el) el.textContent = counts.warning;
        el = document.getElementById('count-flood');    if (el) el.textContent = counts.flood;
        el = document.getElementById('count-nodata');   if (el) el.textContent = counts.nodata;
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
        var visible = visibleStations();
        if (!visible.length) return;

        var curIdx = visible.findIndex(function (s) { return s.stationID === selectedId; });
        var newIdx = curIdx + offset;
        if (newIdx < 0) newIdx = visible.length - 1;
        if (newIdx >= visible.length) newIdx = 0;
        selectStation(visible[newIdx]);
    }

    return {
        init: init,
        setStations: setStations,
        setSelected: setSelected,
        updateLegend: updateLegend,
        selectByOffset: selectByOffset,
        setShowNoData: setShowNoData
    };
})();
