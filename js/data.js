/* ==========================================================================
   data.js - Fetch & parse all data sources (with stale data detection)
   ========================================================================== */

var FloodData = (function () {
    'use strict';

    var PROXY_BASE = '';

    var URLS = {
        alertLevels: 'https://geonb.snb.ca/rwm/flood/alertlevels.xml',
        fewsExport:  'https://geonb.snb.ca/rwm/flood/StJohn_FEWSNB_export.xml',
        ecHourly:    'https://dd.weather.gc.ca/today/hydrometric/csv/NB/hourly/NB_hourly_hydrometric.csv',
        wscRealtime: 'https://api.weather.gc.ca/collections/hydrometric-realtime/items'
    };

    function proxyUrl(url) {
        if (!PROXY_BASE) return url;
        return PROXY_BASE + '?url=' + encodeURIComponent(url);
    }

    function fetchXML(url) {
        return fetch(proxyUrl(url))
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status + ' fetching ' + url);
                return r.text();
            })
            .then(function (text) {
                text = text.replace(/\s+xmlns\s*=\s*"[^"]*"/g, '');
                return new DOMParser().parseFromString(text, 'application/xml');
            });
    }

    function fetchCSV(url) {
        return fetch(url)
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status + ' fetching ' + url);
                return r.text();
            })
            .then(function (text) {
                var lines = text.trim().split('\n');
                return lines.map(function (line) {
                    var result = [];
                    var current = '';
                    var inQuote = false;
                    for (var i = 0; i < line.length; i++) {
                        var ch = line[i];
                        if (ch === '"') { inQuote = !inQuote; }
                        else if (ch === ',' && !inQuote) { result.push(current.trim()); current = ''; }
                        else { current += ch; }
                    }
                    result.push(current.trim());
                    return result;
                });
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
            hasMeasured:  getText('Measured') === 'YES',
            hasForecast:  getText('Forecast') === 'YES',
            wscUrlEn:     getText('WSC_URL_EN'),
            wscUrlFr:     getText('WSC_URL_FR'),
            measures:     [],
            forecasts:    [],
            currentLevel: null,
            alertLevel:   'nodata',
            trend:        { direction: 'stable', rate: 0 },
            issuedDate:   null,
            isStale:      true
        };
    }

    // -- Parse FEWS export XML --

    function parseFEWS(doc, stations) {
        var seriesList = doc.getElementsByTagName('series');
        var creationDate = null;

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
                var dt = new Date(dateStr + 'T' + timeStr);
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
     * Falls back to WSC realtime data when FEWS/EC data is stale or missing.
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

        // Check staleness of FEWS/EC data
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

        if (station.isStale && !(wscLevel != null && !wscStale)) {
            station.alertLevel = 'nodata';
        } else {
            station.alertLevel = FloodAlerts.getAlertLevel(level, station.thresholds);
        }

        station.trend = FloodUtils.computeTrend(
            station.dataSource === 'wsc' ? station.wscMeasures : station.measures
        );
    }

    // -- Parse EC Datamart CSV --

    function parseECHourly(rows) {
        if (rows.length < 2) return {};
        var byStation = {};
        for (var i = 1; i < rows.length; i++) {
            var row = rows[i];
            if (row.length < 3) continue;
            var id = row[0];
            var dt = new Date(row[1]);
            var wl = parseFloat(row[2]);
            var discharge = parseFloat(row[6]);
            if (!byStation[id]) byStation[id] = [];
            byStation[id].push({
                dtime: dt,
                wlvl: isNaN(wl) ? null : wl,
                discharge: isNaN(discharge) ? null : discharge
            });
        }
        return byStation;
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

    /**
     * Fetch last 7 days of realtime water-level data for a single WSC station.
     * Returns an array of { dtime, wlvl } readings sorted chronologically.
     */
    function fetchWSCStation(stnNumber) {
        var url = URLS.wscRealtime
            + '?STATION_NUMBER=' + stnNumber
            + '&limit=2000'
            + '&sortby=-DATETIME'
            + '&f=json';

        return fetch(proxyUrl(url))
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
            }),
            fetchCSV(URLS.ecHourly).catch(function (err) {
                console.warn('EC hourly unavailable:', err.message);
                return null;
            })
        ]).then(function (results) {
            var alertDoc = results[0];
            var fewsDoc = results[1];
            var ecRows = results[2];

            stationsFromAlerts = parseAlertLevels(alertDoc);

            var creationDate = null;
            if (fewsDoc) {
                var fewsResult = parseFEWS(fewsDoc, stationsFromAlerts);
                creationDate = fewsResult.creationDate;
            }

            var ecData = ecRows ? parseECHourly(ecRows) : {};

            // Supplement with EC data where FEWS is missing
            stationsFromAlerts.forEach(function (station) {
                if (station.measures.length === 0 && station.wscUrlEn && station.wscUrlEn !== 'NONE') {
                    var match = station.wscUrlEn.match(/stn=([A-Z0-9]+)/i);
                    if (match && ecData[match[1]]) {
                        station.measures = ecData[match[1]];
                        computeStationStatus(station);
                    }
                }
            });

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
                    creationDate: creationDate,
                    ecData: ecData
                };
            });
        });
    }

    return {
        loadAll: loadAll,
        URLS: URLS
    };
})();
