// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const E = require('../js/engine.js');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

function load(settingsPatch = {}, groupOverrides = {}) {
  const settings = { ...JSON.parse(read('data/settings.json')), ...settingsPatch };
  const groupTexts = {};
  for (const [id, g] of Object.entries(settings.groups)) {
    if (id in groupOverrides) { groupTexts[id] = groupOverrides[id]; continue; }
    const p = path.join(ROOT, g.file);
    groupTexts[id] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  }
  return E.buildDataset({
    settings, groupTexts,
    locationsText: read('data/city_locations.csv'),
    sourcesText: read('data/feature_sources.csv'),
  });
}

const ds = load();
const settings = ds.settings;
const close = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≠ ${b}`);
const sumOf = o => Object.values(o).reduce((a, b) => a + b, 0);

test('CSV parser handles quotes, commas, BOM and CRLF', () => {
  const t = '﻿A,"B, with comma",C\r\n1,"say ""hi""",3\r\n';
  const { header, rows } = E.parseCSV(t);
  assert.deepEqual(header, ['A', 'B, with comma', 'C']);
  assert.equal(rows[0]['B, with comma'], 'say "hi"');
  assert.equal(rows.length, 1);
});

test('settings only reference features and categories that exist', () => {
  for (const c of settings.categories) for (const f of Object.keys(c.features)) assert.ok(settings.features[f], f);
  const ids = settings.categories.map(c => c.id);
  for (const p of Object.values(settings.age_profiles)) for (const c of Object.keys(p.raw)) assert.ok(ids.includes(c), c);
  for (const c of Object.values(settings.concerns)) for (const f of c.features) assert.ok(settings.features[f], f);
  for (const p of Object.values(settings.presets)) close(p.first + p.second + p.third + p.rest, 100);
});

test('all 500 cities load with coordinates and every scored feature', () => {
  assert.equal(ds.cities.size, 500);
  for (const c of ds.cities.values()) assert.ok(Number.isFinite(c.lat) && Number.isFinite(c.lon), c.key);
  for (const f of Object.values(ds.features)) assert.equal(f.values.size, 500, f.id);
});

test('office selection: current five, distance rule respected, 50–60 waits for a Score column', () => {
  assert.deepEqual(ds.offices.map(o => o.key), ['Overland Park|KS', 'Fishers|IN', 'Frisco|TX', 'Naperville|IL', 'Ann Arbor|MI']);
  assert.equal(ds.groups.find(g => g.id === '50-60').status, 'missing-score');
  for (const a of ds.offices) for (const b of ds.offices) {
    if (a.key === b.key) continue;
    const ca = ds.cities.get(a.key), cb = ds.cities.get(b.key);
    assert.ok(E.haversineMiles(ca.lat, ca.lon, cb.lat, cb.lon) >= settings.min_miles_between_offices);
  }
  assert.ok(ds.skipped.some(s => s.key === 'Olathe|KS'));
});

test('offices never change with employee answers', () => {
  const before = ds.offices.map(o => o.key).sort();
  for (const a of [{ ranked: ['weather', 'safety', 'health'], strength: 'main', winter: 'warm' }, { age: '20-30' }, {}]) {
    const r = E.rankOffices(ds, a);
    assert.deepEqual(r.results.map(x => x.key).sort(), before);
  }
});

test('adding a Score column to the 50–60 file adds that group to the average', () => {
  const lines = read('data/groups/age_50_60.csv').replace(/^﻿/, '').trim().split(/\r?\n/);
  const patched = [lines[0] + ',Score', ...lines.slice(1).map((l, i) => l + ',' + (90 - i * 0.1).toFixed(2))].join('\n');
  const d2 = load({}, { '50-60': patched });
  assert.equal(d2.groups.find(g => g.id === '50-60').status, 'ok');
  assert.ok(d2.combined.every(r => r.n === 4));
});

test('a missing file is skipped, not fatal; office_override pins the list', () => {
  const d2 = load({}, { '20-30': null });
  assert.equal(d2.groups.find(g => g.id === '20-30').status, 'missing-file');
  assert.equal(d2.offices.length, 5);
  const d3 = load({ office_override: ['Carmel, IN', 'Frisco, TX'] });
  assert.deepEqual(d3.offices.map(o => o.key), ['Carmel|IN', 'Frisco|TX']);
});

test('all three presets give 30/23/17, 40/25/15, 50/25/15 and split the rest evenly', () => {
  const ranked = ['housing', 'financial', 'safety'];
  const expect = { balanced: [30, 23, 17, 6], strong: [40, 25, 15, 4], main: [50, 25, 15, 2] };
  for (const [preset, [a, b, c, rest]] of Object.entries(expect)) {
    const { weights } = E.categoryWeights(settings, { ranked, strength: preset }, ds);
    assert.equal(weights.housing, a); assert.equal(weights.financial, b); assert.equal(weights.safety, c);
    for (const id of ['career', 'commute', 'health', 'environment', 'weather']) close(weights[id], rest);
    close(sumOf(weights), 100);
  }
});

test('feature weights split each category proportionally and total 100', () => {
  const { weights } = E.categoryWeights(settings, { ranked: ['housing', 'financial', 'safety'], strength: 'strong' }, ds);
  const fw = E.featureWeights(settings, weights, ds);
  close(fw.housing_costs, 24); close(fw.housing_problems, 16);       // 40 × 15/25 and 40 × 10/25
  close(fw.cost_of_living, 25 * 12 / 25); close(fw.median_income, 25 * 8 / 25); close(fw.poverty_rate, 25 * 5 / 25);
  close(sumOf(fw), 100);
});

test('household, home plans, trade-offs, concerns and needs never change scores', () => {
  const base = { ranked: ['career', 'housing', 'health'], strength: 'balanced', winter: 'mild', summer: 'warm' };
  const ref = E.rankOffices(ds, base).results.map(r => [r.key, r.total]);
  const variants = [
    { household: 'partner_children' }, { household: 'just_me' }, { home: 'buy_first' }, { home: 'rent' },
    { tradeoff: 'pay_more_career' }, { concern: 'crime' }, { feelHome: 'schools' }, { needs: ['schools', 'partner_job'] },
    { age: '50-60' }, { alsoMatters: ['recreation'] },
  ];
  for (const v of variants) {
    const got = E.rankOffices(ds, { ...base, ...v }).results.map(r => [r.key, r.total]);
    assert.deepEqual(got, ref, JSON.stringify(v));
  }
});

test('recreation is qualitative: ranking it cannot affect the score', () => {
  const a = E.categoryWeights(settings, { ranked: ['recreation', 'housing', 'safety', 'health'], strength: 'strong' }, ds);
  const b = E.categoryWeights(settings, { ranked: ['housing', 'safety', 'health'], strength: 'strong' }, ds);
  assert.equal(a.method, 'ranked');
  assert.ok(!('recreation' in a.weights));
  assert.deepEqual(a.weights, b.weights);
  close(sumOf(a.weights), 100);
});

test('a score equals the sum of its feature contributions and can be rebuilt by hand', () => {
  const r = E.rankOffices(ds, { ranked: ['housing', 'financial', 'safety'], strength: 'strong' });
  for (const x of r.results) {
    close(x.total, sumOf(Object.fromEntries(x.rows.map((row, i) => [i, row.contrib]))));
    close(x.total, sumOf(x.byCat));
  }
  // Manual rebuild of Fishers' housing-cost contribution.
  const f = ds.features.housing_costs;
  const v = f.values.get('Fishers|IN');
  const norm = 100 - ((v - f.min) / (f.max - f.min)) * 100;
  const row = r.results.find(x => x.key === 'Fishers|IN').rows.find(x => x.feature === 'housing_costs');
  close(row.norm, norm); close(row.contrib, norm * 24 / 100);
});

test('zero-weight features have no influence', () => {
  const s2 = structuredClone(settings);
  s2.categories.find(c => c.id === 'housing').features.housing_problems = 0;
  const d2 = { ...ds, settings: s2 };
  const r = E.rankOffices(d2, { ranked: ['housing', 'financial', 'safety'], strength: 'strong' });
  for (const x of r.results) {
    const row = x.rows.find(y => y.feature === 'housing_problems');
    assert.equal(row.weight, 0); assert.equal(row.contrib, 0);
  }
});

test('changing priorities recalculates the order', () => {
  const a = E.rankOffices(ds, { ranked: ['housing', 'financial', 'safety'], strength: 'main' });
  const b = E.rankOffices(ds, { ranked: ['commute', 'health', 'environment'], strength: 'main' });
  assert.notDeepEqual(a.results.map(x => x.total), b.results.map(x => x.total));
});

test('climate targets change weather scores and nothing else', () => {
  const a = E.rankOffices(ds, { ranked: ['weather', 'career', 'safety'], strength: 'main', winter: 'snowy' });
  const b = E.rankOffices(ds, { ranked: ['weather', 'career', 'safety'], strength: 'main', winter: 'warm' });
  const frisco = r => r.results.find(x => x.key === 'Frisco|TX');
  assert.ok(frisco(b).byCat.weather > frisco(a).byCat.weather);
  close(frisco(a).byCat.career, frisco(b).byCat.career);
});

test('age-group baselines and the neutral profile are disclosed and sum to 100', () => {
  for (const age of Object.keys(settings.age_profiles)) {
    const w = E.categoryWeights(settings, { age }, ds);
    assert.equal(w.method, 'age'); assert.ok(w.note.length > 20); close(sumOf(w.weights), 100);
  }
  const n = E.categoryWeights(settings, {}, ds);
  assert.equal(n.method, 'neutral'); close(n.weights.housing, 12.5);
  const r = E.categoryWeights(settings, { age: '30-40' }, ds).weights;
  assert.equal(r.housing, 25); assert.equal(r.career, 12);
});

test('estimates and proxies are labeled, never silently zero', () => {
  const sources = new Set();
  for (const f of Object.values(ds.features)) for (const s of f.sources.values()) sources.add(s);
  for (const s of sources) assert.ok(settings.source_labels[s], `no label for ${s}`);
  assert.ok(sources.has('imputed')); assert.ok(sources.has('inland (0)'));
});

test('close calls are flagged under 1.5 points', () => {
  const r = E.rankOffices(ds, {});
  assert.equal(r.closeCall, r.gap < 1.5);
});

test('very different fictional employees get sensible, different results', () => {
  const people = {
    'renter who wants to save': { ranked: ['financial', 'housing', 'commute'], strength: 'strong' },
    'warm-weather lover': { ranked: ['weather', 'health', 'safety'], strength: 'main', winter: 'warm', summer: 'hot' },
    'career first': { ranked: ['career', 'financial', 'commute'], strength: 'main' },
    'safety and health': { ranked: ['safety', 'health', 'environment'], strength: 'balanced' },
  };
  const tops = {};
  for (const [name, a] of Object.entries(people)) {
    const r = E.rankOffices(ds, a);
    tops[name] = r.results[0].key;
    assert.equal(r.results.length, 5);
    assert.ok(r.results[0].reasons.length >= 1, name);
    for (const x of r.results) assert.ok(x.total >= 0 && x.total <= 100);
  }
  assert.equal(tops['warm-weather lover'], 'Frisco|TX');
});

test('the evidence package for the AI carries the real scores and limits', () => {
  const a = { ranked: ['housing', 'financial', 'safety'], strength: 'strong', household: 'partner' };
  const r = E.rankOffices(ds, a);
  const ev = JSON.parse(JSON.stringify(E.evidence(ds, a, r, {})));
  assert.equal(ev.ranking[0].city, `${r.results[0].city.city}, ${r.results[0].city.state}`);
  assert.equal(ev.ranking[0].score, E.round(r.results[0].total, 1));
  assert.ok(ev.limits.length >= 3);
  assert.ok(ev.ranking[0].measures.every(m => m.source));
});

test('map projection puts Chicago inside the map and east of Kansas', () => {
  const map = JSON.parse(read('data/us_states.json'));
  const [cx, cy] = E.project(-87.63, 41.88, map.projection);
  const [kx] = E.project(-94.67, 38.98, map.projection);
  assert.ok(cx > 0 && cx < map.viewBox[2] && cy > 0 && cy < map.viewBox[3]);
  assert.ok(cx > kx);
});
