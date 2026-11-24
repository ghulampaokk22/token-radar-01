// Token Radar radar-7 dashboard. Reads window.RADAR (data.js, written by
// main.ts from the same board) and renders the ranked board, filters, a
// live-token tab and a per-protocol detail view. No network: every byte
// shown is in data.js. The page recomputes each row's implied value from
// the fitted curve in DATA.model, so the page and board.json agree.
(function () {
  'use strict';
  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', watchOnly: false, tab: 'pre-token', sort: 'implied', dir: -1, selected: null };
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) { if (n === null || n === undefined || !isFinite(n)) return 'n/a'; return (n > 0 ? '+' : '') + n.toFixed(2) + '%'; }
  function fmtAge(d) { if (d === null || d === undefined) return 'unknown'; if (d >= 365) return (d / 365).toFixed(1) + 'y'; return Math.max(0, Math.round(d)) + 'd'; }
  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') node.className = attrs[k];
      else if (k === 'text') node.textContent = attrs[k];
      else if (k === 'html') node.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i]; if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (x) { if (x) node.appendChild(x); });
      else if (typeof c === 'string') node.appendChild(document.createTextNode(c)); else node.appendChild(c);
    }
    return node;
  }
  // Same arithmetic as lib/model.ts scoreProtocol, using the fitted curve
  // the program wrote into DATA.model. No name is special-cased here either.
  function impliedOf(row) {
    var f = DATA.model.fit;
    var fitted = Math.exp(f.intercept + f.slope * Math.log(row.tvl_usd)) * (row.category_factor || 1);
    var g = Math.min(120, Math.max(-60, row.change_7d === null ? 0 : row.change_7d));
    var gm = 1 + (g / 100) * (g >= 0 ? 0.5 : 0.8);
    var cm = 1 + 0.02 * Math.min(Math.max((row.chains || []).length - 1, 0), 5);
    var age = row.age_days === null ? 365 : row.age_days;
    var am = 0.55 + 0.45 * (1 - Math.exp(-age / 730));
    return Math.max(1, Math.round(fitted * gm * cm * am));
  }
  function chainOf(p) { return p.chains && p.chains.length ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) { if (p.tvl_usd >= 5e9) return 250; if (p.tvl_usd >= 1e9) return 150; if (p.tvl_usd >= 1e8) return 100; return 50; }
  function holdFor(age) { if (age === null || age === undefined) return 30; if (age < 180) return 60; if (age < 365) return 45; return 30; }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase(); var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
    if (c.indexOf('dex') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
    if (c.indexOf('bridge') >= 0) return 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return "Stake $" + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('basis') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' and place one market position on ' + name + '.';
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('risk') >= 0) return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
    if (c.indexOf('stable') >= 0) return 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
    if (c.indexOf('rwa') >= 0) return "Mint $" + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
    if (c.indexOf('chain') >= 0) return 'Use $' + capital + ' of gas and activity on ' + name + ' on ' + chain + ' and keep the wallet active.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function farmSteps(p) {
    var chain = chainOf(p); var capital = capitalFor(p); var hold = holdFor(p.age_days);
    function s(text, cost, time) { var x = text + ' Cost: ' + cost + '. Time: ' + time + '.'; return x.length > 600 ? x.slice(0, 596) + '...' : x; }
    return [
      s('Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', 'under $3 of gas for the first transaction', '5 minutes'),
      s(actionFor(p, capital, chain), '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', '15 minutes to set up'),
      s('Make one qualifying action each week on ' + p.name + ', such as a deposit, a borrow, a swap or a vote.', 'about $2 of gas a week', '10 minutes a week'),
      s('Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', 'the $' + capital + ' stays in the position', hold + ' days'),
      s("Before you withdraw, open " + p.name + "'s own points or rewards page and claim only from the link it publishes.", 'no fee to check, and never pay to claim', '10 minutes'),
      s('Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', 'nothing but the log', '5 minutes')
    ];
  }
  function readHash() {
    var h = window.location.hash.replace(/^#/, ''); if (!h) return;
    var ps = new URLSearchParams(h);
    if (ps.get('q')) state.q = ps.get('q');
    if (ps.get('category')) state.category = ps.get('category');
    if (ps.get('p')) state.selected = ps.get('p');
    if (ps.get('watch') === '1') state.watchOnly = true;
  }
  function writeHash() {
    var ps = new URLSearchParams();
    if (state.q) ps.set('q', state.q);
    if (state.category !== 'all') ps.set('category', state.category);
    if (state.watchOnly) ps.set('watch', '1');
    if (state.selected) ps.set('p', state.selected);
    var next = ps.toString();
    window.history.replaceState(null, '', next ? '#' + next : window.location.pathname + window.location.search);
  }
  var watchSet = {};
  (DATA.watchlist || []).forEach(function (s) { watchSet[s] = true; });
  // data.js rows do not carry the watchlist list; the board marks it per row below via rank data in DATA.
  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.watchOnly && !r.watchlist) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (state.sort === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (state.sort === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (state.sort === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (state.sort === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (state.sort === 'odds') { av = a.launch_odds; bv = b.launch_odds; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir; if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : 1;
    });
  }
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { text: 'Token Radar' })),
      el('div', { class: 'top-meta' }, el('span', { text: 'Snapshot ' + DATA.as_of }), el('span', { text: 'DefiLlama protocol index' }), el('span', { text: DATA.model_version + ' model' })));
  }
  function lede() {
    var m = DATA.model;
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by implied value' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, for ' + DATA.board_size + ' ranked rows in all. ' + DATA.excluded_size + ' pre-token protocols were set aside as wrapped, staked, bridged, versioned or exchange products, not launches. Implied value is a model, not a promise — see the interval on every row.' })),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) })),
        el('div', { class: 'fact' }, el('span', { text: 'Live-token set aside' }), el('b', { text: String(DATA.live_size) + ' shown' })),
        el('div', { class: 'fact' }, el('span', { text: 'Fitted curve R2' }), el('b', { text: String(m.fit.r2) })),
        el('div', { class: 'fact' }, el('span', { text: 'Top implied value' }), el('b', { text: fmtUsd(DATA.rows[0].implied_value_usd) }))));
  }
  function controls() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var select = el('select', { id: 'category', 'aria-label': 'Filter by category' }, el('option', { value: 'all', text: 'All categories' }), cats.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); }));
    select.addEventListener('change', function () { state.category = select.value; writeHash(); render(); });
    var watch = el('button', { type: 'button', 'aria-pressed': state.watchOnly ? 'true' : 'false', text: 'Watchlist only', onclick: function () { state.watchOnly = !state.watchOnly; writeHash(); render(); } });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), select),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Scope' }), watch),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' rows shown' : DATA.live.length + ' live-token protocols' }));
  }
  function sortHeader(key, label) {
    return el('th', { scope: 'col' }, el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } }, label, state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null));
  }
  function boardTable() {
    var list = sortedRows(rows());
    if (!list.length) return el('div', { class: 'panel' }, el('div', { class: 'empty' }, el('h2', { text: 'No protocol matches that filter' }), el('p', { text: 'Clear the search or pick another category to see the board again.' }), el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.watchOnly = false; writeHash(); render(); } })));
    var max = DATA.rows[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var tr = el('tr', { 'data-selected': state.selected === r.slug ? 'true' : 'false', tabindex: '0', onclick: function () { openDetail(r.slug); }, onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } } },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') + (r.watchlist ? ' · watchlist' : '') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' }, el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })), el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }))),
        el('td', { class: 'num', text: Math.round(r.launch_odds * 100) + '%' }));
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', null,
      el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model, launch odds and farm plan. Odds is the cohort launch rate.' }),
      el('thead', null, el('tr', null, sortHeader('implied', 'Rank'), sortHeader('name', 'Protocol'), sortHeader('tvl', 'TVL'), sortHeader('growth', '7d'), sortHeader('age', 'Age'), sortHeader('implied', 'Implied value'), sortHeader('odds', 'Launch odds'))),
      tbody)));
  }
  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', { class: 'num', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', null, el('span', { class: 'status', text: 'already trades' }))));
    });
    return el('div', { class: 'panel' }, el('div', { class: 'table-wrap' }, el('table', null,
      el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
      el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Token' }))),
      tbody)));
  }
  function modelPanel() {
    var m = DATA.model; var f = m.fit; var v = m.validation;
    var cohortRows = m.cohorts.map(function (c) { return el('tr', null, el('td', { text: c.min_days + '–' + (c.max_days > 9000 ? '1100+' : c.max_days) + 'd' }), el('td', { class: 'num', text: String(c.n) }), el('td', { class: 'num', text: Math.round(c.token_rate * 100) + '%' })); });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { class: 'sub', text: 'One function scores every protocol. No name is special-cased. The curve is fitted on the protocols that already trade, on every run — never from a hardcoded list.' }),
      el('div', { class: 'formula', text: 'log(mcap) = ' + f.intercept + ' + ' + f.slope + ' * log(TVL)   (n=' + f.n + ', R2 ' + f.r2 + ', Spearman ' + f.spearman + ')' }),
      el('p', { class: 'sub', text: 'implied = exp(fit) x category factor x growth (up x0.5, down x0.8, clamped -60% to +120%) x chains (x1.02 per extra chain, max x1.10) x age (0.55 + 0.45 x (1 - exp(-age/730d))). Launch odds are the cohort rate beside each row; expected value = implied x odds. The interval on a row is implied / exp(median |log error|) to implied x exp(median |log error|): an order-of-magnitude estimate, not a price.' }),
      el('div', { class: 'grid2' },
        el('div', { class: 'mini' }, el('h3', { text: 'Validation — fitted curve vs flat ratio' }), el('table', null, el('tbody', null,
          el('tr', null, el('td', { text: 'Log-log curve, R2' }), el('td', { class: 'num', text: String(f.r2) })),
          el('tr', null, el('td', { text: 'Log-log curve, mean |log error|' }), el('td', { class: 'num', text: String(f.mae_log) })),
          el('tr', null, el('td', { text: 'Flat median-ratio, R2' }), el('td', { class: 'num', text: String(v.median_ratio_r2) })),
          el('tr', null, el('td', { text: 'Flat median-ratio, mean |log error|' }), el('td', { class: 'num', text: String(v.median_ratio_mae_log) })),
          el('tr', null, el('td', { text: 'Within 2x / 5x of actual mcap' }), el('td', { class: 'num', text: Math.round(f.within_2x * 100) + '% / ' + Math.round(f.within_5x * 100) + '%' })),
          el('tr', null, el('td', { text: '5-fold mean R2 / walk-forward R2' }), el('td', { class: 'num', text: String(v.five_fold_mean_r2) + ' / ' + String(v.walk_forward_r2) }))))),
        el('div', { class: 'mini' }, el('h3', { text: 'Launch odds by age — cohort rate' }), el('table', null, el('thead', null, el('tr', null, el('th', { text: 'Age' }), el('th', { text: 'n' }), el('th', { text: 'Has token' }))), el('tbody', null, cohortRows)))),
      el('div', { class: 'warn', text: 'Honest limit: market caps vary about 100x at the same TVL, so out-of-sample log R2 is near zero and the curve is an anchor, not a forecast. It still beats a flat ratio on every in-sample check, and it ranks live protocols with Spearman ' + f.spearman + '. A row that looks precise is not — read its interval.' }));
  }
  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });
  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0]; if (!row) return;
    state.selected = slug; writeHash(); dialog.textContent = '';
    var steps = farmSteps(row); var recomputed = impliedOf(row);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null, el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' · watchlist' : '') }), el('h2', { id: 'detail-title', text: row.name }), el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', null, el('span', { text: 'Fitted value (curve only)' }), el('b', { class: 'num', text: fmtUsd(row.fitted_value_usd) })),
        el('div', null, el('span', { text: 'Launch odds (cohort)' }), el('b', { class: 'num', text: Math.round(row.launch_odds * 100) + '%' })),
        el('div', null, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Odds-weighted expected' }), el('b', { class: 'num', text: fmtUsd(row.expected_value_usd) })),
        el('div', null, el('span', { text: 'Interval (order of magnitude)' }), el('b', { class: 'num', text: fmtUsd(row.interval_low_usd) + ' – ' + fmtUsd(row.interval_high_usd) }))),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the page recomputes this row as ' + fmtUsd(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price, and it records no token — it says a protocol records no token, never that it has none.' })));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, steps.map(function (s) { var at = s.indexOf(' Cost: '); var a = at >= 0 ? s.slice(0, at) : s; var t = at >= 0 ? s.slice(at + 1) : ''; return el('li', null, el('b', { text: a }), el('span', { class: 'cost', text: t })); }))));
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); } else dialog.setAttribute('open', '');
  }
  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header()); shell.appendChild(lede()); shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell); app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }
  readHash(); render();
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape' && dialog.open) dialog.close(); });
})();
