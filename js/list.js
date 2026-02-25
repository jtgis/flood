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

    function render() {
        if (!listEl) return;
        var filtered = showNoData ? stations.slice() : stations.filter(function (s) { return s.alertLevel !== 'nodata'; });
        var sorted = filtered.sort(sortFn);

        listEl.innerHTML = '';
        sorted.forEach(function (station) {
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

    function selectStation(station) {
        selectedId = station.stationID;
        var items = listEl.querySelectorAll('.station-item');
        items.forEach(function (item) {
            item.classList.toggle('selected', item.getAttribute('data-id') === selectedId);
        });
        if (typeof onSelect === 'function') onSelect(station);
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

    function selectByOffset(offset) {
        if (!stations.length) return;
        var sorted = stations.slice().sort(sortFn);
        var curIdx = -1;
        for (var i = 0; i < sorted.length; i++) {
            if (sorted[i].stationID === selectedId) { curIdx = i; break; }
        }
        var newIdx = curIdx + offset;
        if (newIdx < 0) newIdx = sorted.length - 1;
        if (newIdx >= sorted.length) newIdx = 0;
        selectStation(sorted[newIdx]);
    }

    return {
        init: init,
        setStations: setStations,
        updateLegend: updateLegend,
        selectByOffset: selectByOffset,
        setShowNoData: setShowNoData
    };
})();
