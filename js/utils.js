/* ==========================================================================
   utils.js - Shared helpers
   ========================================================================== */

const FloodUtils = (function () {
    'use strict';

    /**
     * Make text safe to put inside an HTML string. Characters like < and &
     * would otherwise be read as markup and could break the page.
     * Use this for any data from outside the app (e.g. station names).
     */
    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Round to a number of decimal places (default 1), e.g. round(5.678, 2) -> 5.68.
    // Returns null for missing values.
    function round(value, decimals = 1) {
        if (value == null || isNaN(value)) return null;
        const factor = Math.pow(10, decimals);
        return Math.round(value * factor) / factor;
    }

    /**
     * Return the newest reading that has a water level, or null if there is
     * none. Readings are { dtime, wlvl } objects in time order; missing
     * values have wlvl === null.
     */
    function lastValidReading(readings) {
        if (!readings) return null;
        for (let i = readings.length - 1; i >= 0; i--) {
            if (readings[i].wlvl != null) return readings[i];
        }
        return null;
    }

    function showToast(message, duration = 4000) {
        const el = document.getElementById('toast');
        if (!el) return;
        el.textContent = message;
        el.classList.remove('toast-hidden');
        clearTimeout(el._timer);
        el._timer = setTimeout(() => el.classList.add('toast-hidden'), duration);
    }

    /**
     * Work out whether the water is rising, falling or stable, using the
     * change between the first and last valid readings in the final 6 hours.
     * Readings with no value (null) are ignored. This matters because in JS
     * null - 5 === -5, so a missing last reading would look like a big drop.
     */
    function computeTrend(readings) {
        const stable = { direction: 'stable', rate: 0 };
        if (!readings) return stable;

        const valid = readings.filter(r => r.wlvl != null);
        if (valid.length < 2) return stable;

        const last = valid[valid.length - 1];
        const cutoff = new Date(last.dtime.getTime() - 6 * 3600 * 1000);
        const recent = valid.filter(r => r.dtime >= cutoff);
        if (recent.length < 2) return stable;

        const first = recent[0];
        const deltaLevel = last.wlvl - first.wlvl;
        const deltaHours = (last.dtime - first.dtime) / 3600000;
        if (deltaHours === 0) return stable;

        const rate = deltaLevel / deltaHours;
        let direction = 'stable';
        if (rate > 0.02) direction = 'rising';
        else if (rate < -0.02) direction = 'falling';

        return { direction, rate: round(Math.abs(rate), 2) };
    }

    function trendArrow(direction) {
        if (direction === 'rising') return '↑';
        if (direction === 'falling') return '↓';
        return '→';
    }

    return { escapeHtml, round, lastValidReading, showToast, computeTrend, trendArrow };
})();
