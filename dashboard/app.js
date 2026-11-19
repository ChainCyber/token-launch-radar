// Token Launch Radar dashboard. Reads window.RADAR (written beside this page
// by main.ts), renders the ranked board, filters, sorts and a per-protocol
// detail view. No network: every byte shown comes from data.js. Views are
// deep-linked in the URL hash: #slug=<slug> for a detail, #category=<cat> and
// #chain=<chain> for filtered views.
(function () {
  'use strict';
  var DATA = window.RADAR;
  var main = document.getElementById('main');
  if (!DATA || !DATA.rows) {
    if (main) main.innerHTML = '<p class="empty">No board data loaded.</p>';
    return;
  }
  var rows = DATA.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return '<span class="flat">n/a</span>';
    var cls = n > 0 ? 'pos' : n < 0 ? 'neg' : 'flat';
    return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(2) + '%</span>';
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }
  function chainsHtml(r) {
    return r.chains.slice(0, 4).map(function (c) {
      return '<a class="pill" href="#chain=' + encodeURIComponent(c) + '">' + esc(c) + '</a>';
    }).join('') + (r.chains.length > 4 ? '<span class="pill">+' + (r.chains.length - 4) + '</span>' : '');
  }

  // ---- header stats + top-5 ticker -------------------------------------
  var wlCount = rows.filter(function (r) { return r.watchlist; }).length;
  $('stats').innerHTML =
    stat('Rows', rows.length) + stat('Watchlist', wlCount) +
    stat('Snapshot', esc(DATA.as_of)) + stat('Floor', money(DATA.floor_usd));
  function stat(k, v) { return '<div><dt>' + k + '</dt><dd>' + v + '</dd></div>'; }
  $('ticker').innerHTML = '<span>Top 5:</span>' + rows.slice(0, 5).map(function (r) {
    return '<a class="tk" href="#slug=' + encodeURIComponent(r.slug) + '"><b>#' + r.rank + ' ' + esc(r.name) + '</b> ' + money(r.implied_value_usd) + '</a>';
  }).join('');
  $('source').textContent = 'Snapshot: ' + DATA.source + '. All figures on this page come from that snapshot alone — no live data, no network.';

  // ---- controls ----------------------------------------------------------
  var cats = [], chains = [];
  rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  $('cat').innerHTML += cats.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');
  $('chain').innerHTML += chains.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('');

  var state = { q: '', cat: 'all', chain: 'all', mintvl: 0, sort: 'rank', watchonly: false, slug: null };

  function parseHash() {
    var h = location.hash.replace(/^#/, '');
    var out = {};
    h.split('&').forEach(function (pair) {
      var kv = pair.split('=');
      if (kv[0]) out[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
    });
    return out;
  }
  function applyHash() {
    var h = parseHash();
    state.slug = h.slug || null;
    if (h.category && cats.indexOf(h.category) >= 0) { state.cat = h.category; $('cat').value = h.category; }
    if (h.chain && chains.indexOf(h.chain) >= 0) { state.chain = h.chain; $('chain').value = h.chain; }
    render();
  }
  function pushHash() {
    var parts = [];
    if (state.slug) parts.push('slug=' + encodeURIComponent(state.slug));
    if (state.cat !== 'all') parts.push('category=' + encodeURIComponent(state.cat));
    if (state.chain !== 'all') parts.push('chain=' + encodeURIComponent(state.chain));
    var next = parts.length ? '#' + parts.join('&') : '#';
    if (location.hash !== next) history.replaceState(null, '', next);
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (state.watchonly && !r.watchlist) return false;
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.mintvl) return false;
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0)) return false;
      return true;
    });
    var s = state.sort;
    var sorted = list.slice();
    if (s === 'implied') sorted.sort(function (a, b) { return b.implied_value_usd - a.implied_value_usd; });
    else if (s === 'tvl') sorted.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (s === 'growth') sorted.sort(function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); });
    else if (s === 'age') sorted.sort(function (a, b) { return (b.age_days || 0) - (a.age_days || 0); });
    else sorted.sort(function (a, b) { return a.rank - b.rank; });
    return sorted;
  }

  function renderBoard(list) {
    $('count').textContent = list.length + ' of ' + rows.length + ' protocols' +
      (state.watchonly ? ' · watchlist only' : '') +
      (state.cat !== 'all' ? ' · ' + state.cat : '') +
      (state.chain !== 'all' ? ' · ' + state.chain : '') +
      (state.mintvl ? ' · TVL ≥ ' + money(state.mintvl) : '');
    if (!list.length) {
      $('rows').innerHTML = '<tr><td colspan="8" class="empty">Nothing matches these filters. Loosen one and try again.</td></tr>';
      return;
    }
    $('rows').innerHTML = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.slug === r.slug ? ' class="sel"' : '') + '>' +
        '<td class="rank">#' + r.rank + '</td>' +
        '<td><span class="nm">' + esc(r.name) + '</span> <span class="sl">' + esc(r.slug) + '</span>' +
        (r.watchlist ? ' <span class="pill wl">watchlist</span>' : '') + '</td>' +
        '<td><a class="pill cat" href="#category=' + encodeURIComponent(r.category || '') + '">' + esc(r.category || '—') + '</a></td>' +
        '<td>' + chainsHtml(r) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num val">' + money(r.implied_value_usd) + '</td>' +
        '<td class="num">' + r.farm_steps.length + ' steps</td></tr>';
    }).join('');
  }

  function renderDetail(r) {
    var m = r.model;
    var raw = r.tvl_usd * m.category_ratio * m.growth_factor * m.age_factor * m.chain_factor;
    var tieNote = Math.abs(raw - r.implied_value_usd) >= 1
      ? ' The board figure is shaved by $1 steps where ties would stand, so it can sit just below the raw product.'
      : '';
    $('detail').hidden = false;
    $('detail').innerHTML =
      '<a class="back" href="#">← Back to the board</a>' +
      '<h2>#' + r.rank + ' ' + esc(r.name) + '</h2>' +
      '<p class="meta"><b>' + esc(r.slug) + '</b> · ' + esc(r.category || 'no category') + ' · ' +
      esc(r.chains.join(', ') || 'no chains') + ' · TVL ' + moneyFull(r.tvl_usd) + ' · 7d ' + pct(r.change_7d).replace(/<[^>]+>/g, '') +
      ' · tracked ' + ageLabel(r.age_days) + (r.listed_at ? ' (since ' + esc(r.listed_at) + ')' : '') +
      (r.watchlist ? ' · <b>on the watchlist</b>' : '') +
      ' · records no token</p>' +
      '<div class="grid"><div><h3>Farm plan — ' + r.farm_steps.length + ' steps</h3><ol>' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol><p class="hint">Each step names its cost and its time. No step asks you to pay for a token: none is confirmed.</p></div>' +
      '<div><h3>Model breakdown — ' + esc(DATA.model_version || 'comps-2') + '</h3>' +
      '<p class="eq">' + moneyFull(r.tvl_usd) + ' × ' + m.category_ratio.toFixed(4) + ' × ' + m.growth_factor.toFixed(4) +
      ' × ' + m.age_factor.toFixed(4) + ' × ' + m.chain_factor.toFixed(4) +
      '<span class="res">= ' + moneyFull(r.implied_value_usd) + ' implied value</span></p>' +
      '<table class="modeltbl"><tbody>' +
      tr('TVL', moneyFull(r.tvl_usd)) +
      tr('Category ratio (' + esc(m.ratio_source) + ')', m.category_ratio.toFixed(4) + ' × — median mcap/TVL of ' + m.comps_used + ' tokenized comp' + (m.comps_used === 1 ? '' : 's') + (m.ratio_source === 'global' ? ' (global fallback: fewer than 3 in-category comps)' : '')) +
      tr('Growth factor', m.growth_factor.toFixed(4) + ' — 7d change ' + (m.growth_pct_used === null ? 'unreported' : (m.growth_pct_used > 0 ? '+' : '') + m.growth_pct_used + '%') + ', clamped to −50%…+100%') +
      tr('Age factor', m.age_factor.toFixed(4) + ' — tracked ' + ageLabel(m.age_days) + (m.age_days === null ? ' (no listing date, factor 1.00)' : '')) +
      tr('Chain factor', m.chain_factor.toFixed(4) + ' — ' + m.num_chains + ' chain' + (m.num_chains === 1 ? '' : 's')) +
      tr('Global median ratio', DATA.median_ratio_global.toFixed(4)) +
      '</tbody></table><p class="hint">' + esc(tieNote.trim()) + ' Implied value is the entry\u2019s own claim from the snapshot\u2019s figures, never a market price.</p>' +
      '</div></div>';
    function tr(k, v) { return '<tr><td>' + k + '</td><td>' + v + '</td></tr>'; }
  }

  function render() {
    var list = filtered();
    renderBoard(list);
    if (state.slug && bySlug[state.slug]) renderDetail(bySlug[state.slug]);
    else $('detail').hidden = true;
  }

  // ---- events ------------------------------------------------------------
  $('q').addEventListener('input', function (e) { state.q = e.target.value; state.slug = null; pushHash(); render(); });
  $('cat').addEventListener('change', function (e) { state.cat = e.target.value; state.slug = null; pushHash(); render(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; state.slug = null; pushHash(); render(); });
  $('mintvl').addEventListener('change', function (e) { state.mintvl = Number(e.target.value); state.slug = null; pushHash(); render(); });
  $('sort').addEventListener('change', function (e) { state.sort = e.target.value; render(); });
  $('watchonly').addEventListener('change', function (e) { state.watchonly = e.target.checked; state.slug = null; pushHash(); render(); });
  $('reset').addEventListener('click', function () {
    state = { q: '', cat: 'all', chain: 'all', mintvl: 0, sort: 'rank', watchonly: false, slug: null };
    $('q').value = ''; $('cat').value = 'all'; $('chain').value = 'all'; $('mintvl').value = '0';
    $('sort').value = 'rank'; $('watchonly').checked = false;
    history.replaceState(null, '', '#'); render();
  });
  document.querySelectorAll('thead th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var map = { rank: 'rank', implied: 'implied', tvl: 'tvl', growth: 'growth', name: 'rank' };
      state.sort = map[th.getAttribute('data-sort')] || 'rank';
      $('sort').value = state.sort; render();
    });
  });
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (!tr) return;
    state.slug = tr.getAttribute('data-slug');
    pushHash(); render();
    $('detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('detail').addEventListener('click', function (e) {
    if (e.target.classList.contains('back')) {
      e.preventDefault(); state.slug = null; pushHash(); render();
      $('boardwrap').scrollIntoView({ behavior: 'smooth' });
    }
  });
  window.addEventListener('hashchange', applyHash);
  applyHash();
})();
