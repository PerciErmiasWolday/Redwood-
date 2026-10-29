/* Redwood Relocation Guide: page code. All scoring lives in engine.js. */
(function () {
  'use strict';
  const E = window.RedwoodEngine;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pct = v => (Math.abs(v - Math.round(v)) < 0.05 ? String(Math.round(v)) : v.toFixed(1));
  const one = v => (Math.round(v * 10) / 10).toFixed(1);

  const STORE_KEY = 'redwood-relocation-guide-v1';
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    clear() { try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ } },
  };

  const blankAnswers = () => ({
    household: null, age: null, home: null,
    ranked: [], strength: 'balanced', skipRanking: false, winter: null, summer: null, alsoMatters: [],
    concern: null, tradeoff: null, feelHome: null, needs: [],
  });

  const state = {
    ds: null, map: null, content: {}, questions: null,
    view: 'cover', step: 0, answers: blankAnswers(), rank: null,
    prevMix: null, open: {}, notice: '', chat: { messages: [], status: 'idle', error: '', sig: '', draft: '', resetNote: '', opening: 'none' }, aiCode: '', aiCodeOk: false,
    ai: { checked: false, available: false, needsCode: true }, drewMap: false,
  };

  // ================================================================ loading

  async function loadText(path) {
    const inline = document.querySelector(`script[type="text/plain"][data-path="${path}"]`);
    if (inline) return inline.textContent.replace(/^\n/, '');
    try {
      const r = await fetch(path, { cache: 'no-cache' });
      return r.ok ? await r.text() : null;
    } catch (e) { return null; }
  }
  async function loadJSON(path) {
    const t = await loadText(path);
    if (t == null) return null;
    try { return JSON.parse(t); } catch (e) { throw new Error(`${path} is not valid JSON: ${e.message}`); }
  }

  async function boot() {
    try {
      const settings = await loadJSON('data/settings.json');
      if (!settings) throw new Error('data/settings.json could not be loaded.');
      const [questions, content, map, locationsText, sourcesText] = await Promise.all([
        loadJSON('content/questions.json'), loadJSON('content/cities.json'), loadJSON('data/us_states.json'),
        loadText('data/city_locations.csv'), loadText('data/feature_sources.csv'),
      ]);
      if (!questions) throw new Error('content/questions.json could not be loaded.');
      if (!locationsText) throw new Error('data/city_locations.csv could not be loaded.');
      const groupTexts = {};
      await Promise.all(Object.entries(settings.groups).map(async ([id, g]) => { groupTexts[id] = await loadText(g.file); }));
      state.ds = E.buildDataset({ settings, groupTexts, locationsText, sourcesText });
      state.questions = questions; state.content = content || {}; state.map = map;
      document.title = settings.app_name || document.title;
      restore();
      renderStatus();
      window.addEventListener('hashchange', () => { closePopover(); render(true); });
      render(true);
      checkAI();
    } catch (err) {
      $('#main').innerHTML = `<div class="prose"><h1 class="page__title">The guide couldn't load its data</h1>
        <p class="lede" style="margin-top:16px">${esc(err.message)}</p>
        <p style="margin-top:16px" class="muted">Check that the data folder was uploaded with the page, then reload.</p></div>`;
      console.error(err);
    }
  }

  function restore() {
    const saved = store.get();
    if (!saved || !saved.answers) return;
    state.answers = { ...blankAnswers(), ...saved.answers };
    state.saved = saved;
  }
  function persist() { store.set({ answers: state.answers, view: state.view, step: state.step, savedAt: Date.now() }); }

  function renderStatus() {
    const ds = state.ds;
    const used = ds.groups.filter(g => g.status === 'ok').map(g => g.label.replace('Ages ', ''));
    const waiting = ds.groups.filter(g => g.status !== 'ok').map(g => g.label.replace('Ages ', ''));
    $('#data-status').textContent = `Office picks use the ${used.join(', ')} rankings` +
      (waiting.length ? `; ${waiting.join(', ')} will be added when its scores are in.` : '.');
  }

  // ================================================================ helpers

  const S = () => state.ds.settings;
  const cat = id => S().categories.find(c => c.id === id);
  const catLabel = id => (cat(id) || S().qualitative.find(q => q.id === id) || { label: id }).label;
  const cityOf = key => state.ds.cities.get(key);
  const guideOf = key => state.content[key] || null;
  const isDark = () => document.documentElement.dataset.theme === 'dark' ||
    (document.documentElement.dataset.theme !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  const catColor = id => { const c = cat(id); return c ? (isDark() ? c.color_dark : c.color) : 'var(--rule-strong)'; };
  const milesFromHQ = key => { const c = cityOf(key), h = S().headquarters; return E.haversineMiles(c.lat, c.lon, h.lat, h.lon); };
  const optionLabel = (qid, oid) => {
    for (const st of state.questions.steps) for (const q of st.questions) if (q.id === qid && q.options) {
      const o = q.options.find(x => x.id === oid); if (o) return o.label;
    }
    return oid;
  };
  const cityRef = (key, text) => {
    const c = cityOf(key);
    return `<button type="button" class="cityref" data-city="${esc(key)}" aria-haspopup="dialog" aria-expanded="false">${esc(text || c.city)}</button>`;
  };
  const sourceBadge = src => {
    const label = S().source_labels[src] || src;
    const est = /imputed|proxy/.test(src);
    return `<span class="src${est ? ' src--estimate' : ''}">${esc(label)}</span>`;
  };

  function currentMix() {
    const a = state.answers;
    const ranked = a.skipRanking ? [] : a.ranked;
    const age = a.age && a.age !== 'skip' ? a.age : null;
    return E.categoryWeights(S(), { ranked, strength: a.strength, age }, state.ds);
  }
  function engineAnswers() {
    const a = state.answers;
    return { ...a, ranked: a.skipRanking ? [] : a.ranked, age: a.age && a.age !== 'skip' ? a.age : null };
  }
  function computeRank() { state.rank = E.rankOffices(state.ds, engineAnswers()); return state.rank; }

  // photos and drawn plates -------------------------------------------------

  const stateBoxes = {};
  function stateBox(abbr) {
    if (stateBoxes[abbr]) return stateBoxes[abbr];
    const st = state.map && state.map.states.find(s => s.abbr === abbr);
    if (!st) return null;
    const nums = st.d.match(/-?\d+(\.\d+)?/g).map(Number);
    let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    for (let i = 0; i < nums.length; i += 2) {
      minx = Math.min(minx, nums[i]); maxx = Math.max(maxx, nums[i]);
      miny = Math.min(miny, nums[i + 1]); maxy = Math.max(maxy, nums[i + 1]);
    }
    return (stateBoxes[abbr] = { d: st.d, minx, miny, maxx, maxy });
  }

  function plate(key) {
    const c = cityOf(key);
    const box = stateBox(c.state);
    let art = '';
    if (box) {
      const w = box.maxx - box.minx, h = box.maxy - box.miny;
      const pad = Math.max(w, h) * 0.18;
      const [x, y] = E.project(c.lon, c.lat, state.map.projection);
      const vb = [box.minx - pad, box.miny - pad, w + pad * 2, h + pad * 2];
      const r = Math.max(w, h) * 0.018;
      art = `<svg viewBox="${vb.map(v => v.toFixed(1)).join(' ')}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path class="plate__state" d="${box.d}"/>
        <circle class="plate__ring" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(r * 3.2).toFixed(2)}"/>
        <circle class="plate__dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r.toFixed(2)}"/></svg>`;
    }
    const lat = `${Math.abs(c.lat).toFixed(2)}° N, ${Math.abs(c.lon).toFixed(2)}° W`;
    return `<div class="plate">${art}<div class="plate__meta"><span class="plate__name">${esc(c.city)}, ${esc(c.state)}</span><span class="num">${lat}</span></div></div>`;
  }

  function photoUrl(file, width) {
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;
  }
  function photoFrame(key, width = 1200) {
    const g = guideOf(key);
    const img = g && g.photo && g.photo.file
      ? `<img src="${photoUrl(g.photo.file, width)}" alt="${esc(g.photo.alt || cityOf(key).city)}" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-fallback="1">`
      : '';
    return `<div class="photo__frame">${plate(key)}${img}</div>`;
  }
  function photoCredit(key) {
    const g = guideOf(key);
    if (!g || !g.photo || !g.photo.file) return '<span>Drawn map: no photo set for this city yet.</span>';
    const page = `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(g.photo.file)}`;
    const who = g.photo.verified && g.photo.credit ? `${esc(g.photo.credit)}, ${esc(g.photo.license)}, ` : '';
    return `<span>${esc(g.photo.alt || '')}</span><span>Photo: ${who}<a href="${page}" target="_blank" rel="noopener">Wikimedia Commons</a></span>`;
  }
  function photoFigure(key, width) {
    return `<figure class="photo">${photoFrame(key, width)}<figcaption class="photo__caption">${photoCredit(key)}</figcaption></figure>`;
  }
  // Photos that can't load (blocked or missing) fall back to the drawn plate underneath.
  document.addEventListener('error', e => {
    const t = e.target;
    if (t && t.tagName === 'IMG' && t.dataset.fallback) t.remove();
  }, true);

  // ================================================================ routing + render

  function tab() {
    const h = (location.hash || '#fit').slice(1).split('/')[0];
    return ['fit', 'cities', 'how'].includes(h) ? h : 'fit';
  }

  function render(scrollTop) {
    const main = $('#main');
    const t = tab();
    $$('.tabs__link').forEach(a => { if (a.dataset.tab === t) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });

    const focusId = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.fid : null;
    const before = boardPositions();

    let html;
    if (t === 'cities') html = viewCities();
    else if (t === 'how') html = viewHow();
    else if (state.view === 'step') html = viewStep();
    else if (state.view === 'review') html = viewReview();
    else if (state.view === 'results') html = viewResults();
    else html = viewCover();
    main.innerHTML = html;

    afterRender(before);
    if (focusId) { const el = main.querySelector(`[data-fid="${CSS.escape(focusId)}"]`); if (el) el.focus({ preventScroll: true }); }
    if (scrollTop) { window.scrollTo(0, 0); }
    const anchor = (location.hash || '').split('/')[1];
    if (t === 'cities' && anchor && scrollTop) { const el = document.getElementById(anchor); if (el) el.scrollIntoView(); }
  }

  function afterRender(before) {
    // animate the allocation strip from its previous mix
    const mixEls = $$('[data-alloc]');
    if (mixEls.length) {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        for (const el of mixEls) for (const seg of $$('.alloc__seg', el)) seg.style.flexGrow = seg.dataset.to;
      }));
    }
    // draw routes once
    const atlas = $('.atlas');
    if (atlas && !state.drewMap) { atlas.classList.add('is-drawing'); state.drewMap = true; }
    // reorder animation for the results board
    if (before) {
      const rows = $$('.board__row');
      const moved = rows.filter(r => before[r.dataset.key] !== undefined);
      if (moved.length) {
        for (const r of moved) {
          const dy = before[r.dataset.key] - r.getBoundingClientRect().top;
          if (Math.abs(dy) > 1) { r.style.transform = `translateY(${dy}px)`; r.style.transition = 'none'; }
        }
        requestAnimationFrame(() => requestAnimationFrame(() => {
          for (const r of moved) { r.style.transition = 'transform .45s cubic-bezier(.2,.7,.2,1)'; r.style.transform = ''; }
        }));
      }
    }
  }

  function boardPositions() {
    if (!state.animateBoard) return null;
    state.animateBoard = false;
    const out = {};
    for (const r of $$('.board__row')) out[r.dataset.key] = r.getBoundingClientRect().top;
    return out;
  }

  // ================================================================ cover

  function atlasSVG() {
    if (!state.map) return '';
    const m = state.map, p = m.projection, s = S();
    const [hx, hy] = E.project(s.headquarters.lon, s.headquarters.lat, p);
    const states = m.states.map(st => `<path class="atlas__state" d="${st.d}"/>`).join('');
    let routes = '', marks = '', labels = '', hits = '';
    state.ds.offices.forEach((o, i) => {
      const c = cityOf(o.key);
      const [x, y] = E.project(c.lon, c.lat, p);
      const mx = (hx + x) / 2, my = (hy + y) / 2;
      const dx = x - hx, dy = y - hy, len = Math.hypot(dx, dy) || 1;
      const bend = Math.min(60, len * 0.22);
      const sign = dx >= 0 ? 1 : -1; // always bow the route northward
      const cx = mx + sign * (dy / len) * bend, cy = my - sign * (dx / len) * bend;
      routes += `<path class="atlas__route" style="animation-delay:${i * 120}ms" d="M${hx.toFixed(1)},${hy.toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)}"/>`;
      marks += `<circle class="atlas__office" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5"/>`;
      const left = x < hx - 2;
      const near = len < 30;
      const lx = left ? x - 10 : x + 10;
      const ly = near ? y + 20 : y + 6;
      labels += `<text class="atlas__label" x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${left ? 'end' : 'start'}">${esc(c.city)}</text>`;
      hits += `<circle class="atlas__hit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="16" tabindex="0" role="button" aria-label="${esc(c.city)}, ${esc(c.state)}" data-city="${esc(o.key)}" aria-haspopup="dialog"/>`;
    });
    const hq = `<rect class="atlas__hq" x="${(hx - 6).toFixed(1)}" y="${(hy - 6).toFixed(1)}" width="12" height="12" transform="rotate(45 ${hx.toFixed(1)} ${hy.toFixed(1)})"/>
      <text class="atlas__label atlas__label--hq" x="${(hx - 10).toFixed(1)}" y="${(hy - 14).toFixed(1)}" text-anchor="end">Chicago HQ</text>`;
    return `<svg viewBox="${m.viewBox.join(' ')}" role="img" aria-label="Map of the five office cities and Chicago headquarters">${states}${routes}${marks}${hq}${labels}${hits}</svg>`;
  }

  function viewCover() {
    const offices = state.ds.offices;
    const legs = offices.map(o => `<div class="legs__item"><div class="legs__city">${cityRef(o.key)}</div><div class="legs__miles num">${Math.round(milesFromHQ(o.key))} mi away</div></div>`).join('');
    const resume = state.saved && state.answers.ranked && (state.answers.ranked.length === 3 || state.answers.skipRanking)
      ? `<p class="cover__resume">You've been here before. <button class="linkbtn" data-action="resume" data-fid="resume">See your matches again</button> or start fresh.</p>` : '';
    return `<section class="cover">
      <div>
        <h1 class="cover__title">Find the Redwood office that fits your life.</h1>
        <p class="lede cover__lede">Redwood is opening ${['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'][offices.length] || offices.length} new offices. Answer five short questions and we'll put them in your order, with what you'd gain, what you'd trade, and the numbers behind it.</p>
        <div class="cover__actions">
          <button class="btn btn--primary" data-action="start" data-fid="start">Start the questions</button>
          <a class="btn btn--quiet" href="#cities">Browse the cities first</a>
        </div>
        <p class="cover__fine">About two minutes. Your answers stay in this browser unless you chat with the guide.</p>
        ${resume}
      </div>
      <div class="atlas">${atlasSVG()}<div class="legs">${legs}</div></div>
    </section>`;
  }

  // ================================================================ questionnaire

  function stepDone(i) {
    const a = state.answers;
    const id = state.questions.steps[i].id;
    if (id === 'priorities') return a.skipRanking || a.ranked.length === 3;
    return true;
  }

  function viewStep() {
    const steps = state.questions.steps;
    const st = steps[state.step];
    const bar = steps.map((_, i) => `<span class="progress__seg ${i < state.step ? 'is-done' : i === state.step ? 'is-here' : ''}"></span>`).join('');
    const body = st.questions.map(q => question(q)).join('');
    const last = state.step === steps.length - 1;
    const ok = stepDone(state.step);
    const hint = st.id === 'priorities' && !ok ? `Pick ${3 - state.answers.ranked.length} more, or skip ranking.` : '';
    return `<div class="flow">
      <div>
        <div class="progress"><div class="progress__bar" aria-hidden="true">${bar}</div><span class="progress__text">Step ${state.step + 1} of ${steps.length}</span></div>
        <h1 class="flow__title" tabindex="-1" id="step-title">${esc(st.title)}</h1>
        ${body}
        <div class="flow__nav">
          <button class="btn" data-action="back" data-fid="back">Back</button>
          <span class="flow__hint" aria-live="polite">${esc(hint)}</span>
          <button class="btn btn--primary" data-action="next" data-fid="next" ${ok ? '' : 'disabled'}>${last ? 'Review my answers' : 'Continue'}</button>
        </div>
        ${mobileMix()}
      </div>
      <aside class="flow__aside">${mixPanel()}</aside>
    </div>`;
  }

  function question(q) {
    const a = state.answers;
    if (q.type === 'rank') return rankQuestion(q);
    if (q.type === 'strength') return a.skipRanking ? '' : strengthQuestion(q);
    if (q.type === 'climate') return !a.skipRanking && a.ranked.includes('weather') ? climateQuestion(q) : '';
    const multi = q.type === 'multi';
    const tight = q.id === 'age';
    const cur = a[q.id];
    const opts = q.options.map(o => {
      const on = multi ? (cur || []).includes(o.id) : cur === o.id;
      return `<button type="button" class="opt${multi ? ' opt--multi' : ''}" data-action="${multi ? 'toggle' : 'pick'}" data-q="${q.id}" data-v="${o.id}" data-fid="${q.id}-${o.id}" aria-pressed="${on}"><span class="opt__mark" aria-hidden="true"></span><span>${esc(o.label)}</span></button>`;
    }).join('');
    return `<fieldset class="q" style="border:0;padding:0;margin-inline:0">
      <legend class="q__label">${esc(q.label)}</legend>
      ${q.help ? `<p class="q__help">${esc(q.help)}</p>` : ''}
      <div class="q__body options${tight ? ' options--tight' : ''}" role="group">${opts}</div>
    </fieldset>`;
  }

  function rankQuestion(q) {
    const a = state.answers;
    const cards = S().categories.map(c => {
      const i = a.ranked.indexOf(c.id);
      const on = i >= 0 && !a.skipRanking;
      return `<button type="button" class="rankcard" style="--cat:${catColor(c.id)}" data-action="rank" data-v="${c.id}" data-fid="rank-${c.id}" aria-pressed="${on}" aria-label="${esc(c.label)}${on ? `, ranked ${i + 1}` : ''}">
        <span class="rankcard__title">${esc(c.label)}</span><span class="rankcard__blurb">${esc(c.blurb)}</span>
        <span class="rankcard__badge" aria-hidden="true">${on ? i + 1 : ''}</span></button>`;
    }).join('');
    const quals = S().qualitative.map(qq => {
      const on = a.alsoMatters.includes(qq.id);
      return `<button type="button" class="rankcard rankcard--qual" data-action="qual" data-v="${qq.id}" data-fid="qual-${qq.id}" aria-pressed="${on}">
        <span class="rankcard__title">${esc(qq.label)}</span><span class="rankcard__blurb">${esc(qq.blurb)}</span>
        <span class="rankcard__badge" aria-hidden="true">${on ? '✓' : ''}</span></button>`;
    }).join('');
    const ageLabel = a.age && a.age !== 'skip' ? S().age_profiles[a.age].label : null;
    const skipText = a.skipRanking
      ? `You're using the ${esc(ageLabel || 'neutral profile')}. <button class="linkbtn" data-action="unskip" data-fid="unskip">Rank my own instead</button>`
      : `<button class="linkbtn" data-action="skip-rank" data-fid="skip-rank">Skip, and use ${ageLabel ? `the ${esc(ageLabel)}` : 'a neutral mix'}</button>`;
    return `<div class="q">
      <p class="q__label">${esc(q.label)}</p><p class="q__help">${esc(q.help)}</p>
      <div class="q__body rank">${cards}${quals}</div>
      <div class="rank__foot"><span class="muted">${a.skipRanking ? '' : `${a.ranked.length} of 3 picked`}</span><span>${skipText}</span></div>
      ${state.notice ? `<p class="notice" role="status">${esc(state.notice)}</p>` : ''}
    </div>`;
  }

  function strengthQuestion(q) {
    const a = state.answers;
    const items = Object.entries(S().presets).map(([id, p]) => `
      <button type="button" class="opt" role="radio" aria-checked="${a.strength === id}" data-action="strength" data-v="${id}" data-fid="strength-${id}">
        <span class="opt__mark" aria-hidden="true"></span>
        <span class="strength__text"><span class="strength__name">${esc(p.label)}</span><span class="strength__quote">“${esc(p.quote)}”</span></span>
        <span class="strength__nums num">${p.first} / ${p.second} / ${p.third}</span>
      </button>`).join('');
    return `<div class="q"><p class="q__label">${esc(q.label)}</p>
      <p class="q__help">The numbers are the shares your first, second and third picks get. The other five categories split what's left.</p>
      <div class="q__body strength" role="radiogroup" aria-label="${esc(q.label)}">${items}</div></div>`;
  }

  function climateQuestion(q) {
    const a = state.answers, cl = S().climate;
    const row = (name, key, list) => `<div class="climate__row"><span class="climate__name">${name}</span>
      <div class="options options--tight" role="group" aria-label="${name}">${list.map(o =>
        `<button type="button" class="opt" data-action="pick" data-q="${key}" data-v="${o.id}" data-fid="${key}-${o.id}" aria-pressed="${a[key] === o.id}"><span class="opt__mark" aria-hidden="true"></span><span>${esc(o.label)} <span class="muted num">${o.target}°F</span></span></button>`).join('')}</div></div>`;
    return `<div class="q"><p class="q__label">${esc(q.label)}</p><p class="q__help">${esc(q.help)} We score each city by how close its average temperature is to yours.</p>
      <div class="q__body climate">${row('January', 'winter', cl.winter)}${row('July', 'summer', cl.summer)}</div></div>`;
  }

  function mixSegments(weights, cls = '') {
    const prev = state.prevMix || weights;
    const segs = S().categories.map(c => {
      const to = weights[c.id] || 0;
      const from = prev[c.id] ?? to;
      if (to <= 0 && from <= 0) return '';
      return `<span class="alloc__seg" style="--c:${catColor(c.id)};flex:${from} 1 0" data-to="${to}" title="${esc(c.label)}: ${pct(to)}%"></span>`;
    }).join('');
    state.prevMixNext = weights;
    return `<div class="alloc ${cls}" data-alloc role="img" aria-label="${esc(S().categories.map(c => `${c.label} ${pct(weights[c.id] || 0)} percent`).join(', '))}">${segs}</div>`;
  }

  function mixPanel() {
    const mix = currentMix();
    const a = state.answers;
    const ranked = a.skipRanking ? [] : a.ranked;
    const rows = S().categories
      .map(c => ({ c, w: mix.weights[c.id] || 0, r: ranked.indexOf(c.id) }))
      .sort((x, y) => (x.r < 0 ? 9 : x.r) - (y.r < 0 ? 9 : y.r) || y.w - x.w);
    let sub;
    if (mix.method === 'ranked') sub = `${S().presets[a.strength].label}: your top three get ${S().presets[a.strength].first + S().presets[a.strength].second + S().presets[a.strength].third}% between them.`;
    else if (!a.skipRanking && a.ranked.length) sub = `Pick ${3 - a.ranked.length} more to see your own mix. Until then, this is the starting point.`;
    else sub = mix.method === 'age' ? `Starting point: the ${mix.label}.` : 'Starting point: every measured category counts the same.';
    const list = rows.map(({ c, w, r }) => `<li class="mixlist__row${r >= 0 ? ' is-top' : ''}"><span class="swatch" style="--c:${catColor(c.id)}"></span><span>${r >= 0 ? `${r + 1}. ` : ''}${esc(c.label)}</span><span class="mixlist__pct">${pct(w)}%</span></li>`).join('');
    const qual = a.alsoMatters.length ? `<p class="mix__note">${esc(a.alsoMatters.map(catLabel).join(', '))}: described for each city, not scored.</p>` : '';
    const note = mix.method !== 'ranked' && mix.note ? `<p class="mix__note">${esc(mix.note)}</p>` : '';
    const html = `<div class="mix"><p class="mix__title">Your mix</p><p class="mix__sub">${esc(sub)}</p>${mixSegments(mix.weights)}<ul class="mixlist">${list}</ul>${qual}${note}</div>`;
    return html;
  }

  function mobileMix() {
    const mix = currentMix();
    const a = state.answers;
    const top = (a.skipRanking ? [] : a.ranked).map((id, i) => `${i + 1}. ${catLabel(id)}`).join('  ');
    return `<div class="mobile-mix" aria-hidden="true"><div class="mobile-mix__text"><strong>Your mix</strong><span>${esc(top || (mix.method === 'age' ? mix.label : 'Even mix'))}</span></div>${mixSegments(mix.weights)}</div>`;
  }

  // ================================================================ review

  function weatherText() {
    const a = state.answers, cl = S().climate;
    const w = cl.winter.find(o => o.id === a.winter), s = cl.summer.find(o => o.id === a.summer);
    if (!w && !s) return `No preference given. We use ${cl.default_winter}°F in January and ${cl.default_summer}°F in July.`;
    const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
    return `${w ? `${cap(w.phrase || w.label)} (${w.target}°F in January)` : `January: ${cl.default_winter}°F default`}; ${s ? `${s.phrase || s.label} (${s.target}°F in July)` : `July: ${cl.default_summer}°F default`}`;
  }

  function viewReview() {
    const a = state.answers;
    const mix = currentMix();
    const ranked = a.skipRanking ? [] : a.ranked;
    const rows = S().categories
      .map(c => ({ c, w: mix.weights[c.id] || 0, r: ranked.indexOf(c.id) }))
      .sort((x, y) => (x.r < 0 ? 9 : x.r) - (y.r < 0 ? 9 : y.r) || y.w - x.w)
      .map(({ c, w, r }) => `<tr class="${r >= 0 ? 'is-top' : ''}"><td><span class="swatch" style="--c:${catColor(c.id)}"></span></td><td>${esc(c.label)}${r >= 0 ? `<span class="review__rank">your #${r + 1}</span>` : ''}</td><td>${pct(w)}%</td></tr>`).join('');
    const p = S().presets[a.strength];
    const item = (k, v, step) => `<dt>${esc(k)}</dt><dd>${v}</dd><div class="edit"><button class="linkbtn" data-action="goto" data-v="${step}" data-fid="edit-${step}-${esc(k)}">Change</button></div>`;
    const needs = (a.needs || []).map(n => optionLabel('needs', n)).join('; ');
    const how = mix.method === 'ranked'
      ? `${esc(p.label)}: ${p.first}% / ${p.second}% / ${p.third}% for your top three, and the other five share ${p.rest}%.`
      : esc(mix.note);
    return `<section class="review">
      <h1 class="review__title" tabindex="-1" id="step-title">Here's what matters to you.</h1>
      <p class="lede" style="margin-top:12px;max-width:52ch">${how}</p>
      <div class="review__mix">${mixSegments(mix.weights, 'alloc--lg')}</div>
      <table class="review__table"><tbody>${rows}</tbody></table>
      <p class="small muted" style="margin-top:8px">Total ${pct(mix.total)}%. Inside each category, the share is split across its measures in the same proportions our team used.</p>

      <h2 class="section__title" style="margin-top:48px;margin-bottom:8px">Your other answers</h2>
      <p class="small muted" style="margin-bottom:12px">These shape the notes you'll see. They don't change any score.</p>
      <dl class="facts-list">
        ${item('Top three', ranked.length ? ranked.map((id, i) => `${i + 1}. ${esc(catLabel(id))}`).join('&nbsp;&nbsp; ') : `Skipped (${esc(mix.label)})`, 2)}
        ${ranked.includes('weather') ? item('Weather you like', esc(weatherText()), 2) : ''}
        ${a.alsoMatters.length ? item('Also matters', `${esc(a.alsoMatters.map(catLabel).join(', '))} (described, not scored)`, 2) : ''}
        ${item('Moving with you', esc(a.household ? optionLabel('household', a.household) : 'Not answered'), 0)}
        ${item('Next home', esc(a.home ? optionLabel('home', a.home) : 'Not answered'), 1)}
        ${item('Hardest to compromise on', esc(a.concern ? optionLabel('concern', a.concern) : 'Not answered'), 3)}
        ${item('Trade-off you would make', esc(a.tradeoff ? optionLabel('tradeoff', a.tradeoff) : 'Not answered'), 3)}
        ${item('Feels like home', esc(a.feelHome ? optionLabel('feelHome', a.feelHome) : 'Not answered'), 4)}
        ${item('Needed nearby', esc(needs || 'Not answered'), 4)}
      </dl>
      <div class="review__actions">
        <button class="btn btn--primary" data-action="results" data-fid="see">See my matches</button>
        <button class="btn btn--quiet" data-action="goto" data-v="0" data-fid="restart-q">Go back to the questions</button>
      </div>
    </section>`;
  }

  // ================================================================ results

  function viewResults() {
    const rank = computeRank();
    const top = rank.results[0];
    const a = state.answers;
    const ranked = rank.categoryWeights.ranked;
    const prefText = rank.categoryWeights.method === 'ranked'
      ? `Scored with your mix: ${ranked.map(id => `${catLabel(id)} ${pct(rank.categoryWeights.weights[id])}%`).join(', ')}, and the other five categories sharing the rest.`
      : `Scored with the ${rank.categoryWeights.label}. ${rank.categoryWeights.note}`;
    const second = rank.results[1];
    const close = rank.closeCall
      ? `<p class="closecall">This is a close call: ${cityRef(top.key)} leads ${cityRef(second.key)} by ${one(rank.gap)} points. Small changes in your answers could flip them, so read both.</p>` : '';
    const why = top.reasons.map(r => `<li class="why__item"><span class="swatch" style="--c:${catColor(r.category)}"></span><span><span class="why__tag">${esc(catLabel(r.category))}</span>${esc(r.text)}</span></li>`).join('');
    const trade = top.tradeoff ? `<li class="why__item why__item--trade"><span class="swatch"></span><span><span class="why__tag">${top.tradeoff.mild ? 'Its weakest spot for you, though still better than most cities' : 'The trade-off'}</span>${esc(top.tradeoff.text)}</span></li>` : '';
    const strengthCtl = rank.categoryWeights.method === 'ranked' ? `
      <div class="whatif">
        <span class="whatif__label">How much your first pick counts</span>
        <div class="seg" role="group" aria-label="How much your first pick counts">${Object.entries(S().presets).map(([id, p]) =>
          `<button type="button" class="seg__btn" data-action="whatif" data-v="${id}" data-fid="whatif-${id}" aria-pressed="${a.strength === id}">${esc(p.label)}</button>`).join('')}</div>
        <span class="whatif__note">Switch to see how sensitive your order is. ${esc(stability(rank))}</span>
      </div>` : '';
    return `<section class="match">
        <div>
          <p class="match__kicker">Your best match</p>
          <h1 class="match__city" tabindex="-1" id="step-title">${cityRef(top.key, top.city.city)}<span class="match__state">${esc(stateName(top.city.state))}, ${Math.round(top.milesFromHQ)} miles from Chicago</span></h1>
          <div class="score"><span class="score__n num">${one(top.total)}</span><span class="score__of">out of 100 under your weights. Higher means a closer match to what you told us, not a better city overall.</span></div>
          ${close}
          <ul class="why">${why}${trade}</ul>
        </div>
        ${photoFigure(top.key, 1400)}
      </section>
      ${strengthCtl}
      ${guideSection(rank)}
      <section class="section">
        <div class="section__head"><h2 class="section__title">All five, in your order</h2><p class="section__note">${esc(prefText)}</p></div>
        ${board(rank)}
      </section>
      <section class="section">
        <div class="section__head"><h2 class="section__title">Why the others could still work for you</h2><p class="section__note">Where each city beats the other four offices, from the same data.</p></div>
        <div class="others">${rank.results.slice(1).map(r => otherCard(r)).join('')}</div>
      </section>
      ${concernSection(rank)}
      ${notesSection(rank)}
      <section class="section">
        <div class="section__head"><h2 class="section__title">None of these feel right?</h2></div>
        <div class="nofit">
          <div class="nofit__item"><h3>Change what you ranked</h3><p>Your answers are kept, so you can adjust one thing and compare.</p><button class="linkbtn" data-action="goto" data-v="2" data-fid="nofit-rank">Change my top three</button></div>
          <div class="nofit__item"><h3>See how the five were picked</h3><p>The office cities came from four age-group studies of 500 cities.</p><a href="#how">How we chose</a></div>
          <div class="nofit__item"><h3>Talk it through with HR</h3><p>Copy a summary of your answers and results to share with your HR partner.</p><button class="linkbtn" data-action="copy" data-fid="copy">Copy my summary</button><span class="small muted" data-copy-status aria-live="polite"></span></div>
        </div>
      </section>
      <div class="results__foot">
        <button class="btn" data-action="review" data-fid="change">Change my answers</button>
        <button class="btn btn--quiet" data-action="reset" data-fid="reset">Start over</button>
      </div>`;
  }

  function stability(rank) {
    const a = engineAnswers();
    const tops = Object.keys(S().presets).map(id => E.rankOffices(state.ds, { ...a, strength: id }).results[0].key);
    const same = tops.every(k => k === tops[0]);
    return same ? `${cityOf(tops[0]).city} comes first under all three.` : `Your top city changes between settings, so it's worth comparing the top two.`;
  }

  const STATE_NAMES = { IN: 'Indiana', KS: 'Kansas', TX: 'Texas', IL: 'Illinois', MI: 'Michigan', MO: 'Missouri', OH: 'Ohio', MN: 'Minnesota', WI: 'Wisconsin', IA: 'Iowa', CO: 'Colorado', NC: 'North Carolina', VA: 'Virginia', GA: 'Georgia', TN: 'Tennessee', CA: 'California', WA: 'Washington', OR: 'Oregon', AZ: 'Arizona', UT: 'Utah', FL: 'Florida', NY: 'New York', PA: 'Pennsylvania', MA: 'Massachusetts', NJ: 'New Jersey', MD: 'Maryland', NE: 'Nebraska', OK: 'Oklahoma', SC: 'South Carolina', KY: 'Kentucky', AL: 'Alabama', LA: 'Louisiana', ID: 'Idaho', NV: 'Nevada', NM: 'New Mexico', SD: 'South Dakota', ND: 'North Dakota', MT: 'Montana', WY: 'Wyoming', AR: 'Arkansas', MS: 'Mississippi', CT: 'Connecticut', RI: 'Rhode Island', NH: 'New Hampshire', VT: 'Vermont', ME: 'Maine', DE: 'Delaware', WV: 'West Virginia', DC: 'District of Columbia' };
  const stateName = ab => STATE_NAMES[ab] || ab;

  function board(rank) {
    const rows = rank.results.map(r => {
      const segs = S().categories.map(c => {
        const v = r.byCat[c.id];
        const max = rank.categoryWeights.weights[c.id] || 0;
        if (v <= 0.0001) return '';
        return `<span class="stack__seg" style="--c:${catColor(c.id)};flex:0 0 calc(${v}% - 2px)" data-tip="${esc(c.label)}: ${one(v)} of ${pct(max)} possible points"></span>`;
      }).join('');
      const open = !!state.open[r.key];
      return `<li class="board__row" data-key="${esc(r.key)}">
        <div class="board__main">
          <span class="board__pos">${r.position}</span>
          <span class="board__name">${cityRef(r.key)}<small>${esc(stateName(r.city.state))}, ${Math.round(r.milesFromHQ)} mi</small></span>
          <span class="stack" role="img" aria-label="${esc(S().categories.map(c => `${c.label} ${one(r.byCat[c.id])} points`).join(', '))}">${segs}<span class="stack__rest"></span></span>
          <span class="board__score">${one(r.total)}</span>
          <button class="linkbtn board__toggle" data-action="audit" data-v="${esc(r.key)}" data-fid="audit-${esc(r.key)}" aria-expanded="${open}">${open ? 'Hide the math' : 'See the math'}</button>
        </div>
        ${open ? `<div class="board__detail">${audit(r, rank)}</div>` : ''}
      </li>`;
    }).join('');
    const legend = S().categories.map(c => `<span class="legend__item"><span class="swatch" style="--c:${catColor(c.id)}"></span>${esc(c.label)} <span class="muted num">${pct(rank.categoryWeights.weights[c.id] || 0)}%</span></span>`).join('');
    return `<ol class="board">${rows}</ol><div class="legend" aria-label="Categories and their weights">${legend}</div>
      <p class="small muted" style="margin-top:8px">Each bar is the city's score split by category. A full bar would be 100: every measure the best of all 500 cities.</p>`;
  }

  function audit(r, rank) {
    const ds = state.ds;
    let body = '';
    for (const c of S().categories) {
      const rows = r.rows.filter(x => x.category === c.id);
      if (!rows.length) continue;
      body += `<tr class="audit__cat"><td colspan="4"><span class="swatch" style="--c:${catColor(c.id)};display:inline-block;margin-right:8px"></span>${esc(c.label)}</td><td class="n">${pct(rank.categoryWeights.weights[c.id] || 0)}%</td><td class="n">${r.byCat[c.id].toFixed(2)}</td></tr>`;
      body += rows.map(x => {
        const f = ds.features[x.feature];
        const tgt = x.target != null ? ` <span class="muted">(your target ${x.target}°F)</span>` : '';
        return `<tr><td>${esc(f.label)}${tgt}</td><td class="n">${esc(E.formatValue(f, x.raw))}</td><td>${sourceBadge(x.source)}</td><td class="n">${x.norm.toFixed(1)}</td><td class="n">${x.weight.toFixed(2)}%</td><td class="n">${x.contrib.toFixed(2)}</td></tr>`;
      }).join('');
    }
    const check = r.rows.reduce((s, x) => s + x.contrib, 0);
    return `<div class="audit__wrap"><table class="audit">
      <thead><tr><th>Measure</th><th class="n">Value</th><th>Source</th><th class="n">Score 0–100</th><th class="n">Weight</th><th class="n">Points</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td colspan="4">Total</td><td class="n">${pct(rank.categoryWeights.total)}%</td><td class="n">${check.toFixed(2)}</td></tr></tfoot></table></div>
      <p class="audit__note">Score 0–100 compares this value with all 500 cities (100 is the best of the 500). Points = score × weight ÷ 100, and the points add up to the total. Dashed badges mark estimates: values our team filled in where the source had a gap, or took from the county when the city had none.</p>`;
  }

  function otherCard(r) {
    const items = r.standouts.length ? r.standouts.map(s => `<li>${esc(s.text)}</li>`).join('') : '<li>No measure where it beats the other four by a clear margin.</li>';
    const g = guideOf(r.key);
    return `<article class="other">
      <div class="other__thumb">${photoFrame(r.key, 300)}</div>
      <div><h3 class="other__name">${cityRef(r.key)}</h3><p class="other__score">#${r.position} for you, ${one(r.total)} points</p>
      ${g ? `<p class="small" style="margin-top:6px;color:var(--ink-2)">${esc(g.summary)}</p>` : ''}
      <ul>${items}</ul></div></article>`;
  }

  function concernSection(rank) {
    const id = state.answers.concern;
    if (!id) return '';
    const c = S().concerns[id];
    if (!c || !c.features.length) {
      return `<section class="section concern"><div class="section__head"><h2 class="section__title">Dealbreakers</h2><p class="section__note">You told us none of these is an absolute dealbreaker, so nothing extra to check here.</p></div></section>`;
    }
    const blocks = c.features.map(fid => {
      const f = state.ds.features[fid];
      const rows = E.concernTable(state.ds, rank, fid).sort((x, y) => y.norm - x.norm);
      const best = rows[0].key;
      return `<h3>${esc(f.label)}</h3><div class="concern__rows">${rows.map(x => `
        <div class="cbar${x.key === best ? ' is-best' : ''}"><span class="cbar__city">${cityRef(x.key, x.city)}</span>
        <span class="cbar__track" title="${esc(x.compare)}"><span class="cbar__fill" style="width:${Math.max(2, x.percentile).toFixed(1)}%"></span></span>
        <span class="cbar__val">${esc(x.text)}${/imputed|proxy/.test(x.source) ? ' <span class="src src--estimate">est.</span>' : ''}</span></div>`).join('')}</div>
        <p class="small muted" style="margin-top:6px">Bar length is the share of the 500 cities each one does better than. ${esc(cityOf(best).city)}: ${esc(rows[0].compare)}.</p>`;
    }).join('');
    return `<section class="section concern">
      <div class="section__head"><h2 class="section__title">Your dealbreaker: ${esc(c.label.charAt(0).toLowerCase() + c.label.slice(1))}</h2>
      <p class="section__note">Checked across all five. We flag it and show the numbers; we don't remove any city for it.</p></div>
      ${blocks}${c.limit ? `<p class="notice">${esc(c.limit)}</p>` : ''}
    </section>`;
  }

  // context notes: answers that personalize without scoring ------------------

  function featureLine(fid, key) { return E.factLine(state.ds, fid, key, state.rank.targets); }
  function bestOf(fid, keys) {
    const t = state.rank.targets;
    return [...keys].sort((a, b) => E.normalized(state.ds, fid, b, t) - E.normalized(state.ds, fid, a, t))[0];
  }
  function factsTagged(tag, keys, limit = 1) {
    const out = [];
    for (const k of keys) {
      const g = guideOf(k);
      if (!g) continue;
      const hits = g.facts.filter(f => (f.tags || []).includes(tag)).slice(0, limit);
      for (const h of hits) out.push(`<li><strong>${cityRef(k)}:</strong> ${esc(h.text)}</li>`);
    }
    return out.join('');
  }

  function notesSection(rank) {
    const a = state.answers;
    const keys = rank.results.map(r => r.key);
    const top = rank.results[0];
    const notes = [];
    const fv = (fid, k) => E.formatValue(state.ds.features[fid], state.ds.features[fid].values.get(k));

    // next home
    if (a.home && a.home !== 'flexible') {
      const lowest = bestOf('housing_costs', keys);
      const what = a.home === 'rent' ? 'rents' : 'home prices';
      notes.push({
        title: optionLabel('home', a.home),
        body: `<p>Our housing measure is each county's average yearly housing costs, not ${what}. In ${cityRef(top.key)}: ${esc(fv('housing_costs', top.key))} a year. The lowest of the five is ${cityRef(lowest)} at ${esc(fv('housing_costs', lowest))}.</p>
          <p style="margin-top:6px">${a.home === 'rent' ? 'Check current rental listings near the office before you decide.' : `Also worth a look: households with severe housing problems (crowding, high cost or poor facilities) are ${esc(fv('housing_problems', top.key))} in ${esc(top.city.city)}. Check current listings for real prices.`}</p>`,
      });
    }
    // partner's job
    if ((a.needs || []).includes('partner_job')) {
      const rows = [...keys].sort((x, y) => state.ds.features.employment_rate.values.get(y) - state.ds.features.employment_rate.values.get(x));
      notes.push({
        title: 'Work for a partner or family member',
        body: `<p>Employment rate (people who want work and have it):</p><ul>${rows.map(k => `<li>${cityRef(k)}: ${esc(fv('employment_rate', k))}</li>`).join('')}</ul><p style="margin-top:6px">This isn't a count of job openings in any field.</p>`,
      });
    }
    // schools / family
    if ((a.needs || []).includes('schools') || a.feelHome === 'family' || ['partner_children', 'children'].includes(a.household)) {
      const facts = factsTagged('schools', keys) || factsTagged('family', keys);
      notes.push({
        title: 'Schools and childcare',
        body: `<p>We don't score schools: none of our sources measured school quality, so we won't guess.</p>${facts ? `<ul>${facts}</ul>` : ''}<p style="margin-top:6px">Look up the school district for any neighborhood you're considering.</p>`,
      });
    }
    // healthcare
    if ((a.needs || []).includes('healthcare')) {
      notes.push({
        title: 'Healthcare services',
        body: `<p>We can't tell you which specialists or hospitals are nearby. The closest measures we have:</p><ul>${keys.map(k => `<li>${cityRef(k)}: ${esc(fv('uninsured', k))} of adults uninsured, life expectancy ${esc(fv('life_expectancy', k))}</li>`).join('')}</ul>`,
      });
    }
    if ((a.needs || []).includes('support')) {
      notes.push({ title: 'Accessibility and family support', body: `<p>Our data doesn't cover these services. Ask Redwood HR to connect you with local resources in the cities you're considering.</p>` });
    }
    // feels like home
    const tagFor = { events: 'events', outdoors: 'outdoors', family: 'family' };
    if (a.feelHome && tagFor[a.feelHome]) {
      const facts = factsTagged(tagFor[a.feelHome], keys);
      if (facts) notes.push({ title: optionLabel('feelHome', a.feelHome), body: `<p>Not part of the score, but here's what each city offers, from its city guide:</p><ul>${facts}</ul>` });
    } else if (a.feelHome === 'quiet') {
      const sizes = factsTagged('size', keys);
      notes.push({ title: optionLabel('feelHome', a.feelHome), body: `<p>We don't measure how quiet a neighborhood is. City size is a rough guide:</p><ul>${sizes}</ul>` });
    } else if (a.feelHome === 'everything') {
      const facts = keys.map(k => { const g = guideOf(k); const f = g && g.facts.find(x => (x.tags || []).some(t => ['events', 'outdoors'].includes(t))); return f ? `<li><strong>${cityRef(k)}:</strong> ${esc(f.text)}</li>` : ''; }).join('');
      if (facts) notes.push({ title: optionLabel('feelHome', a.feelHome), body: `<p>A little of everything, one highlight each:</p><ul>${facts}</ul>` });
    }
    if (a.alsoMatters.includes('recreation') && !['events', 'outdoors', 'everything'].includes(a.feelHome)) {
      const facts = factsTagged('events', keys) + factsTagged('outdoors', [top.key]);
      if (facts) notes.push({ title: 'Recreation and lifestyle', body: `<p>You said this matters. It isn't scored, so here's what the city guides say:</p><ul>${facts}</ul>` });
    }
    // trade-off
    const tradeNote = tradeoffNote(a.tradeoff, keys, fv);
    if (tradeNote) notes.push(tradeNote);

    if (!notes.length) return '';
    return `<section class="section"><div class="section__head"><h2 class="section__title">What else to weigh</h2><p class="section__note">Based on the rest of your answers. None of this changes the scores above.</p></div>
      <div class="notes">${notes.map(n => `<div class="note"><h3 class="note__title">${esc(n.title)}</h3><div class="note__body">${n.body}</div></div>`).join('')}</div></section>`;
  }

  function tradeoffNote(id, keys, fv) {
    if (!id || id === 'not_sure') return null;
    const title = `Your trade-off: ${optionLabel('tradeoff', id).charAt(0).toLowerCase()}${optionLabel('tradeoff', id).slice(1)}`;
    if (id === 'pay_more_career') {
      const k = bestOf('employment_rate', keys);
      return { title, body: `<p>${cityRef(k)} has the highest employment rate of the five (${esc(fv('employment_rate', k))}). Its cost of living index is ${esc(fv('cost_of_living', k))}, ${esc(E.compareLine(state.ds, 'cost_of_living', k, state.rank.targets))}.</p>` };
    }
    if (id === 'commute_for_housing') {
      const k = bestOf('housing_costs', keys);
      return { title, body: `<p>${cityRef(k)} has the lowest housing costs of the five (${esc(fv('housing_costs', k))} a year). There, ${esc(fv('long_commute', k))} of workers have a long solo commute.</p>` };
    }
    if (id === 'fewer_options_lower_cost') {
      const k = bestOf('cost_of_living', keys);
      return { title, body: `<p>${cityRef(k)} has the lowest cost of living of the five (index ${esc(fv('cost_of_living', k))}, where the U.S. average is about 100).</p>` };
    }
    if (id === 'pay_more_lifestyle') {
      const k = [...keys].sort((x, y) => state.ds.features.cost_of_living.values.get(y) - state.ds.features.cost_of_living.values.get(x))[0];
      return { title, body: `<p>Lifestyle isn't something we score, so use the city guides on <a href="#cities">The cities</a>. For cost: ${cityRef(k)} is the most expensive of the five (index ${esc(fv('cost_of_living', k))}).</p>` };
    }
    if (id === 'avoid') {
      const worst = state.rank.results.map(r => ({ r, min: Math.min(...r.rows.filter(x => x.weight > 0).map(x => x.norm)) })).sort((x, y) => y.min - x.min)[0];
      const weak = worst.r.rows.filter(x => x.weight > 0).sort((x, y) => x.norm - y.norm)[0];
      return { title, body: `<p>${cityRef(worst.r.key)} has the fewest weak spots: even its weakest measure, ${esc(state.ds.features[weak.feature].label.toLowerCase())}, scores ${one(weak.norm)} out of 100 against the 500 cities.</p>` };
    }
    return null;
  }

  // the guide ----------------------------------------------------------------

  function localSummary(rank) {
    const [a, b] = rank.results;
    const w = rank.categoryWeights;
    const weights = w.method === 'ranked' ? w.ranked.map(id => `${catLabel(id)} (${pct(w.weights[id])}%)`).join(', ') : w.label;
    const p1 = `Weighting ${weights}, ${a.city.city} comes out on top with ${one(a.total)} points, ${one(rank.gap)} ahead of ${b.city.city}${rank.closeCall ? ', which is close enough to treat as a tie' : ''}.`;
    const p2 = a.reasons.length ? `What earns it those points: ${a.reasons.map(r => r.text.charAt(0).toLowerCase() + r.text.slice(1)).join('; ')}.` : '';
    const p3 = !a.tradeoff ? 'It has no weak spot under your weights.'
      : a.tradeoff.mild ? `It has no real weak spot under your weights; its weakest is ${a.tradeoff.text.charAt(0).toLowerCase() + a.tradeoff.text.slice(1)}.`
      : `What you'd give up: ${a.tradeoff.text.charAt(0).toLowerCase() + a.tradeoff.text.slice(1)}.`;
    const p4 = b.standouts[0] ? `If ${a.city.city} doesn't feel right, look at ${b.city.city}: ${b.standouts[0].text.charAt(0).toLowerCase() + b.standouts[0].text.slice(1)}.` : '';
    return [p1, p2, p3, p4].filter(Boolean);
  }

  // A results "signature": when it changes, the conversation starts over so no old answer
  // can describe numbers that are no longer on screen.
  /** The employee's answers in words, so the guide reads what the employee picked, not internal ids. */
  function guideAnswers() {
    const a = state.answers, cl = S().climate, label = (q, v) => (v ? optionLabel(q, v) : 'not answered');
    const w = cl.winter.find(o => o.id === a.winter), su = cl.summer.find(o => o.id === a.summer);
    return {
      moving_with_them: label('household', a.household),
      age_group: a.age && a.age !== 'skip' ? a.age : 'not given',
      next_home: label('home', a.home),
      top_three_priorities: a.skipRanking ? 'skipped (research profile used)' : a.ranked.map((id, i) => `${i + 1}. ${catLabel(id)}`),
      first_priority_strength: a.skipRanking ? 'not used' : S().presets[a.strength].label,
      weather_wanted: w || su ? `${w ? w.phrase : 'no winter preference'}; ${su ? su.phrase : 'no summer preference'}` : 'no preference',
      also_matters_not_scored: a.alsoMatters.map(catLabel),
      hardest_to_compromise_on: label('concern', a.concern),
      tradeoff_they_would_make: label('tradeoff', a.tradeoff),
      what_feels_like_home: label('feelHome', a.feelHome),
      needed_nearby: (a.needs || []).map(n => optionLabel('needs', n)),
    };
  }

  function resultsSig(rank) {
    return JSON.stringify([rank.results.map(r => [r.key, one(r.total)]), rank.categoryWeights.weights, rank.targets.winter, rank.targets.summer]);
  }
  const blankChat = () => ({ messages: [], status: 'idle', error: '', sig: '', draft: '', resetNote: '', opening: 'none' });
  // Matches the request in api/_instructions.js; it opens the conversation history sent to the model.
  const OPENING_REQUEST = 'Please open our conversation with your recommendation for me, based on all of my answers.';

  function syncChat(rank) {
    const sig = resultsSig(rank);
    const c = state.chat;
    if (c.sig && c.sig !== sig && (c.messages.length || c.opening !== 'none')) {
      state.chat = { ...blankChat(), sig, draft: c.draft, resetNote: c.messages.length ? 'Your results changed, so the guide is starting a new conversation with the new numbers.' : '' };
    } else c.sig = sig;
  }

  const needsCodeNow = () => state.ai.available && state.ai.needsCode && !state.aiCode;
  function needsOpening() {
    const c = state.chat;
    return state.ai.available && state.view === 'results' && tab() === 'fit' && c.opening === 'none' && c.status !== 'loading' && !needsCodeNow();
  }
  let openTimer = null;
  function scheduleOpen() {
    clearTimeout(openTimer);
    openTimer = setTimeout(() => { if (needsOpening()) openChat(); }, 500);
  }
  /** Small, safe formatter for the guide's replies: paragraphs, "- " lists, **bold**, and city names that open the photo card. */
  function formatReply(text) {
    const names = state.ds.offices.map(o => cityOf(o.key));
    const byName = new Map(names.map(c => [c.city, c.key]));
    const re = names.length ? new RegExp(`\\b(${names.map(c => c.city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g') : null;
    const inline = t => {
      let h = esc(t);
      if (re) h = h.replace(re, m => cityRef(byName.get(m), m));
      return h.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    };
    return text.trim().split(/\n{2,}/).map(block => {
      const lines = block.split('\n').filter(l => l.trim());
      if (lines.length && lines.every(l => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
        const ordered = /^\s*\d/.test(lines[0]);
        const items = lines.map(l => `<li>${inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''))}</li>`).join('');
        return ordered ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
      }
      return `<p>${lines.map(inline).join('<br>')}</p>`;
    }).join('');
  }

  function suggestions(rank) {
    const [a, b, c] = rank.results;
    const asked = new Set(state.chat.messages.filter(m => m.role === 'user').map(m => m.content));
    const list = [
      `Why did ${a.city.city} come first for me?`,
      `What would I give up in ${a.city.city}?`,
      `Compare ${a.city.city} and ${b.city.city} for me`,
      `Make the case for ${c.city.city}`,
      state.answers.concern && state.answers.concern !== 'none' ? `How do the five compare on my dealbreaker?` : `Which city is safest?`,
      `What can't your data tell me?`,
    ];
    return list.filter(t => !asked.has(t)).slice(0, state.chat.messages.length ? 3 : 4);
  }

  function guideSection(rank) {
    syncChat(rank);
    const c = state.chat;
    const ai = state.ai;
    const bubble = (role, html, extra = '') => `<div class="msg msg--${role}${extra}"><span class="msg__who">${role === 'guide' ? 'Guide' : 'You'}</span><div class="msg__body">${html}</div></div>`;
    const localOpener = () => bubble('guide', localSummary(rank).map(p => `<p>${esc(p)}</p>`).join(''), ' msg--opener');

    let thread = '';
    if (c.resetNote) thread += `<p class="thread__note" role="status">${esc(c.resetNote)}</p>`;
    if (!ai.available || c.opening === 'failed') thread += localOpener();
    if (ai.available && needsCodeNow() && !c.messages.length) {
      thread += `<form class="gate" data-form="gate">
        <p class="gate__title">Your guide is ready to talk through your results.</p>
        <p class="small muted">Enter the access code your team shared to start the conversation.</p>
        <div class="gate__row"><label class="visually-hidden" for="gate-code">Access code</label>
          <input class="field" id="gate-code" name="code" type="password" autocomplete="off" placeholder="Access code" data-fid="gate-code">
          <button class="btn btn--primary" type="submit" data-fid="gate-start">Start</button></div>
        ${c.error ? `<p class="gate__error" role="alert">${esc(c.error)}</p>` : ''}
      </form>`;
    }
    for (const m of c.messages) thread += m.role === 'user' ? bubble('user', `<p>${esc(m.content).replace(/\n/g, '<br>')}</p>`) : bubble('guide', formatReply(m.content));
    if (c.status === 'loading') {
      const label = c.opening === 'pending' ? 'Reading your answers' : 'Writing';
      thread += `<div class="msg msg--guide msg--typing"><span class="msg__who">Guide</span><div class="msg__body"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="typing__text">${label}…</span></div></div>`;
    }
    if (c.status === 'error' && !(needsCodeNow() && !c.messages.length)) {
      thread += `<div class="thread__error" role="alert"><p>${esc(c.error)}</p><button class="linkbtn" data-action="chat-retry" data-fid="chat-retry">Try again</button></div>`;
    }

    const ev = E.evidence(state.ds, guideAnswers(), rank, state.content);
    const evidencePanel = `<details class="evidence"><summary>What the guide sees</summary>
      <p class="small muted">This is everything sent with your messages: all of your answers, your weights, the scores and the measures behind them. What you type can ask about the results, but it can't change the ranking; only the questionnaire does.</p>
      <pre class="evidence__json">${esc(JSON.stringify(ev, null, 2))}</pre></details>`;

    const ready = c.opening === 'done' || c.opening === 'failed' || c.messages.length > 0;
    const busy = c.status === 'loading';
    const composer = !ai.available
      ? `<p class="small muted composer__off">${ai.checked ? 'The live guide isn\'t connected on this copy of the app, so this summary comes straight from your results.' : 'Checking for the live guide…'}</p>`
      : needsCodeNow() && !c.messages.length ? ''
      : `<form class="composer" data-form="guide">
        ${ready && !busy ? `<div class="chips" aria-label="Suggested questions">${suggestions(rank).map((t, i) => `<button type="button" class="chip" data-action="chip" data-v="${esc(t)}" data-fid="chip-${i}">${esc(t)}</button>`).join('')}</div>` : ''}
        <div class="composer__row">
          <label class="visually-hidden" for="guide-q">Message the guide</label>
          <textarea class="field composer__input" id="guide-q" name="q" rows="1" maxlength="600" data-fid="guide-q" placeholder="${ready ? 'Reply to the guide' : 'The guide is reading your answers…'}" ${ready ? '' : 'disabled'}>${esc(c.draft)}</textarea>
          <button class="btn btn--primary" type="submit" data-fid="ask" ${busy || !ready ? 'disabled' : ''}>Send</button>
        </div>
        <div class="composer__foot"><span class="small muted">Enter to send, Shift+Enter for a new line. The guide explains your results; it can't change them.</span>
          ${c.messages.length > 1 ? `<button type="button" class="linkbtn small" data-action="chat-new" data-fid="chat-new">Start over with the guide</button>` : ''}</div>
      </form>`;

    if (needsOpening()) scheduleOpen();

    return `<section class="section section--guide" id="guide">
      <div class="section__head"><h2 class="section__title">${ai.available ? 'Talk it through with your guide' : 'Your results in plain words'}</h2>
      <p class="section__note">${ai.available ? 'An AI guide that has read all of your answers and these scores. It explains your ranking; it doesn\'t make it.' : 'Written from your scores. When the live guide is connected, it opens a conversation here.'}</p></div>
      <div class="chat">
        <div class="thread" id="thread" aria-live="polite">${thread}</div>
        ${composer}
        ${evidencePanel}
      </div>
    </section>`;
  }

  async function checkAI() {
    try {
      const r = await fetch('api/guide', { method: 'GET', headers: { accept: 'application/json' } });
      const j = r.ok ? await r.json() : null;
      state.ai = { checked: true, available: !!(j && j.enabled), needsCode: j ? j.needsCode !== false : true };
    } catch (e) { state.ai = { checked: true, available: false, needsCode: true }; }
    try { state.aiCode = sessionStorage.getItem('redwood-guide-code') || ''; } catch (e) { state.aiCode = ''; }
    if (state.view === 'results' && tab() === 'fit') render();
  }

  async function postGuide(payload) {
    const r = await fetch('api/guide', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: state.aiCode || '', evidence: E.evidence(state.ds, guideAnswers(), state.rank, state.content), ...payload }),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, j, status: r.status };
  }
  function codeAccepted() {
    state.aiCodeOk = true;
    try { sessionStorage.setItem('redwood-guide-code', state.aiCode || ''); } catch (e) { /* ignore */ }
  }
  function codeRejected(c, j) {
    state.aiCode = ''; state.aiCodeOk = false;
    try { sessionStorage.removeItem('redwood-guide-code'); } catch (e) { /* ignore */ }
    c.status = 'error'; c.error = j.error || 'That access code is not right.';
  }

  /** The guide's first message: its recommendation, written from all of the employee's answers. */
  async function openChat() {
    const c = state.chat;
    c.opening = 'pending'; c.status = 'loading'; c.error = '';
    render(); scrollThread(true);
    try {
      const { ok, j, status } = await postGuide({ opening: true });
      if (state.chat !== c) return;
      if (!ok) {
        if (j.code === 'bad_code') { c.opening = 'none'; codeRejected(c, j); render(); return; }
        throw new Error(j.error || `The guide returned an error (${status}).`);
      }
      codeAccepted();
      c.messages.push({ role: 'assistant', content: j.answer, opener: true });
      c.opening = 'done'; c.status = 'idle';
    } catch (e) {
      if (state.chat !== c) return;
      c.opening = 'failed'; c.status = 'error';
      c.error = `${e.message || 'The guide could not answer.'} Here's a summary from your results in the meantime.`;
    }
    render(); scrollThread(false);
  }

  async function sendChat(text, code) {
    const c = state.chat;
    if (c.status === 'loading') return;
    if (text) c.messages.push({ role: 'user', content: text.slice(0, 600) });
    if (code !== undefined) state.aiCode = code;
    c.status = 'loading'; c.error = ''; c.draft = ''; c.resetNote = '';
    render(); scrollThread(true);
    try {
      // The conversation always starts with the opening request, then the guide's recommendation
      // (or the written summary, if the guide's opening didn't load).
      const lead = c.messages[0] && c.messages[0].opener
        ? [{ role: 'user', content: OPENING_REQUEST }]
        : [{ role: 'user', content: OPENING_REQUEST }, { role: 'assistant', content: localSummary(state.rank).join(' ') }];
      const history = [...lead, ...c.messages.map(m => ({ role: m.role, content: m.content }))];
      const trimmed = history.length > 16 ? [history[0], ...history.slice(-15)] : history;
      const { ok, j, status } = await postGuide({ messages: trimmed });
      if (state.chat !== c) return; // results changed while waiting
      if (!ok) {
        if (j.code === 'bad_code') { codeRejected(c, j); render(); return; }
        throw new Error(j.error || `The guide returned an error (${status}).`);
      }
      codeAccepted();
      c.messages.push({ role: 'assistant', content: j.answer });
      c.status = 'idle';
    } catch (e) {
      if (state.chat !== c) return;
      c.status = 'error';
      c.error = e.message || 'The guide could not answer.';
    }
    render(); scrollThread(false);
    const box = $('#guide-q'); if (box && c.status !== 'error') box.focus({ preventScroll: true });
  }

  function scrollThread(toEnd) {
    const t = $('#thread');
    if (!t) return;
    if (toEnd) { t.scrollTop = t.scrollHeight; return; }
    // show the start of the newest reply
    const msgs = t.querySelectorAll('.msg');
    const last = msgs[msgs.length - 1];
    if (last) t.scrollTop = Math.max(0, last.offsetTop - 12);
  }

  function summaryText() {
    const rank = state.rank || computeRank();
    const a = state.answers;
    const lines = ['Redwood relocation guide: my results', ''];
    lines.push(`Weights: ${rank.categoryWeights.method === 'ranked' ? rank.categoryWeights.ranked.map((id, i) => `${i + 1}. ${catLabel(id)} ${pct(rank.categoryWeights.weights[id])}%`).join(', ') + ` (${S().presets[a.strength].label})` : rank.categoryWeights.label}`);
    rank.results.forEach(r => lines.push(`${r.position}. ${r.city.city}, ${r.city.state}: ${one(r.total)}`));
    lines.push('');
    for (const [k, q] of [['household', 'Moving with me'], ['home', 'Next home'], ['concern', 'Hardest to compromise on'], ['tradeoff', 'Trade-off I would make'], ['feelHome', 'Feels like home']]) {
      if (a[k]) lines.push(`${q}: ${optionLabel(k, a[k])}`);
    }
    if (a.needs.length) lines.push(`Needed nearby: ${a.needs.map(n => optionLabel('needs', n)).join('; ')}`);
    return lines.join('\n');
  }

  // ================================================================ cities page

  function viewCities() {
    const reached = state.view === 'results' || (state.saved && state.saved.view === 'results');
    const rank = reached ? safeRank() : null;
    const secs = state.ds.offices.map(o => {
      const k = o.key, c = cityOf(k), g = guideOf(k);
      const my = rank && rank.results.find(r => r.key === k);
      const kv = (fid, label) => {
        const f = state.ds.features[fid];
        return `<div class="kv"><div class="kv__k">${esc(label || f.label)}</div><div class="kv__v">${esc(E.formatValue(f, f.values.get(k)))}</div><div class="kv__c">${esc(E.compareLine(state.ds, fid, k, E.climateTargets(S(), {})).replace(/ of the 500 cities/, ' of 500 cities'))}</div></div>`;
      };
      const anchor = `city-${c.city.toLowerCase().replace(/[^a-z]+/g, '-')}-${c.state.toLowerCase()}`;
      return `<section class="citysec" id="${anchor}">
        ${photoFigure(k, 1200)}
        <div>
          <h2 class="citysec__name">${esc(c.city)}</h2>
          <p class="citysec__meta">${esc(stateName(c.state))}, ${Math.round(milesFromHQ(k))} miles from Chicago. Team average ${one(o.avg)}, #${o.rank} of ${state.ds.combined.length}.${my ? ` <strong>#${my.position} for you (${one(my.total)}).</strong>` : ''}</p>
          ${g ? `<p class="citysec__summary">${esc(g.summary)}</p><ul class="citysec__facts">${g.facts.map(f => `<li>${esc(f.text)}</li>`).join('')}</ul>` : '<p class="citysec__summary muted">No city guide written yet. The numbers below come from the team data.</p>'}
          <div class="citysec__nums">
            ${kv('cost_of_living')}${kv('housing_costs', 'Housing costs per year')}
            ${kv('employment_rate')}${kv('violent_crime', 'Violent crimes per 100,000')}
            ${kv('january_temp', 'January average')}${kv('july_temp', 'July average')}
          </div>
          ${g && g.source ? `<p class="citysec__src">City facts: <a href="${esc(g.source.url)}" target="_blank" rel="noopener">${esc(g.source.title)}</a>. Numbers: team datasets (see How we chose).</p>` : ''}
        </div>
      </section>`;
    }).join('');
    return `<div class="cities__intro">
        <div><h1 class="page__title">The ${['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'][state.ds.offices.length] || state.ds.offices.length} office cities</h1>
        <p class="lede" style="margin-top:16px">Where Redwood plans to open, in the order our combined team research ranked them. Distances are straight-line miles from the Chicago headquarters.</p></div>
        <div class="atlas">${atlasSVG()}</div>
      </div>${secs}`;
  }
  function safeRank() { try { return state.rank || computeRank(); } catch (e) { return null; } }

  // ================================================================ how we chose

  function viewHow() {
    const ds = state.ds, s = S();
    const groupsRows = ds.groups.map(g => `<div class="status__row${g.status === 'ok' ? '' : ' is-off'}"><span class="status__dot"></span><span><strong>${esc(g.label)}</strong>: ${g.status === 'ok' ? `${g.scores.size} cities scored (${esc(s.groups[g.id].score_column)})` : esc(g.message.replace(/^[^:]+: /, ''))}</span></div>`).join('');
    const offices = new Set(ds.offices.map(o => o.key));
    const skipped = new Map(ds.skipped.map(x => [x.key, x.reason]));
    const lastOffice = Math.max(...ds.offices.map(o => o.rank || 0));
    const top = ds.combined.slice(0, Math.max(10, lastOffice + 2));
    const active = ds.groups.filter(g => g.status === 'ok');
    const tableRows = top.map(r => `<tr class="${offices.has(r.key) ? 'is-office' : skipped.has(r.key) ? 'is-skipped' : ''}">
      <td class="n">${r.rank}</td><td>${offices.has(r.key) ? cityRef(r.key, `${r.city}, ${r.state}`) : esc(`${r.city}, ${r.state}`)}</td>
      ${active.map(g => `<td class="n">${r.byGroup[g.id] != null ? r.byGroup[g.id].toFixed(1) : '–'}</td>`).join('')}
      <td class="n">${r.avg.toFixed(2)}</td><td>${offices.has(r.key) ? 'Office' : skipped.has(r.key) ? `Skipped: ${esc(skipped.get(r.key))}` : ''}</td></tr>`).join('');
    const presets = Object.values(s.presets).map(p => `<tr><td>${esc(p.label)}</td><td>${p.first}</td><td>${p.second}</td><td>${p.third}</td><td>${p.rest}</td></tr>`).join('');
    const ex = E.categoryWeights(s, { ranked: ['housing', 'financial', 'safety'], strength: 'strong' }, ds);
    const exF = E.featureWeights(s, ex.weights, ds);
    return `<div class="how">
      <div>
        <h1 class="page__title">How we chose</h1>
        <p class="lede" style="margin-top:16px;max-width:52ch">Two separate decisions: which five cities get offices (the team's), and which of those five fits you (yours).</p>
        <ol class="steps">
          <li><h3>Four teams each ranked all 500 cities</h3>
            <p>Each age group picked its own measures and weights from public data on the 500 largest U.S. cities: costs, income, jobs, crime, health, commutes, hazards and climate.</p>
            <div class="status" style="margin-top:12px">${groupsRows}</div></li>
          <li><h3>We averaged the scores, every group counting the same</h3>
            <p>A city's team score is the plain average of the age-group scores it has. ${ds.groups.some(g => g.status !== 'ok') ? 'A group whose file has no score column yet is left out until it does; the app adds it automatically.' : ''}</p></li>
          <li><h3>One office per metro area</h3>
            <p>Going down the averaged list, we skip any city within ${s.min_miles_between_offices} miles of an office we've already picked, so the five offices reach five different areas.</p>
            <div class="tablewrap"><table class="datatable"><thead><tr><th class="n">#</th><th>City</th>${active.map(g => `<th class="n">${esc(g.label.replace('Ages ', ''))}</th>`).join('')}<th class="n">Average</th><th></th></tr></thead><tbody>${tableRows}</tbody></table></div></li>
          <li><h3>Your answers put the five in your order</h3>
            <p>You rank your top three of eight measured categories and say how much the first one counts. That sets each category's share of 100. Inside a category, the share is split across its measures in the proportions our team used. Each measure is scored 0–100 against all 500 cities, and the city's score is the weighted sum.</p>
            <p>Example (Strong preference, Housing first): Housing gets 40%, split into housing costs ${pct(exF.housing_costs)}% and housing problems ${pct(exF.housing_problems)}% (the team's 15 : 10).</p>
            <p>Everything else you tell us (who's moving, your home plans, dealbreakers, trade-offs, what feels like home) shapes the notes you see, never the score. Recreation and school quality aren't in our data, so we describe them instead of scoring them.</p></li>
          <li><h3>What the scores can't tell you</h3>
            <p>Scores compare cities with each other under the weights you chose; a higher score means a closer match to your answers, not a better place to live. Most measures are county values applied to a city, and some are estimates (marked in each city's math). We have no data on actual rents or home prices, school quality, job openings or neighborhood feel.</p></li>
        </ol>
      </div>
      <aside>
        <div class="aside-card"><h3>The three strength settings</h3>
          <p class="small muted">Shares of 100 for your first, second and third picks; the rest is split evenly across the other five categories. These are design choices we made, not research findings.</p>
          <table class="presets"><thead><tr><th>Setting</th><th>1st</th><th>2nd</th><th>3rd</th><th>Rest</th></tr></thead><tbody>${presets}</tbody></table></div>
        <div class="aside-card"><h3>Data sources</h3>
          <p class="small">CDC 500 Cities (2019); county health, climate and labor data from the JsonOfCounties collection; FEMA National Risk Index; AdvisorSmith cost of living index; Census county income (QuickFacts via CORGIS); Kaggle U.S. household income (20–30 and 50–60 files); city coordinates from CDC 500 Cities. City guides from Wikipedia; photos from Wikimedia Commons.</p></div>
      </aside>
    </div>`;
  }

  // ================================================================ popover

  let popTimer = null, popFor = null;
  function showPopover(el) {
    const key = el.dataset.city;
    if (!key || !cityOf(key)) return;
    const pop = $('#popover');
    const c = cityOf(key), g = guideOf(key);
    const my = state.rank && state.view === 'results' ? state.rank.results.find(r => r.key === key) : null;
    const anchor = `city-${c.city.toLowerCase().replace(/[^a-z]+/g, '-')}-${c.state.toLowerCase()}`;
    pop.innerHTML = `${photoFrame(key, 640)}
      <div class="popover__body"><p class="popover__name">${esc(c.city)}, ${esc(c.state)}</p>
      <p class="popover__meta">${Math.round(milesFromHQ(key))} miles from Chicago</p>
      ${g ? `<p class="popover__summary">${esc(g.summary)}</p>` : ''}
      ${my ? `<p class="popover__score">#${my.position} for you, ${one(my.total)} points</p>` : ''}
      <div class="popover__links"><a href="#cities/${anchor}" data-action="close-pop">City guide</a></div></div>
      ${g && g.photo ? `<div class="popover__credit">${photoCredit(key).replace(/<span>[^<]*<\/span>/, '')}</div>` : ''}`;
    pop.hidden = false;
    popFor = el;
    $$('[data-city][aria-expanded="true"]').forEach(x => x.setAttribute('aria-expanded', 'false'));
    if (el.tagName === 'BUTTON') el.setAttribute('aria-expanded', 'true');
    const r = el.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let left = r.left + window.scrollX + r.width / 2 - w / 2;
    left = Math.max(window.scrollX + 12, Math.min(left, window.scrollX + document.documentElement.clientWidth - w - 12));
    let top = r.bottom + window.scrollY + 8;
    if (r.bottom + h + 16 > window.innerHeight && r.top - h - 8 > 0) top = r.top + window.scrollY - h - 8;
    pop.style.left = `${left}px`; pop.style.top = `${top}px`;
  }
  function closePopover() {
    const pop = $('#popover');
    if (!pop || pop.hidden) return;
    pop.hidden = true;
    if (popFor && popFor.tagName === 'BUTTON') popFor.setAttribute('aria-expanded', 'false');
    popFor = null;
  }

  const hoverCapable = window.matchMedia && matchMedia('(hover: hover)').matches;
  document.addEventListener('mouseover', e => {
    if (!hoverCapable) return;
    const el = e.target.closest('[data-city]');
    const inPop = e.target.closest('#popover');
    if (el) { clearTimeout(popTimer); if (popFor !== el) popTimer = setTimeout(() => showPopover(el), 160); }
    else if (inPop) clearTimeout(popTimer);
    else if (popFor) { clearTimeout(popTimer); popTimer = setTimeout(closePopover, 220); }
  });
  document.addEventListener('focusin', e => { const el = e.target.closest && e.target.closest('[data-city]'); if (el && e.target.matches(':focus-visible')) showPopover(el); });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { const f = popFor; closePopover(); if (f) f.focus(); }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('atlas__hit')) { e.preventDefault(); showPopover(e.target); }
  });

  // tooltip for chart segments
  let tip = null;
  document.addEventListener('pointermove', e => {
    const seg = e.target.closest && e.target.closest('[data-tip]');
    if (!seg) { if (tip) tip.hidden = true; return; }
    if (!tip) { tip = document.createElement('div'); tip.className = 'tip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
    tip.textContent = seg.dataset.tip; tip.hidden = false;
    tip.style.left = `${e.pageX + 12}px`; tip.style.top = `${e.pageY - 34}px`;
  });

  // ================================================================ actions

  function go(view, step) {
    state.view = view;
    if (step !== undefined) state.step = step;
    state.notice = '';
    if (location.hash && location.hash !== '#fit') { history.pushState(null, '', '#fit'); }
    persist();
    render(true);
    const t = $('#step-title'); if (t) t.focus({ preventScroll: true });
  }

  document.addEventListener('click', async e => {
    const cityEl = e.target.closest('[data-city]');
    if (cityEl && !e.target.closest('#popover')) {
      e.preventDefault();
      if (popFor === cityEl && !$('#popover').hidden) closePopover(); else showPopover(cityEl);
      return;
    }
    if (!e.target.closest('#popover') && popFor) closePopover();
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const act = btn.dataset.action, v = btn.dataset.v, a = state.answers;
    const commit = () => { state.prevMix = state.prevMixNext; persist(); render(); };
    switch (act) {
      case 'start': state.answers = blankAnswers(); state.saved = null; state.chat = blankChat(); state.prevMix = null; go('step', 0); break;
      case 'resume': go('results'); break;
      case 'back': if (state.step === 0) go('cover'); else go('step', state.step - 1); break;
      case 'next': if (!stepDone(state.step)) return; if (state.step >= state.questions.steps.length - 1) go('review'); else go('step', state.step + 1); break;
      case 'goto': go('step', Number(v)); break;
      case 'review': go('review'); break;
      case 'results': state.open = {}; go('results'); break;
      case 'reset': store.clear(); state.answers = blankAnswers(); state.saved = null; state.rank = null; state.prevMix = null; state.chat = blankChat(); go('cover'); break;
      case 'pick': {
        const q = btn.dataset.q;
        a[q] = a[q] === v ? null : v;
        commit(); break;
      }
      case 'toggle': {
        const q = btn.dataset.q;
        const def = state.questions.steps.flatMap(s => s.questions).find(x => x.id === q);
        const opt = def.options.find(o => o.id === v);
        let cur = new Set(a[q] || []);
        if (cur.has(v)) cur.delete(v);
        else if (opt.exclusive) cur = new Set([v]);
        else { for (const o of def.options) if (o.exclusive) cur.delete(o.id); cur.add(v); }
        a[q] = [...cur]; commit(); break;
      }
      case 'rank': {
        state.notice = '';
        a.skipRanking = false;
        const i = a.ranked.indexOf(v);
        if (i >= 0) { a.ranked.splice(i, 1); if (v === 'weather') { a.winter = null; a.summer = null; } }
        else if (a.ranked.length < 3) a.ranked.push(v);
        else state.notice = 'You already have three. Tap one of them to remove it, then pick again.';
        commit(); break;
      }
      case 'qual': {
        const i = a.alsoMatters.indexOf(v);
        if (i >= 0) a.alsoMatters.splice(i, 1); else a.alsoMatters.push(v);
        state.notice = i >= 0 ? '' : 'Noted. Recreation isn\'t in our data as a score, so it won\'t change the numbers. Your results will describe what each city offers instead.';
        commit(); break;
      }
      case 'skip-rank': a.skipRanking = true; state.notice = ''; commit(); break;
      case 'unskip': a.skipRanking = false; commit(); break;
      case 'strength': a.strength = v; commit(); break;
      case 'whatif': if (a.strength !== v) { a.strength = v; state.animateBoard = true; persist(); render(); } break;
      case 'audit': state.open[v] = !state.open[v]; render(); break;
      case 'chip': sendChat(v); break;
      case 'chat-new': clearTimeout(openTimer); state.chat = { ...blankChat(), sig: state.chat.sig }; render(); break;
      case 'chat-retry': {
        const c = state.chat;
        const last = c.messages[c.messages.length - 1];
        if (last && last.role === 'user') { c.status = 'idle'; sendChat(''); }
        else if (!c.messages.length) { c.status = 'idle'; c.error = ''; c.opening = 'none'; render(); }
        else { c.status = 'idle'; c.error = ''; render(); }
        break;
      }
      case 'copy': {
        const text = summaryText();
        const out = $('[data-copy-status]');
        try { await navigator.clipboard.writeText(text); if (out) out.textContent = ' Copied.'; }
        catch (err) {
          const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
          let ok = false; try { ok = document.execCommand('copy'); } catch (x) { ok = false; }
          ta.remove(); if (out) out.textContent = ok ? ' Copied.' : ' Copying is blocked here. Select the text in the results instead.';
        }
        break;
      }
      case 'close-pop': closePopover(); break;
      default: break;
    }
  });

  document.addEventListener('submit', e => {
    const gate = e.target.closest('[data-form="gate"]');
    if (gate) {
      e.preventDefault();
      const code = gate.code.value.trim();
      if (!code) { gate.code.focus(); return; }
      state.aiCode = code; state.chat.error = ''; state.chat.status = 'idle';
      openChat();
      return;
    }
    const form = e.target.closest('[data-form="guide"]');
    if (!form) return;
    e.preventDefault();
    const q = form.q.value.trim();
    if (!q) { form.q.focus(); return; }
    sendChat(q);
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'guide-q') {
      state.chat.draft = e.target.value;
      e.target.style.height = 'auto';
      e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
    }
  });
  document.addEventListener('keydown', e => {
    if (e.target.id === 'guide-q' && e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      e.target.form.requestSubmit();
    }
  });

  window.addEventListener('resize', () => closePopover());
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => render());

  boot();
})();
