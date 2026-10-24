/* ==========================================================================
   utils.js - Shared helpers
   ========================================================================== */

var FloodUtils = (function () {
    'use strict';

    function formatDateTime(d) {
        if (!(d instanceof Date) || isNaN(d)) return '\u2014';
        var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
               ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
    }

    function formatDate(d) {
        if (!(d instanceof Date) || isNaN(d)) return '\u2014';
        var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    }

    function round(value, decimals) {
        if (value == null || isNaN(value)) return null;
        var factor = Math.pow(10, decimals || 1);
        return Math.round(value * factor) / factor;
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

    function trendClass(direction) {
        if (direction === 'rising') return 'color: var(--c-warning)';
        if (direction === 'falling') return 'color: var(--c-normal)';
        return 'color: var(--text-secondary)';
    }

    function slugify(str) {
        return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    }

    return {
        formatDateTime: formatDateTime,
        formatDate: formatDate,
        round: round,
        showToast: showToast,
        computeTrend: computeTrend,
        trendArrow: trendArrow,
        trendClass: trendClass,
        slugify: slugify
    };
})();
