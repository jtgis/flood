/* ==========================================================================
   chart.js — Original water-level chart for nbflood
   ─────────────────────────────────────────────────────────────────────────
   Key design features (completely custom):
     • Zone-colored line: segment color shifts through blue → green →
       yellow → orange → red as readings cross threshold zones
     • Zone-tinted gradient fill under the line (custom canvas plugin)
     • Horizontal gauge bar in the panel showing current level position
     • Small threshold tick marks on the right chart edge with faint
       hint lines instead of full horizontal annotations
     • Custom "NOW" badge & crosshair plugins
     • WSC data rendered as dotted line with visible dot markers
     • White-themed tooltip matching the panel style
   ========================================================================== */

var FloodChart = (function () {
    'use strict';

    var chart = null;
    var canvasEl = null;
    var wrapEl = null;
    var overlayEl = null;

    /* ── plugin state (set before chart creation so first render is correct) ── */
    var _pluginThresholds    = null;
    var _pluginMeasuredIndex = null;
    var _pluginWscIndex      = null;
    var _pluginNowTime       = null;
    var _pluginCurrentLevel  = null;

    /* ── colour palette ── */

    var COLORS = {
        normal:   '#2563eb',
        advisory: '#22c55e',
        watch:    '#facc15',
        warning:  '#fb923c',
        flood:    '#ef4444',
        record:   '#7c3aed'
    };

    var FILLS = {
        normal:   'rgba(37,99,235,0.18)',
        advisory: 'rgba(34,197,94,0.18)',
        watch:    'rgba(250,204,21,0.18)',
        warning:  'rgba(251,146,60,0.18)',
        flood:    'rgba(239,68,68,0.18)'
    };

    var FORECAST_COLOR = '#8b5cf6';
    var WSC_COLOR      = '#0e7490';

    var WINDOW_HOURS_BACK    = 48;
    var WINDOW_HOURS_FORWARD = 48;

    /* ── helpers ── */

    function getZone(y, th) {
        if (th.flood    != null && y >= th.flood)    return 'flood';
        if (th.warning  != null && y >= th.warning)  return 'warning';
        if (th.watch    != null && y >= th.watch)    return 'watch';
        if (th.advisory != null && y >= th.advisory) return 'advisory';
        return 'normal';
    }

    function hexToRgba(hex, a) {
        var r = parseInt(hex.slice(1, 3), 16);
        var g = parseInt(hex.slice(3, 5), 16);
        var b = parseInt(hex.slice(5, 7), 16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')';
    }

    /* ================================================================
       Custom Chart.js Plugins
       ================================================================ */

    /* ── 1. Zone-coloured gradient fill beneath the measured line ── */

    var zoneFillPlugin = {
        id: 'zoneFill',
        beforeDatasetsDraw: function (ci) {
            var th = _pluginThresholds;
            if (!th) return;

            var ctx  = ci.ctx;
            var area = ci.chartArea;

            ctx.save();
            ctx.beginPath();
            ctx.rect(area.left, area.top, area.right - area.left, area.bottom - area.top);
            ctx.clip();

            /* Draw WSC fill first (lower priority — observed will paint on top) */
            var wi = _pluginWscIndex;
            if (wi != null) {
                var wscMeta = ci.getDatasetMeta(wi);
                if (wscMeta && !wscMeta.hidden && wscMeta.data && wscMeta.data.length >= 2) {
                    var wscRaw = ci.data.datasets[wi].data;
                    for (var j = 0; j < wscMeta.data.length - 1; j++) {
                        var w0 = wscMeta.data[j];
                        var w1 = wscMeta.data[j + 1];
                        if (w0.skip || w1.skip) continue;
                        var avgWY = (wscRaw[j].y + wscRaw[j + 1].y) / 2;
                        var wscZone = getZone(avgWY, th);
                        ctx.beginPath();
                        ctx.moveTo(w0.x - 0.5, w0.y);
                        ctx.lineTo(w1.x + 0.5, w1.y);
                        ctx.lineTo(w1.x + 0.5, area.bottom);
                        ctx.lineTo(w0.x - 0.5, area.bottom);
                        ctx.closePath();
                        ctx.fillStyle = FILLS[wscZone];
                        ctx.fill();
                    }
                }
            }

            /* Draw observed fill on top (higher priority) */
            var mi = _pluginMeasuredIndex;
            if (mi != null) {
                var meta = ci.getDatasetMeta(mi);
                if (meta && !meta.hidden && meta.data && meta.data.length >= 2) {
                    var raw = ci.data.datasets[mi].data;
                    for (var i = 0; i < meta.data.length - 1; i++) {
                        var p0 = meta.data[i];
                        var p1 = meta.data[i + 1];
                        if (p0.skip || p1.skip) continue;
                        var avgY = (raw[i].y + raw[i + 1].y) / 2;
                        var zone = getZone(avgY, th);
                        ctx.beginPath();
                        ctx.moveTo(p0.x - 0.5, p0.y);
                        ctx.lineTo(p1.x + 0.5, p1.y);
                        ctx.lineTo(p1.x + 0.5, area.bottom);
                        ctx.lineTo(p0.x - 0.5, area.bottom);
                        ctx.closePath();
                        ctx.fillStyle = FILLS[zone];
                        ctx.fill();
                    }
                }
            }

            ctx.restore();
        }
    };

    /* ── 2. Crosshair (vertical tracking line on hover) ── */

    var crosshairPlugin = {
        id: 'crosshair',
        afterEvent: function (ci, args) {
            var e = args.event;
            if (e.type === 'mousemove') {
                ci._crossX = e.x;
                ci._showCross = true;
            }
            if (e.type === 'mouseout') ci._showCross = false;
        },
        afterDraw: function (ci) {
            if (!ci._showCross) return;
            var x = ci._crossX;
            var a = ci.chartArea;
            if (x < a.left || x > a.right) return;

            var ctx = ci.ctx;
            ctx.save();
            ctx.beginPath();
            ctx.setLineDash([3, 4]);
            ctx.lineWidth   = 1;
            ctx.strokeStyle = 'rgba(0,0,0,0.10)';
            ctx.moveTo(x, a.top);
            ctx.lineTo(x, a.bottom);
            ctx.stroke();
            ctx.restore();
        }
    };

    /* ── 3. "NOW" vertical line + badge ── */

    var nowLinePlugin = {
        id: 'nowLine',
        afterDraw: function (ci) {
            var now = _pluginNowTime;
            if (!now) return;
            var a = ci.chartArea;
            var x = ci.scales.x.getPixelForValue(now);
            // Clamp to chart area so NOW is always visible
            x = Math.max(a.left + 1, Math.min(a.right - 1, x));

            var ctx = ci.ctx;
            ctx.save();

            // faint dashed vertical line
            ctx.beginPath();
            ctx.setLineDash([2, 4]);
            ctx.lineWidth   = 1;
            ctx.strokeStyle = 'rgba(15,23,42,0.14)';
            ctx.moveTo(x, a.top);
            ctx.lineTo(x, a.bottom);
            ctx.stroke();

            // "NOW" badge at top of chart area
            ctx.setLineDash([]);
            ctx.font = '700 10px Inter, sans-serif';
            var text = 'NOW';
            var tw = ctx.measureText(text).width;
            var bw = tw + 10, bh = 15;
            var bx = x - bw / 2, by = a.top + 6;
            var r  = 4;

            ctx.fillStyle = '#0f172a';
            ctx.beginPath();
            ctx.moveTo(bx + r, by);
            ctx.arcTo(bx + bw, by, bx + bw, by + bh, r);
            ctx.arcTo(bx + bw, by + bh, bx, by + bh, r);
            ctx.arcTo(bx, by + bh, bx, by, r);
            ctx.arcTo(bx, by, bx + bw, by, r);
            ctx.closePath();
            ctx.fill();

            ctx.fillStyle    = '#ffffff';
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, x, by + bh / 2);

            ctx.restore();
        }
    };

    /* ── 4. Vertical zone bar on the right edge (replaces text threshold labels) ── */

    var thresholdTickPlugin = {
        id: 'thresholdTicks',
        afterDraw: function (ci) {
            var th = _pluginThresholds;
            if (!th) return;
            var a      = ci.chartArea;
            var yScale = ci.scales.y;
            var ctx    = ci.ctx;

            var BAR_X = a.right + 5;
            var BAR_W = 10;

            var defs = [
                { key: 'advisory', color: COLORS.advisory },
                { key: 'watch',    color: COLORS.watch },
                { key: 'warning',  color: COLORS.warning },
                { key: 'flood',    color: COLORS.flood },
                { key: 'record',   color: COLORS.record }
            ];

            ctx.save();

            // faint dotted threshold hint lines across the chart
            defs.forEach(function (d) {
                var val = th[d.key];
                if (val == null) return;
                var y = yScale.getPixelForValue(val);
                if (y < a.top || y > a.bottom) return;
                ctx.beginPath();
                ctx.strokeStyle = hexToRgba(d.color, 0.14);
                ctx.lineWidth   = 1;
                ctx.setLineDash([2, 6]);
                ctx.moveTo(a.left, y);
                ctx.lineTo(a.right, y);
                ctx.stroke();
            });
            ctx.setLineDash([]);

            // vertical zone bar: build zone stack from yMin upward
            var zoneStack = [{ val: yScale.min, color: COLORS.normal }];
            defs.forEach(function (d) {
                if (th[d.key] != null) zoneStack.push({ val: th[d.key], color: d.color });
            });

            for (var i = 0; i < zoneStack.length; i++) {
                var fromVal = zoneStack[i].val;
                var toVal   = i + 1 < zoneStack.length ? zoneStack[i + 1].val : yScale.max;
                var fromY   = Math.min(a.bottom, Math.max(a.top, yScale.getPixelForValue(fromVal)));
                var toY     = Math.min(a.bottom, Math.max(a.top, yScale.getPixelForValue(toVal)));
                if (fromY <= toY) continue;
                ctx.fillStyle = zoneStack[i].color;
                ctx.fillRect(BAR_X, toY, BAR_W, fromY - toY);
            }

            // current-level marker on the bar
            var level = _pluginCurrentLevel;
            if (level != null) {
                var ly = yScale.getPixelForValue(level);
                if (ly >= a.top && ly <= a.bottom) {
                    ctx.beginPath();
                    ctx.arc(BAR_X + BAR_W / 2, ly, 5, 0, Math.PI * 2);
                    ctx.fillStyle   = '#ffffff';
                    ctx.fill();
                    ctx.strokeStyle = '#0f172a';
                    ctx.lineWidth   = 2;
                    ctx.stroke();
                }
            }

            ctx.restore();
        }
    };

    /* ================================================================
       Horizontal Level Gauge
       ================================================================ */

    function updateGauge(station) {
        var track  = document.getElementById('gauge-track');
        var marker = document.getElementById('gauge-marker');
        if (!track || !marker) return;

        var th    = station.thresholds;
        var level = station.currentLevel;

        // compute range from all relevant values
        var vals = [];
        if (level != null) vals.push(level);
        ['advisory', 'watch', 'warning', 'flood', 'record'].forEach(function (k) {
            if (th[k] != null) vals.push(th[k]);
        });
        if (station.measures) {
            station.measures.forEach(function (m) {
                if (m.wlvl != null) vals.push(m.wlvl);
            });
        }
        if (!vals.length) { marker.style.display = 'none'; return; }

        var lo  = Math.min.apply(null, vals);
        var hi  = Math.max.apply(null, vals);
        var pad = Math.max((hi - lo) * 0.12, 0.3);
        var rMin = lo - pad, rMax = hi + pad, total = rMax - rMin;

        // build ordered zone boundaries
        var boundaries = [{ val: rMin, color: COLORS.normal }];
        if (th.advisory != null) boundaries.push({ val: th.advisory, color: COLORS.advisory });
        if (th.watch    != null) boundaries.push({ val: th.watch,    color: COLORS.watch });
        if (th.warning  != null) boundaries.push({ val: th.warning,  color: COLORS.warning });
        if (th.flood    != null) boundaries.push({ val: th.flood,    color: COLORS.flood });
        boundaries.push({ val: rMax, color: null });

        track.innerHTML = '';
        for (var i = 0; i < boundaries.length - 1; i++) {
            var from = boundaries[i].val;
            var to   = boundaries[i + 1].val;
            var pct  = ((to - from) / total) * 100;
            if (pct <= 0) continue;
            var seg = document.createElement('div');
            seg.className    = 'sp-gauge-seg';
            seg.style.width  = pct + '%';
            seg.style.background = boundaries[i].color;
            track.appendChild(seg);
        }

        // position needle marker
        if (level != null) {
            var pos = ((level - rMin) / total) * 100;
            pos = Math.max(0, Math.min(100, pos));
            marker.style.left    = pos + '%';
            marker.style.display = '';
        } else {
            marker.style.display = 'none';
        }
    }

    /* ================================================================
       Init / Overlay
       ================================================================ */

    function init() {
        canvasEl = document.getElementById('station-chart');
        wrapEl   = canvasEl ? canvasEl.parentElement : null;
    }

    function ensureOverlay() {
        if (overlayEl) return;
        if (!wrapEl) return;
        overlayEl = document.createElement('div');
        overlayEl.className = 'chart-no-data';
        overlayEl.innerHTML = '<span>No current data available</span>';
        wrapEl.appendChild(overlayEl);
    }
    function showOverlay(vis) {
        ensureOverlay();
        if (overlayEl) overlayEl.style.display = vis ? 'flex' : 'none';
    }

    /* ================================================================
       Main show()
       ================================================================ */

    function show(station) {
        if (chart) { chart.destroy(); chart = null; }
        if (!canvasEl) return;

        var th  = station.thresholds;
        var now = new Date();
        var xMin = new Date(now.getTime() - WINDOW_HOURS_BACK    * 3600000);
        var xMax = new Date(now.getTime() + WINDOW_HOURS_FORWARD * 3600000);

        /* ── filter data to visible window ── */
        var measuredData = filterToWindow(station.measures, xMin, xMax);
        var wscData      = filterToWindow(station.wscMeasures || [], xMin, xMax);
        var forecastData = [];

        if (station.forecasts && station.forecasts.length) {
            var rawFC = filterToWindow(station.forecasts, xMin, xMax);
            if (measuredData.length && rawFC.length) {
                var last = measuredData[measuredData.length - 1];
                forecastData.push({ x: last.x, y: last.y });
            }
            forecastData = forecastData.concat(rawFC);
        }

        var hasData = measuredData.length > 0 || wscData.length > 0 || forecastData.length > 0;
        var isStale = station.isStale && measuredData.length === 0 && wscData.length === 0;
        showOverlay(isStale || !hasData);

        /* ── Y-axis range ── */
        var allY = [];
        measuredData.forEach(function (p) { allY.push(p.y); });
        forecastData.forEach(function (p) { allY.push(p.y); });
        wscData.forEach(function (p) { allY.push(p.y); });
        [th.advisory, th.watch, th.warning, th.flood, th.record].forEach(function (v) {
            if (v != null) allY.push(v);
        });

        var lo   = allY.length ? Math.min.apply(null, allY) : 0;
        var hi   = allY.length ? Math.max.apply(null, allY) : 10;
        var yPad = Math.max((hi - lo) * 0.05, 0.15);
        var yMin = Math.floor((lo - yPad) * 10) / 10;
        var yMax = Math.ceil ((hi + yPad) * 10) / 10;

        /* ── datasets ── */
        var datasets = [];
        var measuredIndex = null;
        var wscIndex = null;

        if (measuredData.length) {
            measuredIndex = datasets.length;
            datasets.push({
                label: 'Observed',
                data: measuredData,
                borderColor: COLORS.normal,
                borderWidth: 5,
                fill: false,
                pointRadius: 0,
                pointHoverRadius: 6,
                pointHoverBackgroundColor: '#fff',
                pointHoverBorderWidth: 2.5,
                pointHoverBorderColor: function (ctx) {
                    if (!ctx.raw) return COLORS.normal;
                    return COLORS[getZone(ctx.raw.y, th)];
                },
                pointHitRadius: 10,
                tension: 0.35,
                order: 1,
                segment: {
                    borderColor: function (ctx) {
                        if (!ctx.p1 || !ctx.p1.parsed) return COLORS.normal;
                        return COLORS[getZone(ctx.p1.parsed.y, th)];
                    }
                }
            });
        }

        if (wscData.length) {
            wscIndex = datasets.length;
            datasets.push({
                label: 'WSC Gauge',
                data: wscData,
                borderColor: COLORS.normal,
                borderWidth: 3,
                borderDash: [6, 3],
                fill: false,
                pointRadius: function (ctx) {
                    return ctx.dataIndex === ctx.dataset.data.length - 1 ? 5 : 0;
                },
                pointBackgroundColor: function (ctx) {
                    if (!ctx.raw) return COLORS.normal;
                    return COLORS[getZone(ctx.raw.y, th)];
                },
                pointBorderColor: function (ctx) {
                    if (!ctx.raw) return COLORS.normal;
                    return COLORS[getZone(ctx.raw.y, th)];
                },
                pointBorderWidth: 1,
                pointHoverRadius: 6,
                pointHitRadius: 10,
                tension: 0.3,
                spanGaps: true,
                order: 0,
                segment: {
                    borderColor: function (ctx) {
                        if (!ctx.p1 || !ctx.p1.parsed) return COLORS.normal;
                        return COLORS[getZone(ctx.p1.parsed.y, th)];
                    }
                }
            });
        }

        if (forecastData.length) {
            datasets.push({
                label: 'Forecast',
                data: forecastData,
                borderColor: FORECAST_COLOR,
                borderDash: [8, 5],
                borderWidth: 2.5,
                fill: false,
                pointRadius: 0,
                pointHoverRadius: 6,
                pointHoverBackgroundColor: FORECAST_COLOR,
                pointHitRadius: 10,
                tension: 0.3,
                order: 3
            });
        }

        /* ── update gauge bar ── */
        updateGauge(station);

        /* ── set plugin state before chart creation so first render is correct ── */
        _pluginThresholds    = th;
        _pluginNowTime       = now;
        _pluginMeasuredIndex = measuredIndex;
        _pluginWscIndex      = wscIndex;
        _pluginCurrentLevel  = station.currentLevel;

        /* ── create chart ── */
        chart = new Chart(canvasEl, {
            type: 'line',
            data: { datasets: datasets },
            plugins: [zoneFillPlugin, crosshairPlugin, nowLinePlugin, thresholdTickPlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                interaction: { mode: 'nearest', axis: 'x', intersect: false },
                layout: { padding: { top: 8, right: 22, bottom: 4, left: 4 } },
                scales: {
                    x: {
                        type: 'time',
                        min: xMin,
                        max: xMax,
                        time: {
                            unit: 'hour',
                            stepSize: 24,
                            displayFormats: { hour: 'MMM d, ha', day: 'MMM d' },
                            tooltipFormat: 'MMM d, yyyy h:mm a'
                        },
                        grid: {
                            color: 'rgba(0,0,0,0.04)',
                            drawBorder: false,
                            tickLength: 0
                        },
                        ticks: {
                            maxTicksLimit: 5,
                            color: '#94a3b8',
                            font: { family: "'Inter', sans-serif", size: 12, weight: '500' },
                            maxRotation: 0,
                            padding: 8
                        },
                        border: { display: false }
                    },
                    y: {
                        min: yMin,
                        max: yMax,
                        title: {
                            display: true,
                            text: 'Water Level (m)',
                            color: '#94a3b8',
                            font: { family: "'Inter', sans-serif", size: 12, weight: '600' },
                            padding: { bottom: 8 }
                        },
                        grid: {
                            color: 'rgba(0,0,0,0.04)',
                            drawBorder: false,
                            tickLength: 0
                        },
                        ticks: {
                            color: '#94a3b8',
                            font: { family: "'Inter', sans-serif", size: 12 },
                            padding: 8,
                            callback: function (v) { return v.toFixed(1); }
                        },
                        border: { display: false }
                    }
                },
                plugins: {
                    legend: {
                        display: datasets.length > 0,
                        position: 'top',
                        align: 'end',
                        labels: {
                            boxWidth: 14,
                            boxHeight: 2,
                            padding: 16,
                            usePointStyle: false,
                            font: { family: "'Inter', sans-serif", size: 12, weight: '600' },
                            color: '#64748b'
                        }
                    },
                    tooltip: {
                        enabled: true,
                        backgroundColor: '#ffffff',
                        titleColor: '#94a3b8',
                        bodyColor: '#0f172a',
                        borderColor: '#e2e8f0',
                        borderWidth: 1,
                        cornerRadius: 10,
                        padding: { top: 10, bottom: 10, left: 14, right: 14 },
                        titleFont: { family: "'Inter', sans-serif", size: 12, weight: '500' },
                        bodyFont:  { family: "'Inter', sans-serif", size: 14, weight: '700' },
                        displayColors: true,
                        boxWidth: 8,
                        boxHeight: 8,
                        boxPadding: 4,
                        usePointStyle: true,
                        caretSize: 6,
                        callbacks: {
                            label: function (ctx) {
                                var v = ctx.parsed.y;
                                return ' ' + ctx.dataset.label + ':  ' +
                                       (v != null ? v.toFixed(2) + ' m' : '\u2014');
                            }
                        }
                    },
                    annotation: { annotations: {} }
                }
            }
        });

        /* store metadata for custom plugins (legacy — plugin state now uses closure vars) */
        chart._thresholds    = th;
        chart._nowTime       = now;
        chart._measuredIndex = measuredIndex;
        chart._wscIndex      = wscIndex;
    }

    /* ── filter readings to visible window ── */

    function filterToWindow(readings, xMin, xMax) {
        if (!readings || !readings.length) return [];
        var pts = [];
        for (var i = 0; i < readings.length; i++) {
            var r = readings[i];
            if (r.wlvl != null && r.dtime >= xMin && r.dtime <= xMax) {
                pts.push({ x: r.dtime, y: r.wlvl });
            }
        }
        return pts;
    }

    function destroy() {
        if (chart) { chart.destroy(); chart = null; }
        showOverlay(false);
    }

    return { init: init, show: show, destroy: destroy };
})();
