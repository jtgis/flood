/* ==========================================================================
   alerts.js - Alert level calculation (with nodata support)
   ========================================================================== */

const FloodAlerts = (function () {
    'use strict';

    // Staleness threshold: readings older than this are considered stale
    const STALE_HOURS = 48;

    // Names of the thresholds each station has (station.thresholds.advisory etc.),
    // ordered from the lowest water level to the highest.
    const THRESHOLD_LEVELS = ['advisory', 'watch', 'warning', 'flood', 'record'];

    /**
     * Colour for each alert level, e.g. COLORS.flood === '#dc2626'.
     * Read from the --c-* variables at the top of style.css, so that file is
     * the one place to change them. (The stylesheet is loaded in <head>, so
     * it is ready before this script runs.)
     */
    const COLORS = {};
    const rootStyle = getComputedStyle(document.documentElement);
    ['normal', 'advisory', 'watch', 'warning', 'flood', 'record', 'nodata'].forEach(level => {
        COLORS[level] = rootStyle.getPropertyValue(`--c-${level}`).trim();
    });

    /**
     * Determine alert level from current water level vs thresholds.
     * Returns: 'flood' | 'warning' | 'watch' | 'advisory' | 'normal' | 'nodata'
     */
    function getAlertLevel(currentLevel, thresholds) {
        if (currentLevel == null || isNaN(currentLevel)) return 'nodata';
        if (thresholds.flood != null && currentLevel >= thresholds.flood) return 'flood';
        if (thresholds.warning != null && currentLevel >= thresholds.warning) return 'warning';
        if (thresholds.watch != null && currentLevel >= thresholds.watch) return 'watch';
        if (thresholds.advisory != null && currentLevel >= thresholds.advisory) return 'advisory';
        return 'normal';
    }

    /**
     * Check if the most recent reading is stale (older than STALE_HOURS).
     * Returns true if data is stale or missing.
     */
    function isStale(readings) {
        const last = FloodUtils.lastValidReading(readings);
        if (!last || !last.dtime) return true;
        const ageHours = (Date.now() - last.dtime.getTime()) / 3600000;
        return ageHours > STALE_HOURS;
    }

    /**
     * Alert priority (higher = more severe). Used for sorting by risk.
     */
    const PRIORITY = {
        flood: 6,
        warning: 5,
        watch: 4,
        advisory: 3,
        normal: 2,
        nodata: 1
    };

    function alertPriority(level) {
        return PRIORITY[level] || 0;
    }

    /**
     * Count alert levels across an array of station objects.
     */
    function countAlerts(stations) {
        const counts = { normal: 0, advisory: 0, watch: 0, warning: 0, flood: 0, nodata: 0 };
        stations.forEach(s => {
            const level = s.alertLevel || 'nodata';
            if (level in counts) counts[level]++;
        });
        return counts;
    }

    /**
     * Get display label for an alert level
     */
    const LABELS = {
        normal: 'Normal',
        advisory: 'Advisory',
        watch: 'Watch',
        warning: 'Warning',
        flood: 'Flood',
        nodata: 'No Data'
    };

    function alertLabel(level) {
        return LABELS[level] || 'Unknown';
    }

    return { getAlertLevel, isStale, alertPriority, countAlerts, alertLabel, COLORS, THRESHOLD_LEVELS };
})();
