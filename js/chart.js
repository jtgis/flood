/* ==========================================================================
   chart.js — Original water-level chart for nbflood
   ─────────────────────────────────────────────────────────────────────────
   Key design features (completely custom):
     • Zone-colored line: segment color shifts through blue → green →
       yellow → orange → red as readings cross threshold zones
     • Zone-tinted gradient fill under the line (custom canvas plugin)
     • Vertical zone bar on the right chart edge, with faint threshold
       hint lines and a dot for the current level
     • Custom "NOW" badge & crosshair plugins
     • WSC data rendered as dotted line with visible dot markers
     • White-themed tooltip matching the panel style
   ========================================================================== */

const FloodChart = (function () {
    'use strict';

    let chart = null;
    let canvasEl = null;
    let wrapEl = null;
    let overlayEl = null;

    /*
     * Values the custom plugins below need when they draw. show() fills
     * these in before creating the chart, so the first render is correct.
     */
    const pluginState = {
        thresholds:    null,   // station.thresholds
        measuredIndex: null,   // index of the 'Observed' dataset, if any
        wscIndex:      null,   // index of the 'WSC Gauge' dataset, if any
        nowTime:       null,   // Date the chart was drawn
        currentLevel:  null    // station.currentLevel
    };

    /* ── colour palette (shared with the map and legend) ── */

    const COLORS = FloodAlerts.COLORS;
    const FORECAST_COLOR = '#8b5cf6';
    const FONT = "'Inter', sans-serif";

    const WINDOW_HOURS_BACK    = 48;
    const WINDOW_HOURS_FORWARD = 48;

    /* ── helpers ── */

    // Turn '#rrggbb' into 'rgba(r,g,b,a)' so a colour can be drawn see-through
    function hexToRgba(hex, alpha) {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `rgba(${r},${g},${b},${alpha})`;
    }

    // Light, see-through version of each zone colour for the area under the line
    const FILLS = {};
    Object.keys(COLORS).forEach(level => {
        FILLS[level] = hexToRgba(COLORS[level], 0.18);
    });

    /* ================================================================
       Custom Chart.js Plugins
       ================================================================ */

    /* ── 1. Zone-coloured gradient fill beneath the measured line ── */

    /**
     * Shade the area under one dataset's line. Each gap between two points
     * becomes a thin strip down to the bottom of the chart, tinted by the
     * alert zone of the average water level in that gap.
     */
    function fillByZone(ci, datasetIndex, th) {
        if (datasetIndex == null) return;
        const meta = ci.getDatasetMeta(datasetIndex);
        if (!meta || meta.hidden || !meta.data || meta.data.length < 2) return;

        const ctx    = ci.ctx;
        const bottom = ci.chartArea.bottom;
        const values = ci.data.datasets[datasetIndex].data;

        for (let i = 0; i < meta.data.length - 1; i++) {
            const p0 = meta.data[i];       // pixel position of this point
            const p1 = meta.data[i + 1];   // pixel position of the next point
            if (p0.skip || p1.skip) continue;

            const avgLevel = (values[i].y + values[i + 1].y) / 2;
            const zone = FloodAlerts.getAlertLevel(avgLevel, th);

            // The 0.5px overlap stops thin gaps showing between strips
            ctx.beginPath();
            ctx.moveTo(p0.x - 0.5, p0.y);
            ctx.lineTo(p1.x + 0.5, p1.y);
            ctx.lineTo(p1.x + 0.5, bottom);
            ctx.lineTo(p0.x - 0.5, bottom);
            ctx.closePath();
            ctx.fillStyle = FILLS[zone];
            ctx.fill();
        }
    }

    const zoneFillPlugin = {
        id: 'zoneFill',
        beforeDatasetsDraw(ci) {
            const th = pluginState.thresholds;
            if (!th) return;

            const ctx  = ci.ctx;
            const area = ci.chartArea;

            // Keep the fill inside the plotting area
            ctx.save();
            ctx.beginPath();
            ctx.rect(area.left, area.top, area.right - area.left, area.bottom - area.top);
            ctx.clip();

            // WSC first, so the observed (FEWS) fill is painted on top of it
            fillByZone(ci, pluginState.wscIndex, th);
            fillByZone(ci, pluginState.measuredIndex, th);

            ctx.restore();
        }
    };

    /* ── 2. Crosshair (vertical tracking line on hover) ── */

    const crosshairPlugin = {
        id: 'crosshair',
        afterEvent(ci, args) {
            const e = args.event;
            if (e.type === 'mousemove') {
                ci._crossX = e.x;
                ci._showCross = true;
            }
            if (e.type === 'mouseout') ci._showCross = false;
        },
        afterDraw(ci) {
            if (!ci._showCross) return;
            const x = ci._crossX;
            const a = ci.chartArea;
            if (x < a.left || x > a.right) return;

            const ctx = ci.ctx;
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

    const nowLinePlugin = {
        id: 'nowLine',
        afterDraw(ci) {
            const now = pluginState.nowTime;
            if (!now) return;
            const a = ci.chartArea;
            // Clamp to chart area so NOW is always visible
            const x = Math.max(a.left + 1, Math.min(a.right - 1, ci.scales.x.getPixelForValue(now)));

            const ctx = ci.ctx;
            ctx.save();

            // faint dashed vertical line
            ctx.beginPath();
            ctx.setLineDash([2, 4]);
            ctx.lineWidth   = 1;
            ctx.strokeStyle = 'rgba(15,23,42,0.14)';
            ctx.moveTo(x, a.top);
            ctx.lineTo(x, a.bottom);
            ctx.stroke();

            // "NOW" badge: a dark rounded rectangle at the top of the chart
            ctx.setLineDash([]);
            ctx.font = '700 10px Inter, sans-serif';
            const text = 'NOW';
            const badgeW = ctx.measureText(text).width + 10;
            const badgeH = 15;
            const badgeX = x - badgeW / 2;
            const badgeY = a.top + 6;

            ctx.fillStyle = '#0f172a';
            ctx.beginPath();
            ctx.roundRect(badgeX, badgeY, badgeW, badgeH, 4);
            ctx.fill();

            ctx.fillStyle    = '#ffffff';
            ctx.textAlign    = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, x, badgeY + badgeH / 2);

            ctx.restore();
        }
    };

    /* ── 4. Vertical zone bar on the right edge (replaces text threshold labels) ── */

    const thresholdTickPlugin = {
        id: 'thresholdTicks',
        afterDraw(ci) {
            const th = pluginState.thresholds;
            if (!th) return;
            const a      = ci.chartArea;
            const yScale = ci.scales.y;
            const ctx    = ci.ctx;

            const BAR_X = a.right + 5;
            const BAR_W = 10;

            ctx.save();

            // faint dotted threshold hint lines across the chart
            FloodAlerts.THRESHOLD_LEVELS.forEach(level => {
                const val = th[level];
                if (val == null) return;
                const y = yScale.getPixelForValue(val);
                if (y < a.top || y > a.bottom) return;
                ctx.beginPath();
                ctx.strokeStyle = hexToRgba(COLORS[level], 0.14);
                ctx.lineWidth   = 1;
                ctx.setLineDash([2, 6]);
                ctx.moveTo(a.left, y);
                ctx.lineTo(a.right, y);
                ctx.stroke();
            });
            ctx.setLineDash([]);

            // vertical zone bar: build zone stack from yMin upward
            const zoneStack = [{ val: yScale.min, color: COLORS.normal }];
            FloodAlerts.THRESHOLD_LEVELS.forEach(level => {
                if (th[level] != null) zoneStack.push({ val: th[level], color: COLORS[level] });
            });

            // Pixel y of a value, kept inside the chart area
            const clampedY = val => Math.min(a.bottom, Math.max(a.top, yScale.getPixelForValue(val)));

            zoneStack.forEach((zone, i) => {
                const toVal = i + 1 < zoneStack.length ? zoneStack[i + 1].val : yScale.max;
                const fromY = clampedY(zone.val);
                const toY   = clampedY(toVal);
                if (fromY <= toY) return;   // zone is off the visible scale
                ctx.fillStyle = zone.color;
                ctx.fillRect(BAR_X, toY, BAR_W, fromY - toY);
            });

            // current-level marker on the bar
            const level = pluginState.currentLevel;
            if (level != null) {
                const ly = yScale.getPixelForValue(level);
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
       Init / Overlay
       ================================================================ */

    function init() {
        canvasEl = document.getElementById('station-chart');
        wrapEl   = canvasEl ? canvasEl.parentElement : null;
    }

    // "No current data available" message laid over the chart
    function showOverlay(visible) {
        if (!overlayEl && wrapEl) {
            overlayEl = document.createElement('div');
            overlayEl.className = 'chart-no-data';
            overlayEl.innerHTML = '<span>No current data available</span>';
            wrapEl.appendChild(overlayEl);
        }
        if (overlayEl) overlayEl.style.display = visible ? 'flex' : 'none';
    }

    /* ================================================================
       Main show()
       ================================================================ */

    /**
     * Draw the water-level chart for a station, replacing any previous chart.
     * Shows up to three lines over a window from 48h ago to 48h ahead:
     * Observed (FEWS), WSC Gauge, and Forecast.
     */
    function show(station) {
        if (chart) { chart.destroy(); chart = null; }
        if (!canvasEl) return;

        const th  = station.thresholds;
        const now = new Date();
        const xMin = new Date(now.getTime() - WINDOW_HOURS_BACK    * 3600000);
        const xMax = new Date(now.getTime() + WINDOW_HOURS_FORWARD * 3600000);

        /* ── filter data to visible window ── */
        const measuredData = filterToWindow(station.measures, xMin, xMax);
        const wscData      = filterToWindow(station.wscMeasures, xMin, xMax);
        let forecastData   = filterToWindow(station.forecasts, xMin, xMax);

        // Start the forecast line at the last observed point so the two
        // lines join up instead of leaving a gap at "now"
        if (measuredData.length && forecastData.length) {
            const last = measuredData[measuredData.length - 1];
            forecastData = [{ x: last.x, y: last.y }, ...forecastData];
        }

        const hasData = measuredData.length > 0 || wscData.length > 0 || forecastData.length > 0;
        const isStale = station.isStale && measuredData.length === 0 && wscData.length === 0;
        showOverlay(isStale || !hasData);

        /* ── Y-axis range: fit all readings and thresholds, with a little padding ── */
        const allY = [...measuredData, ...forecastData, ...wscData].map(p => p.y);
        FloodAlerts.THRESHOLD_LEVELS.forEach(level => {
            if (th[level] != null) allY.push(th[level]);
        });

        const lo   = allY.length ? Math.min(...allY) : 0;
        const hi   = allY.length ? Math.max(...allY) : 10;
        const yPad = Math.max((hi - lo) * 0.05, 0.15);
        const yMin = Math.floor((lo - yPad) * 10) / 10;
        const yMax = Math.ceil ((hi + yPad) * 10) / 10;

        /* ── colour helpers for Chart.js callbacks ── */
        const zoneColor = y => COLORS[FloodAlerts.getAlertLevel(y, th)];
        // colour a point by the zone its own value is in
        const pointZoneColor = ctx => ctx.raw ? zoneColor(ctx.raw.y) : COLORS.normal;
        // colour a line segment by the zone of the point it ends at
        const segmentZoneColor = ctx => (ctx.p1 && ctx.p1.parsed) ? zoneColor(ctx.p1.parsed.y) : COLORS.normal;

        /* ── datasets ── */
        const datasets = [];
        let measuredIndex = null;
        let wscIndex = null;

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
                pointHoverBorderColor: pointZoneColor,
                pointHitRadius: 10,
                tension: 0.35,
                order: 1,
                segment: { borderColor: segmentZoneColor }
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
                // only draw a dot on the latest reading
                pointRadius: ctx => ctx.dataIndex === ctx.dataset.data.length - 1 ? 5 : 0,
                pointBackgroundColor: pointZoneColor,
                pointBorderColor: pointZoneColor,
                pointBorderWidth: 1,
                pointHoverRadius: 6,
                pointHitRadius: 10,
                tension: 0.3,
                spanGaps: true,
                order: 0,
                segment: { borderColor: segmentZoneColor }
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

        /* ── set plugin state before chart creation so first render is correct ── */
        pluginState.thresholds    = th;
        pluginState.nowTime       = now;
        pluginState.measuredIndex = measuredIndex;
        pluginState.wscIndex      = wscIndex;
        pluginState.currentLevel  = station.currentLevel;

        /* ── create chart ── */
        chart = new Chart(canvasEl, {
            type: 'line',
            data: { datasets },
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
                            displayFormats: { hour: 'MMM d, ha' },
                            tooltipFormat: 'MMM d, yyyy h:mm a'
                        },
                        grid: {
                            color: 'rgba(0,0,0,0.04)',
                            tickLength: 0
                        },
                        ticks: {
                            maxTicksLimit: 5,
                            color: '#94a3b8',
                            font: { family: FONT, size: 12, weight: '500' },
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
                            font: { family: FONT, size: 12, weight: '600' },
                            padding: { bottom: 8 }
                        },
                        grid: {
                            color: 'rgba(0,0,0,0.04)',
                            tickLength: 0
                        },
                        ticks: {
                            color: '#94a3b8',
                            font: { family: FONT, size: 12 },
                            padding: 8,
                            callback: v => v.toFixed(1)
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
                            font: { family: FONT, size: 12, weight: '600' },
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
                        titleFont: { family: FONT, size: 12, weight: '500' },
                        bodyFont:  { family: FONT, size: 14, weight: '700' },
                        displayColors: true,
                        boxWidth: 8,
                        boxHeight: 8,
                        boxPadding: 4,
                        usePointStyle: true,
                        caretSize: 6,
                        callbacks: {
                            label: ctx => {
                                const v = ctx.parsed.y;
                                return ` ${ctx.dataset.label}:  ${v != null ? `${v.toFixed(2)} m` : '—'}`;
                            }
                        }
                    }
                }
            }
        });
    }

    /* ── filter readings to visible window ── */

    // Keep readings with a value inside [xMin, xMax], as Chart.js {x, y} points
    function filterToWindow(readings, xMin, xMax) {
        if (!readings) return [];
        return readings
            .filter(r => r.wlvl != null && r.dtime >= xMin && r.dtime <= xMax)
            .map(r => ({ x: r.dtime, y: r.wlvl }));
    }

    function destroy() {
        if (chart) { chart.destroy(); chart = null; }
        showOverlay(false);
    }

    return { init, show, destroy };
})();
