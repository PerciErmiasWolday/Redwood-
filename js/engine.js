/*
 * Redwood Relocation Guide: scoring engine.
 *
 * Pure functions only (no page code), so the same file runs in the browser and in
 * Node tests (`node --test tests/`). Everything the engine knows comes from
 * data/settings.json and the CSV files, so the team can swap data without touching code.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RedwoodEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EPS = 1e-6;

  // ---------------------------------------------------------------- CSV

  /** Quote-aware CSV parser. Handles a byte-order mark, quoted commas and CRLF. */
  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const rows = [];
    let row = [], field = '', inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += ch;
      } else if (ch === '"') inQuotes = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (row.length > 1 || row[0] !== '') rows.push(row);
        row = [];
      } else field += ch;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    const header = (rows.shift() || []).map(h => h.trim());
    const records = rows.map(r => {
      const o = {};
      header.forEach((h, j) => { o[h] = r[j] === undefined ? '' : r[j].trim(); });
      return o;
    });
    return { header, rows: records };
  }

  const keyOf = (city, state) => `${city}|${state}`;
  const num = v => {
    if (v === undefined || v === null) return NaN;
    const s = String(v).trim();
    if (s === '' || /^(na|nan|null|none)$/i.test(s)) return NaN;
    return Number(s.replace(/[$,]/g, ''));
  };

  // ---------------------------------------------------------------- geography

  function haversineMiles(lat1, lon1, lat2, lon2) {
    const R = 3958.8, r = Math.PI / 180;
    const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  }

  /** Albers equal-area projection, identical to tools/build_map.py. */
  function project(lon, lat, p) {
    const rad = Math.PI / 180;
    const phi1 = p.p1 * rad, phi2 = p.p2 * rad, phi0 = p.lat0 * rad;
    const n = (Math.sin(phi1) + Math.sin(phi2)) / 2;
    const c = Math.cos(phi1) ** 2 + 2 * n * Math.sin(phi1);
    const rho0 = Math.sqrt(c - 2 * n * Math.sin(phi0)) / n;
    const rho = Math.sqrt(c - 2 * n * Math.sin(lat * rad)) / n;
    const theta = n * (lon - p.lon0) * rad;
    const x = rho * Math.sin(theta), y = rho0 - rho * Math.cos(theta);
    return [(x - p.minx) * p.scale, (p.maxy - y) * p.scale];
  }

  // ---------------------------------------------------------------- dataset

  /**
   * Build everything the app needs from raw file text.
   * @param {object} input { settings, groupTexts: {groupId: csvText|null}, locationsText, sourcesText }
   */
  function buildDataset(input) {
    const settings = input.settings;
    const cities = new Map();
    for (const r of parseCSV(input.locationsText).rows) {
      cities.set(keyOf(r.City, r.State), {
        key: keyOf(r.City, r.State), city: r.City, state: r.State, county: r.County,
        lat: num(r.Lat), lon: num(r.Lon), population2010: num(r.Population_2010),
      });
    }

    // Age-group files: parsed once, reused for scores and for features.
    const groupRows = {};
    const groups = [];
    for (const [gid, g] of Object.entries(settings.groups)) {
      const text = input.groupTexts[gid];
      const entry = { id: gid, label: g.label, weight: g.weight ?? 1, scores: new Map(), status: 'ok', message: '' };
      if (text == null) {
        entry.status = 'missing-file';
        entry.message = `${g.label}: file not found (${g.file}).`;
        groups.push(entry);
        continue;
      }
      let parsed;
      try { parsed = parseCSV(text); } catch (e) { parsed = { header: [], rows: [] }; }
      groupRows[gid] = parsed;
      if (!parsed.header.includes(g.score_column)) {
        entry.status = 'missing-score';
        entry.message = `${g.label}: no "${g.score_column}" column yet, so this group is not in the average.`;
      } else {
        for (const r of parsed.rows) {
          const s = num(r[g.score_column]);
          const k = keyOf(r.City, r.State);
          if (Number.isFinite(s) && cities.has(k)) entry.scores.set(k, s);
        }
        if (entry.scores.size === 0) {
          entry.status = 'missing-score';
          entry.message = `${g.label}: the score column is empty, so this group is not in the average.`;
        }
      }
      groups.push(entry);
    }

    const active = groups.filter(g => g.status === 'ok');
    const combined = [];
    for (const c of cities.values()) {
      let sum = 0, wsum = 0;
      const byGroup = {};
      for (const g of active) {
        if (g.scores.has(c.key)) {
          const s = g.scores.get(c.key);
          byGroup[g.id] = s; sum += s * g.weight; wsum += g.weight;
        }
      }
      if (wsum > 0) combined.push({ key: c.key, city: c.city, state: c.state, avg: sum / wsum, n: Object.keys(byGroup).length, byGroup });
    }
    combined.sort((a, b) => b.avg - a.avg || a.key.localeCompare(b.key));
    combined.forEach((r, i) => { r.rank = i + 1; });

    // Feature values for all cities, plus where each value came from.
    const sources = new Map();
    if (input.sourcesText) {
      for (const r of parseCSV(input.sourcesText).rows) sources.set(keyOf(r.City, r.State), r);
    }
    const features = {};
    for (const [fid, f] of Object.entries(settings.features)) {
      const rows = groupRows[f.group];
      const values = new Map(), src = new Map();
      if (rows && rows.header.includes(f.column)) {
        for (const r of rows.rows) {
          const k = keyOf(r.City, r.State);
          const v = num(r[f.column]);
          if (!cities.has(k) || !Number.isFinite(v)) continue;
          values.set(k, v);
          const s = sources.get(k);
          src.set(k, s && s[f.column] ? s[f.column] : 'as submitted');
        }
      }
      const vals = [...values.values()];
      features[fid] = {
        id: fid, ...f, values, sources: src, available: vals.length > 0,
        min: vals.length ? Math.min(...vals) : NaN, max: vals.length ? Math.max(...vals) : NaN,
      };
    }

    const ds = { settings, cities, groups, combined, features };
    const pick = pickOffices(ds);
    ds.offices = pick.offices;
    ds.skipped = pick.skipped;
    return ds;
  }

  /** Greedy pick down the combined average, keeping offices at least N miles apart. */
  function pickOffices(ds) {
    const s = ds.settings;
    const exclude = new Set((s.exclude_cities || []).map(x => x.replace(/,\s*/, '|')));
    const override = (s.office_override || []).map(x => x.replace(/,\s*/, '|'));
    const offices = [], skipped = [];
    const byKey = new Map(ds.combined.map(r => [r.key, r]));
    if (override.length) {
      for (const k of override) {
        const r = byKey.get(k), c = ds.cities.get(k);
        if (c) offices.push({ ...(r || { key: k, city: c.city, state: c.state, avg: NaN, rank: NaN, n: 0, byGroup: {} }), override: true });
      }
      return { offices, skipped };
    }
    for (const r of ds.combined) {
      if (offices.length >= s.offices) break;
      if (exclude.has(r.key)) { skipped.push({ ...r, reason: 'excluded in settings' }); continue; }
      const c = ds.cities.get(r.key);
      let near = null;
      for (const o of offices) {
        const oc = ds.cities.get(o.key);
        const d = haversineMiles(c.lat, c.lon, oc.lat, oc.lon);
        if (d < s.min_miles_between_offices) { near = { office: o, miles: d }; break; }
      }
      if (near) { skipped.push({ ...r, reason: `${Math.round(near.miles)} miles from ${near.office.city}`, near: near.office.key, miles: near.miles }); continue; }
      offices.push({ ...r });
    }
    return { offices, skipped };
  }

  // ---------------------------------------------------------------- weights

  const sum = arr => arr.reduce((a, b) => a + b, 0);

  function measurableCategories(settings, ds) {
    return settings.categories.filter(c =>
      Object.keys(c.features).some(f => !ds || (ds.features[f] && ds.features[f].available)));
  }

  /**
   * Category weights for an employee.
   * ranked: up to three category ids, most important first (qualitative ids are ignored).
   * Returns { weights, method, label, note, total }.
   */
  function categoryWeights(settings, answers, ds) {
    const cats = measurableCategories(settings, ds).map(c => c.id);
    const ranked = (answers.ranked || []).filter(id => cats.includes(id));
    let weights = {}, method, label, note = '';

    if (ranked.length === 3 && cats.length >= 4) {
      const p = settings.presets[answers.strength] || settings.presets.balanced;
      const rest = cats.filter(c => !ranked.includes(c));
      weights[ranked[0]] = p.first; weights[ranked[1]] = p.second; weights[ranked[2]] = p.third;
      for (const c of rest) weights[c] = p.rest / rest.length;
      method = 'ranked';
      label = `${p.label} preset`;
    } else if (answers.age && settings.age_profiles[answers.age]) {
      const prof = settings.age_profiles[answers.age];
      const raw = Object.fromEntries(Object.entries(prof.raw).filter(([c]) => cats.includes(c)));
      const t = sum(Object.values(raw));
      for (const [c, w] of Object.entries(raw)) weights[c] = (w / t) * 100;
      method = 'age';
      label = prof.label;
      note = prof.note;
    } else {
      const t = cats.length;
      for (const c of cats) weights[c] = 100 / t;
      method = 'neutral';
      label = settings.neutral_profile.label;
      note = settings.neutral_profile.note;
    }
    for (const c of cats) if (!(c in weights)) weights[c] = 0;
    const total = sum(Object.values(weights));
    if (Math.abs(total - 100) > EPS) throw new Error(`Category weights add to ${total}, not 100`);
    return { weights, method, label, note, total, ranked };
  }

  /** Split each category's weight across its features in proportion to the original weights. */
  function featureWeights(settings, catWeights, ds) {
    const out = {};
    for (const c of settings.categories) {
      const w = catWeights[c.id] || 0;
      const feats = Object.entries(c.features).filter(([f]) => !ds || ds.features[f].available);
      const orig = sum(feats.map(([, v]) => v));
      for (const [f, v] of feats) out[f] = orig > 0 ? w * (v / orig) : 0;
    }
    const total = sum(Object.values(out));
    if (Math.abs(total - sum(Object.values(catWeights))) > EPS) throw new Error('Feature weights do not match category weights');
    return out;
  }

  function climateTargets(settings, answers) {
    const cl = settings.climate;
    const w = cl.winter.find(o => o.id === answers.winter);
    const s = cl.summer.find(o => o.id === answers.summer);
    return {
      winter: w ? w.target : cl.default_winter,
      summer: s ? s.target : cl.default_summer,
      winterChosen: !!w, summerChosen: !!s,
    };
  }

  // ---------------------------------------------------------------- scoring

  function targetFor(f, targets) {
    if (f.better !== 'target') return null;
    return f.target_from === 'winter' ? targets.winter : f.target_from === 'summer' ? targets.summer : f.target;
  }

  /**
   * Normalized score 0–100 against all 500 cities (100 = best).
   * Target features score by distance from the preferred value, min-max across all cities.
   */
  function normalized(ds, fid, key, targets) {
    const f = ds.features[fid];
    const v = f.values.get(key);
    if (!Number.isFinite(v)) return NaN;
    if (f.better === 'target') {
      const t = targetFor(f, targets);
      const cacheKey = `${fid}@${t}`;
      ds._dist = ds._dist || {};
      if (!ds._dist[cacheKey]) {
        const d = [...f.values.values()].map(x => Math.abs(x - t));
        ds._dist[cacheKey] = { min: Math.min(...d), max: Math.max(...d) };
      }
      const { min, max } = ds._dist[cacheKey];
      return max === min ? 100 : 100 - ((Math.abs(v - t) - min) / (max - min)) * 100;
    }
    if (f.max === f.min) return 100;
    const s = ((v - f.min) / (f.max - f.min)) * 100;
    return f.better === 'lower' ? 100 - s : s;
  }

  /** Share of the 500 cities (0–100) that this city does better than on a feature. */
  function percentile(ds, fid, key, targets) {
    const mine = normalized(ds, fid, key, targets);
    let below = 0, n = 0;
    for (const k of ds.features[fid].values.keys()) {
      const s = normalized(ds, fid, k, targets);
      n++;
      if (s < mine - EPS) below++;
    }
    return n ? (below / n) * 100 : NaN;
  }

  function scoreCity(ds, key, catW, featW, targets) {
    const rows = [];
    const byCat = {};
    for (const c of ds.settings.categories) {
      byCat[c.id] = 0;
      for (const fid of Object.keys(c.features)) {
        const f = ds.features[fid];
        if (!f.available) continue;
        const w = featW[fid] || 0;
        const norm = normalized(ds, fid, key, targets);
        if (!Number.isFinite(norm)) throw new Error(`Missing ${fid} for ${key}`);
        const contrib = (norm * w) / 100;
        byCat[c.id] += contrib;
        rows.push({
          category: c.id, feature: fid, label: f.label, raw: f.values.get(key),
          source: f.sources.get(key) || 'as submitted', target: targetFor(f, targets),
          norm, weight: w, contrib,
        });
      }
    }
    return { key, total: sum(rows.map(r => r.contrib)), rows, byCat };
  }

  /** Main entry: score and order the offices for one employee's answers. */
  function rankOffices(ds, answers) {
    const settings = ds.settings;
    const cw = categoryWeights(settings, answers, ds);
    const fw = featureWeights(settings, cw.weights, ds);
    const targets = climateTargets(settings, answers);
    const results = ds.offices.map(o => {
      const s = scoreCity(ds, o.key, cw.weights, fw, targets);
      return { ...s, office: o, city: ds.cities.get(o.key) };
    });
    results.sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
    results.forEach((r, i) => { r.position = i + 1; });
    const gap = results.length > 1 ? results[0].total - results[1].total : Infinity;
    const out = {
      categoryWeights: cw, featureWeights: fw, targets, results, gap,
      closeCall: gap < settings.close_call_points,
    };
    for (const r of results) {
      r.reasons = reasons(ds, r, cw, targets);
      r.tradeoff = tradeoff(ds, r, targets);
      r.milesFromHQ = haversineMiles(r.city.lat, r.city.lon, settings.headquarters.lat, settings.headquarters.lon);
      r.standouts = standouts(ds, r, results, cw, targets);
    }
    return out;
  }

  // ---------------------------------------------------------------- explanations

  function formatValue(f, v) {
    if (!Number.isFinite(v)) return 'not available';
    const [kind, d] = String(f.format || 'number:1').split(':');
    const digits = d === undefined ? 1 : Number(d);
    const n = (x, k) => x.toLocaleString('en-US', { minimumFractionDigits: k, maximumFractionDigits: k });
    switch (kind) {
      case 'usd': return '$' + n(Math.round(v), 0);
      case 'percent': return n(v, digits) + '%';
      case 'share': return n(v * 100, digits) + '%';
      case 'degrees': return n(v, 0) + '°F';
      case 'years': return n(v, digits) + ' years';
      default: return n(v, digits);
    }
  }

  /** Plain-language comparison against the 500 cities, e.g. "lower than 82% of the 500 cities". */
  function compareLine(ds, fid, key, targets) {
    const f = ds.features[fid];
    const p = percentile(ds, fid, key, targets);
    const total = f.values.size;
    const norm = normalized(ds, fid, key, targets);
    if (norm >= 100 - EPS && f.better !== 'target') {
      const ties = [...f.values.keys()].filter(k => normalized(ds, fid, k, targets) >= 100 - EPS).length;
      const word = f.good === 'lower' ? 'lowest' : 'highest';
      return ties > 1 ? `tied for the ${word} of the ${total} cities (${ties} cities share it)` : `the ${word} of the ${total} cities`;
    }
    if (f.better === 'target') {
      const t = targetFor(f, targets);
      const chosen = f.target_from === 'winter' ? targets.winterChosen : f.target_from === 'summer' ? targets.summerChosen : false;
      const goal = chosen ? `your ${t}°F` : `${t}°F`;
      const closer = Math.round(p);
      return closer >= 50 ? `closer to ${goal} than ${closer}% of the ${total} cities`
        : `further from ${goal} than ${100 - closer}% of the ${total} cities`;
    }
    if (p >= 99.5) return `one of the ${f.good === 'lower' ? 'lowest' : 'highest'} of the ${total} cities`;
    if (p >= 50) return `${f.good} than ${Math.round(p)}% of the ${total} cities`;
    const worse = 100 - p;
    if (worse >= 99.5) return `one of the ${f.bad === 'higher' ? 'highest' : 'lowest'} of the ${total} cities`;
    return `${f.bad} than ${Math.round(worse)}% of the ${total} cities`;
  }

  function factLine(ds, fid, key, targets) {
    const f = ds.features[fid];
    return `${f.label}: ${formatValue(f, f.values.get(key))}, ${compareLine(ds, fid, key, targets)}`;
  }

  /** Two measurable reasons a city scored well: its biggest contributions with a strong score. */
  function reasons(ds, r, cw, targets) {
    return r.rows
      .filter(x => x.weight > 0 && x.norm >= 60 && percentile(ds, x.feature, r.key, targets) >= 60)
      .sort((a, b) => b.contrib - a.contrib)
      .slice(0, 2)
      .map(x => ({ feature: x.feature, category: x.category, text: factLine(ds, x.feature, r.key, targets) }));
  }

  /**
   * The trade-off: among the measures the employee weighted, the one where the city is worse
   * than most of the 500 cities and that costs it the most points. If it beats most cities on
   * everything, report its weakest measure as a mild trade-off.
   */
  function tradeoff(ds, r, targets) {
    const used = new Set((r.reasons || []).map(x => x.feature));
    const cands = r.rows
      .filter(x => x.weight > 0 && !used.has(x.feature))
      .map(x => ({ ...x, lost: ((100 - x.norm) * x.weight) / 100, pct: percentile(ds, x.feature, r.key, targets) }));
    if (!cands.length) return null;
    const weak = cands.filter(x => x.pct < 50 && x.lost >= 0.25).sort((a, b) => b.lost - a.lost)[0];
    const pick = weak || cands.filter(x => x.weight >= 1).sort((a, b) => a.pct - b.pct)[0] || cands.sort((a, b) => a.pct - b.pct)[0];
    return {
      feature: pick.feature, category: pick.category, lost: pick.lost, mild: !weak,
      text: factLine(ds, pick.feature, r.key, targets),
    };
  }

  const lcFirst = s => (/^[A-Z]{2}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));

  /**
   * What each office does best: measures where it beats all four other offices and is
   * better than most of the 500 cities. Falls back to its strongest measures overall.
   * The employee's top categories come first.
   */
  function standouts(ds, r, results, cw, targets, limit = 3) {
    const ranked = cw.ranked || [];
    const best = [], strong = [];
    for (const c of ds.settings.categories) {
      for (const fid of Object.keys(c.features)) {
        const f = ds.features[fid];
        if (!f.available) continue;
        const mine = normalized(ds, fid, r.key, targets);
        const pr = percentile(ds, fid, r.key, targets);
        const priority = ranked.includes(c.id) ? 3 - ranked.indexOf(c.id) : 0;
        const value = formatValue(f, f.values.get(r.key));
        const others = results.filter(o => o.key !== r.key).map(o => normalized(ds, fid, o.key, targets));
        const beatsAll = others.length > 0 && others.every(s => mine > s + EPS);
        if (beatsAll && pr >= 50) {
          best.push({ kind: 'best-of-five', feature: fid, category: c.id, percentile: pr, priority,
            text: `Best of the five offices for ${lcFirst(f.label)}: ${value}, ${compareLine(ds, fid, r.key, targets)}` });
        } else if (pr >= 75) {
          strong.push({ kind: 'strong', feature: fid, category: c.id, percentile: pr, priority,
            text: `${f.label}: ${value}, ${compareLine(ds, fid, r.key, targets)}` });
        }
      }
    }
    const order = (a, b) => b.priority - a.priority || b.percentile - a.percentile;
    best.sort(order); strong.sort(order);
    return [...best, ...strong].slice(0, limit);
  }

  /** Values for one feature across the offices, for the "biggest concern" check. */
  function concernTable(ds, rank, fid) {
    const f = ds.features[fid];
    return rank.results.map(r => ({
      key: r.key, city: r.city.city, state: r.city.state, raw: f.values.get(r.key),
      text: formatValue(f, f.values.get(r.key)),
      norm: normalized(ds, fid, r.key, rank.targets),
      percentile: percentile(ds, fid, r.key, rank.targets),
      compare: compareLine(ds, fid, r.key, rank.targets),
      source: f.sources.get(r.key) || 'as submitted',
    }));
  }

  /** The evidence package sent to the AI guide (and used by the local summary). */
  function evidence(ds, answers, rank, content) {
    const s = ds.settings;
    const catLabel = id => (s.categories.find(c => c.id === id) || {}).label || id;
    return {
      employee_answers: answers,
      weighting: {
        method: rank.categoryWeights.method, label: rank.categoryWeights.label, note: rank.categoryWeights.note,
        category_weights: Object.fromEntries(Object.entries(rank.categoryWeights.weights).map(([k, v]) => [catLabel(k), round(v, 1)])),
        climate_targets_f: { january: rank.targets.winter, july: rank.targets.summer },
      },
      ranking: rank.results.map(r => ({
        position: r.position, city: `${r.city.city}, ${r.city.state}`, score: round(r.total, 1),
        miles_from_chicago: Math.round(haversineMiles(r.city.lat, r.city.lon, s.headquarters.lat, s.headquarters.lon)),
        reasons: r.reasons.map(x => x.text), tradeoff: r.tradeoff && r.tradeoff.text,
        best_of_five: r.standouts.map(x => x.text),
        measures: r.rows.map(x => ({ measure: x.label, value: formatValue(ds.features[x.feature], x.raw), source: x.source, score_0_100: round(x.norm, 1), weight: round(x.weight, 2) })),
        city_guide: content && content[r.key] ? content[r.key].facts.map(f => f.text) : [],
      })),
      close_call: rank.closeCall, gap_points: round(rank.gap, 2),
      limits: [
        'Scores compare the 500 cities with each other under the employee\'s chosen weights; they are not guarantees.',
        'Most measures are county values applied to a city. Some values are estimates; each measure lists its source.',
        'No data on school quality, actual rents or home prices, job openings, nightlife, or Redwood office details.',
      ],
    };
  }

  const round = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

  return {
    parseCSV, keyOf, num, haversineMiles, project, buildDataset, pickOffices,
    measurableCategories, categoryWeights, featureWeights, climateTargets,
    normalized, percentile, scoreCity, rankOffices, formatValue, compareLine, factLine,
    concernTable, evidence, round,
  };
});
