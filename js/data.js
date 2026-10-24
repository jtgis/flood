/* ==========================================================================
   data.js - Fetch & parse all data sources (with stale data detection)
   ========================================================================== */

var FloodData = (function () {
    'use strict';

    var URLS = {
        alertLevels: 'https://geonb.snb.ca/rwm/flood/alertlevels.xml',
        fewsExport:  'https://geonb.snb.ca/rwm/flood/StJohn_FEWSNB_export.xml',
        wscRealtime: 'https://api.weather.gc.ca/collections/hydrometric-realtime/items'
    };

    function fetchXML(url) {
        return fetch(url)
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status + ' fetching ' + url);
                return r.text();
            })
            .then(function (text) {
                return new DOMParser().parseFromString(text, 'application/xml');
            });
    }

    // -- Parse alert levels XML --

    function parseAlertLevels(doc) {
        var stations = [];
        var nodes = doc.getElementsByTagName('station');
        for (var i = 0; i < nodes.length; i++) {
            stations.push(parseAlertStation(nodes[i]));
        }
        return stations;
    }

    /**
     * Turn one <station> element from alertlevels.xml into a station object.
     * Readings are filled in later from FEWS and WSC. Note the feed's tag
     * names: <Floodlvl> is the flood threshold and <max> is the record level.
     */
    function parseAlertStation(node) {
        function getText(tag) {
            var el = node.getElementsByTagName(tag)[0];
            return el ? el.textContent.trim() : '';
        }
        function getNum(tag) {
            var v = parseFloat(getText(tag));
            return isNaN(v) ? null : v;
        }
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
        var tzEl = doc.getElementsByTagName('timeZone')[0];
        var hours = tzEl ? parseFloat(tzEl.textContent) : 0;   // FEWS default is GMT
        if (isNaN(hours)) hours = 0;

        var sign = hours < 0 ? '-' : '+';
        var totalMinutes = Math.round(Math.abs(hours) * 60);
        var hh = Math.floor(totalMinutes / 60);
        var mm = totalMinutes % 60;
        return sign + (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm;
    }

    /**
     * Read the FEWS export and attach readings to the matching stations.
     * The file holds one <series> per station and parameter. We use two:
     *   HG   = observed river stage (m)  -> station.measures
     *   SSTG = simulated/forecast stage (m) -> station.forecasts
     * (It also has flow series, Q and SQIN, which the app does not use.)
     */
    function parseFEWS(doc, stations) {
        var seriesList = doc.getElementsByTagName('series');
        var creationDate = null;
        var tzOffset = fewsOffset(doc);

        for (var s = 0; s < seriesList.length; s++) {
            var series = seriesList[s];
            var header = series.getElementsByTagName('header')[0];
            if (!header) continue;

            var locationId = header.getElementsByTagName('locationId')[0];
            var parameterId = header.getElementsByTagName('parameterId')[0];
            if (!locationId || !parameterId) continue;

            var locId = locationId.textContent.trim();
            var paramId = parameterId.textContent.trim();

            if (!creationDate) {
                var cdEl = header.getElementsByTagName('creationDate')[0];
                if (cdEl) creationDate = cdEl.textContent.trim();
            }

            if (paramId !== 'HG' && paramId !== 'SSTG') continue;

            var station = null;
            for (var i = 0; i < stations.length; i++) {
                if (stations[i].stationID === locId) { station = stations[i]; break; }
            }
            if (!station) continue;

            var events = series.getElementsByTagName('event');
            var readings = [];
            for (var e = 0; e < events.length; e++) {
                var ev = events[e];
                var dateStr = ev.getAttribute('date');
                var timeStr = ev.getAttribute('time');
                var val = parseFloat(ev.getAttribute('value'));
                var dt = new Date(dateStr + 'T' + timeStr + tzOffset);
                readings.push({ dtime: dt, wlvl: (val === -999 ? null : val) });
            }

            if (paramId === 'HG') {
                station.measures = readings;
            } else if (paramId === 'SSTG') {
                station.forecasts = readings;
            }
        }

        // Compute current level, staleness, alert level, trend
        stations.forEach(function (station) {
            computeStationStatus(station);
        });

        return { stations: stations, creationDate: creationDate };
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
        var fewsReading = FloodUtils.lastValidReading(station.measures) ||
            station.forecasts.find(function (r) { return r.wlvl != null; }) ||
            null;

        // Note: a forecast-only station counts as fresh, because its last
        // forecast time is in the future.
        var fewsStale = FloodAlerts.isStale(station.measures.length > 0 ? station.measures : station.forecasts);

        // 2. WSC: the latest gauge reading, if it is recent enough
        var wscReading = FloodUtils.lastValidReading(station.wscMeasures);
        var wscFresh = wscReading != null && !FloodAlerts.isStale(station.wscMeasures);

        // 3. Pick the source to show
        var reading;
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
        var m = wscUrl.match(/stn=([A-Z0-9]+)/i);
        return m ? m[1] : null;
    }

    // How far back to fetch WSC readings. Matches the chart's 48h look-back;
    // anything older would count as stale (FloodAlerts STALE_HOURS) anyway.
    var WSC_HISTORY_HOURS = 48;

    /**
     * Fetch the last WSC_HISTORY_HOURS of realtime water-level data for a
     * single WSC station.
     * Returns an array of { dtime, wlvl } readings sorted chronologically.
     */
    function fetchWSCStation(stnNumber) {
        var since = new Date(Date.now() - WSC_HISTORY_HOURS * 3600000).toISOString();
        var url = URLS.wscRealtime
            + '?STATION_NUMBER=' + stnNumber
            + '&datetime=' + since + '/..'           // only readings from 'since' onward
            + '&properties=DATETIME,LEVEL'           // only the two fields we use...
            + '&skipGeometry=true'                   // ...and not the station location
            + '&limit=2000'
            + '&sortby=-DATETIME'
            + '&f=json';

        return fetch(url)
            .then(function (r) {
                if (!r.ok) throw new Error('WSC HTTP ' + r.status);
                return r.json();
            })
            .then(function (geojson) {
                var readings = [];
                if (geojson && geojson.features) {
                    geojson.features.forEach(function (f) {
                        var p = f.properties;
                        if (p && p.DATETIME && p.LEVEL != null) {
                            readings.push({
                                dtime: new Date(p.DATETIME),
                                wlvl: parseFloat(p.LEVEL)
                            });
                        }
                    });
                }
                // Sort chronologically (API returns newest-first)
                readings.sort(function (a, b) { return a.dtime - b.dtime; });
                return readings;
            });
    }

    /**
     * Fetch WSC realtime data for all stations that have a WSC URL.
     * Runs in parallel (max ~25 stations). Failures are silently ignored.
     */
    function fetchAllWSC(stations) {
        var promises = stations.map(function (station) {
            var stnId = extractWSCId(station.wscUrlEn);
            if (!stnId) return Promise.resolve(null);

            return fetchWSCStation(stnId)
                .then(function (readings) {
                    if (readings && readings.length > 0) {
                        station.wscMeasures = readings;
                    }
                    return null;
                })
                .catch(function () {
                    // Silently ignore — station just won't show WSC data
                    return null;
                });
        });

        return Promise.all(promises);
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
    function loadAll() {
        var stationsFromAlerts;

        return Promise.all([
            fetchXML(URLS.alertLevels),
            fetchXML(URLS.fewsExport).catch(function (err) {
                console.warn('FEWS data unavailable:', err.message);
                return null;
            })
        ]).then(function (results) {
            var alertDoc = results[0];
            var fewsDoc = results[1];

            stationsFromAlerts = parseAlertLevels(alertDoc);

            var creationDate = null;
            if (fewsDoc) {
                var fewsResult = parseFEWS(fewsDoc, stationsFromAlerts);
                creationDate = fewsResult.creationDate;
            }

            // Fetch WSC realtime data (CORS-enabled API) for all stations with a WSC URL
            return fetchAllWSC(stationsFromAlerts).then(function () {
                // Recompute status for stations that gained WSC data
                stationsFromAlerts.forEach(function (station) {
                    if (station.wscMeasures && station.wscMeasures.length > 0) {
                        computeStationStatus(station);
                    }
                });
                return {
                    stations: stationsFromAlerts,
                    creationDate: creationDate
                };
            });
        });
    }

    return {
        loadAll: loadAll
    };
})();
