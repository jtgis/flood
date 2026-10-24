/* ==========================================================================
   data.js - Fetch & parse all data sources (with stale data detection)
   ========================================================================== */

const FloodData = (function () {
    'use strict';

    const URLS = {
        alertLevels: 'https://geonb.snb.ca/rwm/flood/alertlevels.xml',
        fewsExport:  'https://geonb.snb.ca/rwm/flood/StJohn_FEWSNB_export.xml',
        wscRealtime: 'https://api.weather.gc.ca/collections/hydrometric-realtime/items'
    };

    async function fetchXML(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status} fetching ${url}`);
        const text = await response.text();
        return new DOMParser().parseFromString(text, 'application/xml');
    }

    // -- Parse alert levels XML --

    function parseAlertLevels(doc) {
        return Array.from(doc.getElementsByTagName('station'), parseAlertStation);
    }

    /**
     * Turn one <station> element from alertlevels.xml into a station object.
     * Readings are filled in later from FEWS and WSC. Note the feed's tag
     * names: <Floodlvl> is the flood threshold and <max> is the record level.
     */
    function parseAlertStation(node) {
        const getText = tag => {
            const el = node.getElementsByTagName(tag)[0];
            return el ? el.textContent.trim() : '';
        };
        const getNum = tag => {
            const value = parseFloat(getText(tag));
            return isNaN(value) ? null : value;
        };
        return {
            name:       getText('name'),
            stationID:  getText('stationID'),
            lat:        getNum('latitude'),
            lng:        getNum('longitude'),
            thresholds: {
                advisory: getNum('advisory'),
                watch:    getNum('watch'),
                warning:  getNum('warning'),
                flood:    getNum('Floodlvl'),
                record:   getNum('max')
            },
            wscUrlEn:     getText('WSC_URL_EN'),
            measures:     [],
            forecasts:    [],
            currentLevel: null,
            alertLevel:   'nodata',
            trend:        { direction: 'stable', rate: 0 },
            isStale:      true
        };
    }

    // -- Parse FEWS export XML --

    /**
     * Convert the FEWS <timeZone> value (hours offset from UTC, e.g. "-4.0")
     * into an ISO 8601 offset string such as "-04:00".
     * FEWS times have no offset of their own, so without this the browser
     * would treat them as the viewer's local time.
     */
    function fewsOffset(doc) {
        const tzEl = doc.getElementsByTagName('timeZone')[0];
        let hours = tzEl ? parseFloat(tzEl.textContent) : 0;   // FEWS default is GMT
        if (isNaN(hours)) hours = 0;

        const sign = hours < 0 ? '-' : '+';
        const totalMinutes = Math.round(Math.abs(hours) * 60);
        const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
        const mm = String(totalMinutes % 60).padStart(2, '0');
        return `${sign}${hh}:${mm}`;
    }

    /**
     * Read the FEWS export and attach readings to the matching stations.
     * The file holds one <series> per station and parameter. We use two:
     *   HG   = observed river stage (m)  -> station.measures
     *   SSTG = simulated/forecast stage (m) -> station.forecasts
     * (It also has flow series, Q and SQIN, which the app does not use.)
     * Returns the export's creation date (a 'YYYY-MM-DD' string) or null.
     */
    function parseFEWS(doc, stations) {
        const tzOffset = fewsOffset(doc);
        let creationDate = null;

        // Look stations up by ID instead of searching the list for every series
        const stationsById = {};
        stations.forEach(s => { stationsById[s.stationID] = s; });

        for (const series of doc.getElementsByTagName('series')) {
            const header = series.getElementsByTagName('header')[0];
            if (!header) continue;

            const locationEl = header.getElementsByTagName('locationId')[0];
            const parameterEl = header.getElementsByTagName('parameterId')[0];
            if (!locationEl || !parameterEl) continue;

            if (!creationDate) {
                const dateEl = header.getElementsByTagName('creationDate')[0];
                if (dateEl) creationDate = dateEl.textContent.trim();
            }

            const paramId = parameterEl.textContent.trim();
            if (paramId !== 'HG' && paramId !== 'SSTG') continue;

            const station = stationsById[locationEl.textContent.trim()];
            if (!station) continue;

            const readings = Array.from(series.getElementsByTagName('event'), ev => {
                const value = parseFloat(ev.getAttribute('value'));
                return {
                    dtime: new Date(`${ev.getAttribute('date')}T${ev.getAttribute('time')}${tzOffset}`),
                    wlvl: value === -999 ? null : value     // -999 means "missing" in FEWS
                };
            });

            if (paramId === 'HG') {
                station.measures = readings;
            } else {
                station.forecasts = readings;
            }
        }

        // Compute current level, staleness, alert level, trend
        stations.forEach(computeStationStatus);

        return creationDate;
    }

    /**
     * Work out a station's current level, alert level and trend.
     *
     * A station can have up to two data sources:
     *   - FEWS (provincial): observed readings (measures) and forecasts
     *   - WSC (federal):     realtime gauge readings (wscMeasures)
     * FEWS is preferred. WSC is used when FEWS is stale or empty and WSC
     * has a fresh reading. If neither is fresh, the alert level is 'nodata'.
     */
    function computeStationStatus(station) {
        // 1. FEWS: the latest observed reading. If the station has no observed
        //    readings at all, use the first forecast value instead.
        const fewsReading = FloodUtils.lastValidReading(station.measures) ||
            station.forecasts.find(r => r.wlvl != null) ||
            null;

        // Note: a forecast-only station counts as fresh, because its last
        // forecast time is in the future.
        const fewsStale = FloodAlerts.isStale(station.measures.length > 0 ? station.measures : station.forecasts);

        // 2. WSC: the latest gauge reading, if it is recent enough
        const wscReading = FloodUtils.lastValidReading(station.wscMeasures);
        const wscFresh = wscReading != null && !FloodAlerts.isStale(station.wscMeasures);

        // 3. Pick the source to show
        let reading;
        if ((fewsStale || !fewsReading) && wscFresh) {
            reading = wscReading;
            station.isStale = false;
            station.dataSource = 'wsc';
        } else {
            reading = fewsReading;
            station.isStale = fewsStale;
            station.dataSource = fewsStale ? 'none' : 'fews';
        }

        station.currentLevel = reading ? reading.wlvl : null;
        station.lastReadingTime = reading ? reading.dtime : null;

        // 4. Alert level and trend from the chosen source
        if (station.isStale) {
            station.alertLevel = 'nodata';
        } else {
            station.alertLevel = FloodAlerts.getAlertLevel(station.currentLevel, station.thresholds);
        }

        station.trend = FloodUtils.computeTrend(
            station.dataSource === 'wsc' ? station.wscMeasures : station.measures
        );
    }

    // -- WSC Realtime (via EC GeoMet OGC API — CORS enabled) --

    /**
     * Extract WSC station number from wscUrlEn like
     *   "https://wateroffice.ec.gc.ca/report/real_time_e.html?stn=01AK003"
     */
    function extractWSCId(wscUrl) {
        if (!wscUrl || wscUrl === 'NONE') return null;
        const match = wscUrl.match(/stn=([A-Z0-9]+)/i);
        return match ? match[1] : null;
    }

    // How far back to fetch WSC readings. Matches the chart's 48h look-back;
    // anything older would count as stale (FloodAlerts STALE_HOURS) anyway.
    const WSC_HISTORY_HOURS = 48;

    /**
     * Fetch the last WSC_HISTORY_HOURS of realtime water-level data for a
     * single WSC station.
     * Returns an array of { dtime, wlvl } readings sorted chronologically.
     */
    async function fetchWSCStation(stnNumber) {
        const since = new Date(Date.now() - WSC_HISTORY_HOURS * 3600000).toISOString();
        const params = new URLSearchParams({
            STATION_NUMBER: stnNumber,
            datetime: `${since}/..`,            // only readings from 'since' onward
            properties: 'DATETIME,LEVEL',       // only the two fields we use...
            skipGeometry: 'true',               // ...and not the station location
            limit: '2000',
            sortby: '-DATETIME',
            f: 'json'
        });

        const response = await fetch(`${URLS.wscRealtime}?${params}`);
        if (!response.ok) throw new Error(`WSC HTTP ${response.status}`);
        const geojson = await response.json();

        const readings = (geojson.features || [])
            .map(f => f.properties)
            .filter(p => p && p.DATETIME && p.LEVEL != null)
            .map(p => ({ dtime: new Date(p.DATETIME), wlvl: parseFloat(p.LEVEL) }));

        // Sort chronologically (API returns newest-first)
        readings.sort((a, b) => a.dtime - b.dtime);
        return readings;
    }

    /**
     * Fetch WSC realtime data for all stations that have a WSC URL, in
     * parallel (about 25 stations). Sets station.wscMeasures on success;
     * a failed request is ignored and that station just has no WSC data.
     */
    function fetchAllWSC(stations) {
        return Promise.all(stations.map(async station => {
            const stnId = extractWSCId(station.wscUrlEn);
            if (!stnId) return;
            try {
                const readings = await fetchWSCStation(stnId);
                if (readings.length > 0) station.wscMeasures = readings;
            } catch (err) {
                // Ignore: this station just won't show WSC data
            }
        }));
    }

    // -- Public API --

    /**
     * Load everything the app needs, in this order:
     *   1. alertlevels.xml (station list + thresholds) and the FEWS export,
     *      fetched at the same time. The app cannot run without the first;
     *      FEWS is optional.
     *   2. WSC realtime readings for each station that has a WSC gauge.
     * Resolves to { stations, creationDate }.
     */
    async function loadAll() {
        const [alertDoc, fewsDoc] = await Promise.all([
            fetchXML(URLS.alertLevels),
            fetchXML(URLS.fewsExport).catch(err => {
                console.warn('FEWS data unavailable:', err.message);
                return null;
            })
        ]);

        const stations = parseAlertLevels(alertDoc);
        const creationDate = fewsDoc ? parseFEWS(fewsDoc, stations) : null;

        // Fetch WSC realtime data, then recompute stations that gained some
        await fetchAllWSC(stations);
        stations.forEach(station => {
            if (station.wscMeasures && station.wscMeasures.length > 0) {
                computeStationStatus(station);
            }
        });

        return { stations, creationDate };
    }

    return { loadAll };
})();
