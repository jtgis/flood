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
     * Compute current level, staleness, alert level, and trend for a station.
     * Falls back to WSC realtime data when FEWS data is stale or missing.
     * If all data is stale, alert level is forced to 'nodata'.
     */
    function computeStationStatus(station) {
        var level = null;
        var lastReadingTime = null;

        // Current level = last valid measured reading
        if (station.measures.length > 0) {
            for (var i = station.measures.length - 1; i >= 0; i--) {
                if (station.measures[i].wlvl != null) {
                    level = station.measures[i].wlvl;
                    lastReadingTime = station.measures[i].dtime;
                    break;
                }
            }
        }
        // Fallback to first valid forecast
        if (level == null && station.forecasts.length > 0) {
            for (var j = 0; j < station.forecasts.length; j++) {
                if (station.forecasts[j].wlvl != null) {
                    level = station.forecasts[j].wlvl;
                    lastReadingTime = station.forecasts[j].dtime;
                    break;
                }
            }
        }

        // Check staleness of FEWS data
        var fewsStale = FloodAlerts.isStale(station.measures.length > 0 ? station.measures : station.forecasts);

        // Fallback to WSC realtime data if FEWS is stale or has no level
        var wscLevel = null;
        var wscTime = null;
        var wscStale = true;
        if (station.wscMeasures && station.wscMeasures.length > 0) {
            wscStale = FloodAlerts.isStale(station.wscMeasures);
            for (var k = station.wscMeasures.length - 1; k >= 0; k--) {
                if (station.wscMeasures[k].wlvl != null) {
                    wscLevel = station.wscMeasures[k].wlvl;
                    wscTime = station.wscMeasures[k].dtime;
                    break;
                }
            }
        }

        // Use WSC data if FEWS data is stale/missing but WSC is fresh
        if ((fewsStale || level == null) && wscLevel != null && !wscStale) {
            level = wscLevel;
            lastReadingTime = wscTime;
            station.isStale = false;
            station.dataSource = 'wsc';
        } else {
            station.isStale = fewsStale;
            station.dataSource = fewsStale ? 'none' : 'fews';
        }

        station.currentLevel = level;
        station.lastReadingTime = lastReadingTime;

        if (station.isStale) {
            station.alertLevel = 'nodata';
        } else {
            station.alertLevel = FloodAlerts.getAlertLevel(level, station.thresholds);
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
