/* ==========================================================================
   utils.js - Shared helpers
   ========================================================================== */

var FloodUtils = (function () {
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

    function round(value, decimals) {
        if (value == null || isNaN(value)) return null;
        var factor = Math.pow(10, decimals || 1);
        return Math.round(value * factor) / factor;
    }

    /**
     * Return the newest reading that has a water level, or null if there is
     * none. Readings are { dtime, wlvl } objects in time order; missing
     * values have wlvl === null.
     */
    function lastValidReading(readings) {
        if (!readings) return null;
        for (var i = readings.length - 1; i >= 0; i--) {
            if (readings[i].wlvl != null) return readings[i];
        }
        return null;
    }

    function showToast(message, duration) {
        duration = duration || 4000;
        var el = document.getElementById('toast');
        if (!el) return;
        el.textContent = message;
        el.classList.remove('toast-hidden');
        clearTimeout(el._timer);
        el._timer = setTimeout(function () {
            el.classList.add('toast-hidden');
        }, duration);
    }

    /**
     * Work out whether the water is rising, falling or stable, using the
     * change between the first and last valid readings in the final 6 hours.
     * Readings with no value (null) are ignored. This matters because in JS
     * null - 5 === -5, so a missing last reading would look like a big drop.
     */
    function computeTrend(readings) {
        var stable = { direction: 'stable', rate: 0 };
        if (!readings) return stable;

        var valid = readings.filter(function (r) { return r.wlvl != null; });
        if (valid.length < 2) return stable;

        var last = valid[valid.length - 1];
        var cutoff = new Date(last.dtime.getTime() - 6 * 3600 * 1000);
        var recent = valid.filter(function (r) { return r.dtime >= cutoff; });
        if (recent.length < 2) return stable;

        var first = recent[0];
        var deltaLevel = last.wlvl - first.wlvl;
        var deltaHours = (last.dtime - first.dtime) / 3600000;
        if (deltaHours === 0) return stable;

        var rate = deltaLevel / deltaHours;
        var direction = 'stable';
        if (rate > 0.02) direction = 'rising';
        else if (rate < -0.02) direction = 'falling';

        return { direction: direction, rate: round(Math.abs(rate), 2) };
    }

    function trendArrow(direction) {
        if (direction === 'rising') return '\u2191';
        if (direction === 'falling') return '\u2193';
        return '\u2192';
    }

    return {
        escapeHtml: escapeHtml,
        round: round,
        lastValidReading: lastValidReading,
        showToast: showToast,
        computeTrend: computeTrend,
        trendArrow: trendArrow
    };
})();
