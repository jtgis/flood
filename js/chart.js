/* ==========================================================================
   chart.js — Redesigned water-level chart
   - Always anchored to current date (±3 days window)
   - Stale stations show empty chart with "No current data" overlay
   - WSC realtime data shown as separate dataset
   - Cleaner, more readable design with gradient fills
   ========================================================================== */

var FloodChart = (function () {
    'use strict';

    var chart = null;
    var canvasEl = null;
    var wrapEl = null;
    var overlayEl = null;   // "no data" overlay

    // Visual constants
    var MEASURED_COLOR   = '#ffffff';
    var MEASURED_GLOW    = 'rgba(59, 130, 246, 0.35)';
    var FORECAST_COLOR   = '#a78bfa';
    var WSC_COLOR        = '#38bdf8';

    var THRESHOLD_COLORS = {
        advisory: '#22c55e',
        watch:    '#eab308',
        warning:  '#f97316',
        flood:    '#dc2626',
        record:   '#a855f7'
    };

    var ZONE_ALPHAS = {
        normal:   'rgba(59,130,246,0.05)',
        advisory: 'rgba(34,197,94,0.07)',
        watch:    'rgba(234,179,8,0.07)',
        warning:  'rgba(249,115,22,0.07)',
        flood:    'rgba(220,38,38,0.07)'
    };

    // Time window: 3 days before now, 3 days after
    var WINDOW_HOURS_BACK    = 72;
    var WINDOW_HOURS_FORWARD = 72;

    function init() {
        canvasEl = document.getElementById('station-chart');
        wrapEl = canvasEl ? canvasEl.parentElement : null;
    }

    // ── Ensure overlay element exists ──
    function ensureOverlay() {
        if (overlayEl) return;
        if (!wrapEl) return;
        overlayEl = document.createElement('div');
        overlayEl.className = 'chart-no-data';
        overlayEl.innerHTML = '<span>No current data available</span>';
        wrapEl.appendChild(overlayEl);
    }
    function showOverlay(show) {
        ensureOverlay();
        if (overlayEl) overlayEl.style.display = show ? 'flex' : 'none';
    }

    // ── Main show function ──

    function show(station) {
        if (chart) { chart.destroy(); chart = null; }
        if (!canvasEl) return;

        var now = new Date();
        var xMin = new Date(now.getTime() - WINDOW_HOURS_BACK * 3600000);
        var xMax = new Date(now.getTime() + WINDOW_HOURS_FORWARD * 3600000);

        // Filter data to the visible window
        var measuredData = filterToWindow(station.measures, xMin, xMax);
        var forecastData = [];
        var wscData = filterToWindow(station.wscMeasures || [], xMin, xMax);

        // Forecasts: connect to last measured point for continuity
        if (station.forecasts && station.forecasts.length) {
            var rawForecast = filterToWindow(station.forecasts, xMin, xMax);
            if (measuredData.length > 0 && rawForecast.length > 0) {
                var lastMeas = measuredData[measuredData.length - 1];
                forecastData.push({ x: lastMeas.x, y: lastMeas.y });
            }
            forecastData = forecastData.concat(rawForecast);
        }

        // Determine if there's any current data to show
        var hasCurrentData = measuredData.length > 0 || wscData.length > 0 || forecastData.length > 0;
        var isStale = station.isStale && measuredData.length === 0 && wscData.length === 0;

        showOverlay(isStale || !hasCurrentData);

        // Collect all values for y-axis range (include thresholds always)
        var allValues = [];
        measuredData.forEach(function (p) { allValues.push(p.y); });
        forecastData.forEach(function (p) { allValues.push(p.y); });
        wscData.forEach(function (p) { allValues.push(p.y); });

        var th = station.thresholds;
        [th.advisory, th.watch, th.warning, th.flood, th.record].forEach(function (v) {
            if (v != null) allValues.push(v);
        });

        // If no data at all, use thresholds or default range
        var minVal = allValues.length ? Math.min.apply(null, allValues) : 0;
        var maxVal = allValues.length ? Math.max.apply(null, allValues) : 10;
        var yPadding = Math.max((maxVal - minVal) * 0.15, 0.5);
        var yMin = Math.floor((minVal - yPadding) * 10) / 10;
        var yMax = Math.ceil((maxVal + yPadding) * 10) / 10;

        // Build annotations
        var annotations = buildAnnotations(th, yMin, yMax, now);

        // Build datasets
        var datasets = [];

        if (measuredData.length > 0) {
            datasets.push({
                label: 'Measured',
                data: measuredData,
                borderColor: MEASURED_COLOR,
                backgroundColor: function (ctx) {
                    if (!ctx.chart.chartArea) return MEASURED_GLOW;
                    var g = ctx.chart.ctx.createLinearGradient(0, ctx.chart.chartArea.top, 0, ctx.chart.chartArea.bottom);
                    g.addColorStop(0, 'rgba(59,130,246,0.30)');
                    g.addColorStop(1, 'rgba(59,130,246,0.02)');
                    return g;
                },
                fill: true,
                borderWidth: 2.5,
                pointRadius: 0,
                pointHoverRadius: 4,
                pointHoverBackgroundColor: '#fff',
                pointHitRadius: 8,
                tension: 0.3,
                order: 2
            });
        }

        if (wscData.length > 0) {
            datasets.push({
                label: 'WSC Realtime',
                data: wscData,
                borderColor: WSC_COLOR,
                backgroundColor: function (ctx) {
                    if (!ctx.chart.chartArea) return 'rgba(56,189,248,0.15)';
                    var g = ctx.chart.ctx.createLinearGradient(0, ctx.chart.chartArea.top, 0, ctx.chart.chartArea.bottom);
                    g.addColorStop(0, 'rgba(56,189,248,0.20)');
                    g.addColorStop(1, 'rgba(56,189,248,0.02)');
                    return g;
                },
                fill: true,
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4,
                pointHoverBackgroundColor: WSC_COLOR,
                pointHitRadius: 8,
                tension: 0.3,
                borderDash: [4, 2],
                order: 3
            });
        }

        if (forecastData.length > 0) {
            datasets.push({
                label: 'Forecast',
                data: forecastData,
                borderColor: FORECAST_COLOR,
                borderDash: [8, 4],
                backgroundColor: 'transparent',
                fill: false,
                borderWidth: 2,
                pointRadius: 0,
                pointHoverRadius: 4,
                pointHoverBackgroundColor: FORECAST_COLOR,
                pointHitRadius: 8,
                tension: 0.3,
                order: 4
            });
        }

        // Chart
        chart = new Chart(canvasEl, {
            type: 'line',
            data: { datasets: datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 400, easing: 'easeOutQuart' },
                interaction: { mode: 'nearest', axis: 'x', intersect: false },
                layout: { padding: { top: 4, right: 8, bottom: 0, left: 4 } },
                scales: {
                    x: {
                        type: 'time',
                        min: xMin,
                        max: xMax,
                        time: {
                            unit: 'hour',
                            stepSize: 12,
                            displayFormats: {
                                hour: 'MMM d, ha',
                                day: 'MMM d'
                            },
                            tooltipFormat: 'MMM d, yyyy h:mm a'
                        },
                        grid: {
                            color: 'rgba(255,255,255,0.06)',
                            drawBorder: false
                        },
                        ticks: {
                            maxTicksLimit: 7,
                            color: 'rgba(255,255,255,0.45)',
                            font: { family: 'Inter', size: 11 },
                            maxRotation: 0
                        }
                    },
                    y: {
                        min: yMin,
                        max: yMax,
                        title: {
                            display: true,
                            text: 'metres',
                            color: 'rgba(255,255,255,0.4)',
                            font: { family: 'Inter', size: 11, weight: '600' }
                        },
                        grid: {
                            color: 'rgba(255,255,255,0.06)',
                            drawBorder: false
                        },
                        ticks: {
                            color: 'rgba(255,255,255,0.45)',
                            font: { family: 'Inter', size: 11 },
                            callback: function (v) { return v.toFixed(1); }
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: datasets.length > 0,
                        position: 'top',
                        align: 'end',
                        labels: {
                            boxWidth: 12,
                            boxHeight: 3,
                            padding: 14,
                            usePointStyle: false,
                            font: { family: 'Inter', size: 11, weight: '500' },
                            color: 'rgba(255,255,255,0.7)'
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15,23,42,0.90)',
                        titleColor: 'rgba(255,255,255,0.7)',
                        bodyColor: '#fff',
                        borderColor: 'rgba(255,255,255,0.1)',
                        borderWidth: 1,
                        cornerRadius: 8,
                        padding: 10,
                        titleFont: { family: 'Inter', size: 11 },
                        bodyFont: { family: 'Inter', size: 13, weight: '600' },
                        displayColors: true,
                        boxWidth: 8,
                        boxHeight: 8,
                        boxPadding: 4,
                        callbacks: {
                            label: function (ctx) {
                                var v = ctx.parsed.y;
                                return ' ' + ctx.dataset.label + ':  ' + (v != null ? v.toFixed(2) + ' m' : '\u2014');
                            }
                        }
                    },
                    annotation: { annotations: annotations }
                }
            }
        });
    }

    // ── Filter readings to visible time window ──

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

    // ── Annotations (threshold lines + zone bands + "now" line) ──

    function buildAnnotations(thresholds, yMin, yMax, now) {
        var annotations = {};

        // Threshold lines — clean, labeled on the left
        var defs = [
            { key: 'advisory', label: 'ADVISORY', color: THRESHOLD_COLORS.advisory },
            { key: 'watch',    label: 'WATCH',    color: THRESHOLD_COLORS.watch },
            { key: 'warning',  label: 'WARNING',  color: THRESHOLD_COLORS.warning },
            { key: 'flood',    label: 'FLOOD',    color: THRESHOLD_COLORS.flood },
            { key: 'record',   label: 'RECORD',   color: THRESHOLD_COLORS.record }
        ];

        defs.forEach(function (def) {
            var val = thresholds[def.key];
            if (val == null) return;
            var isDashed = def.key === 'record';
            annotations['line_' + def.key] = {
                type: 'line',
                yMin: val, yMax: val,
                borderColor: def.color,
                borderWidth: isDashed ? 1.5 : 2,
                borderDash: isDashed ? [6, 4] : [],
                label: {
                    display: true,
                    content: def.label,
                    position: 'start',
                    backgroundColor: def.color,
                    color: def.key === 'watch' ? '#1a1a2e' : '#fff',
                    font: { family: 'Inter', size: 9, weight: '700' },
                    padding: { left: 5, right: 5, top: 2, bottom: 2 },
                    borderRadius: 3
                }
            };
        });

        // Zone bands — very subtle
        var zones = [
            { key: 'normal',   from: yMin,                to: thresholds.advisory, color: ZONE_ALPHAS.normal },
            { key: 'advisory', from: thresholds.advisory,  to: thresholds.watch,    color: ZONE_ALPHAS.advisory },
            { key: 'watch',    from: thresholds.watch,     to: thresholds.warning,  color: ZONE_ALPHAS.watch },
            { key: 'warning',  from: thresholds.warning,   to: thresholds.flood,    color: ZONE_ALPHAS.warning },
            { key: 'flood',    from: thresholds.flood,     to: yMax,                color: ZONE_ALPHAS.flood }
        ];

        zones.forEach(function (z) {
            if (z.from == null || z.to == null) return;
            annotations['zone_' + z.key] = {
                type: 'box',
                yMin: z.from, yMax: z.to,
                backgroundColor: z.color,
                borderWidth: 0,
                drawTime: 'beforeDatasetsDraw'
            };
        });

        // Vertical "Now" line — always shown since chart is anchored to today
        annotations['now_line'] = {
            type: 'line',
            xMin: now, xMax: now,
            borderColor: 'rgba(255,255,255,0.5)',
            borderWidth: 1.5,
            borderDash: [4, 3],
            label: {
                display: true,
                content: 'NOW',
                position: 'start',
                backgroundColor: 'rgba(255,255,255,0.15)',
                color: 'rgba(255,255,255,0.8)',
                font: { family: 'Inter', size: 9, weight: '700' },
                padding: { left: 5, right: 5, top: 2, bottom: 2 },
                borderRadius: 3
            }
        };

        return annotations;
    }

    function destroy() {
        if (chart) { chart.destroy(); chart = null; }
        showOverlay(false);
    }

    return { init: init, show: show, destroy: destroy };
})();
