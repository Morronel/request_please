// DOM/UI layer for REQUEST, PLEASE.
import { Game, DIFFICULTY, CLASSES, SITE, DECODERS } from './engine.js';

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};

const settings = {
  scanlines: store.get('waf.scanlines', true),
  haptics: store.get('waf.haptics', true),
};
function vibrate(ms) { if (settings.haptics && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} } }
function applyScanlines() { document.body.classList.toggle('scanlines', settings.scanlines); }

let game = null;
let chosenDiff = 'easy';
let timerId = null;
let timeLeft = 0, timeBudget = 0;
let awaiting = false;
// Per-request decoder working state: field -> current peeled value.
let work = {};

const app = $('#app');

// =============================================================== bottom sheet
function openSheet(title, build, opts = {}) {
  let wrap = $('#sheet');
  if (!wrap) {
    wrap = el('div', 'sheet-wrap'); wrap.id = 'sheet';
    wrap.innerHTML = '<div class="scrim"></div><div class="sheet"></div>';
    document.body.appendChild(wrap);
  }
  const scrim = $('.scrim', wrap);
  scrim.onclick = opts.sticky ? null : closeSheet;
  const sheet = $('.sheet', wrap);
  sheet.innerHTML = '<div class="grip"></div>';
  if (title) sheet.appendChild(el('h3', null, title));
  build(sheet);
  wrap.classList.add('open');
  return sheet;
}
function closeSheet() { const w = $('#sheet'); if (w) w.classList.remove('open'); }

// =============================================================== menu
function renderMenu() {
  stopTimer(); closeSheet();
  app.innerHTML = '';
  const s = el('div', 'screen');
  const best = store.get('waf.best', {});
  s.appendChild(el('div', 'logo', `REQUEST, PLEASE<small>WAF SIMULATOR &middot; ENDLESS</small>`));

  s.appendChild(el('div', 'brief',
    `<h4>Post: ${esc(SITE.name)} edge firewall</h4>
     <p class="muted">You screen traffic for ${esc(SITE.name)}, ${esc(SITE.tagline)}.
     Read each request, <b>decode</b> what it hides, then <b>PASS</b> real shoppers and
     <b>BLOCK</b> attacks. Every shift the boss adds a new directive, so keep up.</p>
     <h4>Standing orders</h4>
     <ul>${SITE.standing.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>`));

  const sel = el('div', 'diffsel');
  Object.entries(DIFFICULTY).forEach(([key, d]) => {
    const b = el('button', 'diffbtn' + (key === chosenDiff ? ' sel' : ''));
    b.innerHTML = `<b>${d.label}</b>${best[key] ? ` <span class="muted">&middot; best ${best[key]}</span>` : ''}
      <small>${esc(d.blurb)}</small>`;
    b.onclick = () => { chosenDiff = key; renderMenu(); };
    sel.appendChild(b);
  });
  s.appendChild(sel);

  const start = el('button', 'cta', '&#9654; START SHIFT');
  start.onclick = startGame;
  s.appendChild(start);

  s.appendChild(el('div', null,
    `<div class="hint" style="margin-top:14px">
       <label><input type="checkbox" id="optScan" ${settings.scanlines ? 'checked' : ''}> CRT scanlines</label>
       &nbsp;&nbsp;
       <label><input type="checkbox" id="optHap" ${settings.haptics ? 'checked' : ''}> Haptics</label>
     </div>
     <p class="hint">Desktop: <kbd>A</kbd>/<kbd>&larr;</kbd> pass &middot; <kbd>D</kbd>/<kbd>&rarr;</kbd> block &middot;
     <kbd>Space</kbd> decode &middot; <kbd>1</kbd>&ndash;<kbd>6</kbd> class</p>`));
  app.appendChild(s);

  $('#optScan').onchange = (e) => { settings.scanlines = e.target.checked; store.set('waf.scanlines', settings.scanlines); applyScanlines(); };
  $('#optHap').onchange = (e) => { settings.haptics = e.target.checked; store.set('waf.haptics', settings.haptics); };
}

// =============================================================== game shell
function startGame() {
  game = new Game(chosenDiff);
  app.innerHTML = '';
  app.appendChild(el('div', 'ticker', `<span id="tickText"></span>`));
  const hud = el('div', 'hud');
  hud.innerHTML =
    `<div class="meters">
       <span class="meter" id="mInt" title="Integrity (breaches)">&#9829;&#9829;&#9829;</span>
       <span class="meter star" id="mRep" title="Reputation (customers)">&#9733;&#9733;&#9733;</span>
     </div>
     <button class="hud-dir" id="bDir" title="Directives">&#128203; <span id="dirCount">0</span></button>
     <div class="score"><b id="sScore">0</b><div class="combo" id="sCombo">&nbsp;</div></div>`;
  app.appendChild(hud);
  const tb = el('div', 'timerbar'); tb.innerHTML = '<i id="tbar" style="width:100%"></i>';
  if (!game.diff.timer) tb.style.visibility = 'hidden';
  app.appendChild(tb);
  app.appendChild(el('div', 'shiftbar', `<span id="shiftLabel"></span>`));

  const main = el('main'); main.id = 'main';
  app.appendChild(main);

  const dec = el('div', 'decision');
  dec.innerHTML =
    `<button class="btn ghost" id="bDecode" title="Decoder">&#128269;</button>
     <button class="btn pass" id="bPass">PASS</button>
     <button class="btn block" id="bBlock">BLOCK</button>
     <button class="btn ghost" id="bRule" title="Rules">&#9881;</button>`;
  app.appendChild(dec);

  $('#bPass').onclick = () => decide('pass');
  $('#bBlock').onclick = openClassSheet;
  $('#bDecode').onclick = openDecoder;
  $('#bRule').onclick = openRuleSheet;
  $('#bDir').onclick = openDirectives;

  updateHud();
  startTicker();
  nextRequest();
}

function updateHud() {
  const fill = (ch, n) => ch.repeat(Math.max(0, n)) + `<span class="dim">${ch.repeat(Math.max(0, game.maxMeter - n))}</span>`;
  $('#mInt').innerHTML = fill('♥', game.integrity);
  $('#mRep').innerHTML = fill('★', game.reputation);
  $('#sScore').textContent = game.score;
  $('#dirCount').textContent = game.directives.length;
  $('#sCombo').innerHTML = game.combo >= 3 ? `combo &times;${game.comboMult()}` : '&nbsp;';
  const sl = $('#shiftLabel');
  if (sl) sl.innerHTML = `SHIFT ${game.shift} &middot; req ${game.inShift + 1}/${game.diff.shiftLen}`;
}

// =============================================================== render request
function nextRequest() {
  if (game.over) return endGame();
  const req = game.next();
  work = {};
  awaiting = true;
  const main = $('#main');
  main.innerHTML = '';

  const card = el('div', 'card'); card.id = 'card';
  card.innerHTML = `<div class="swipe-ind pass">&#9664; PASS</div><div class="swipe-ind block">BLOCK &#9654;</div>`;

  const meta = el('div', 'reqmeta');
  meta.innerHTML = `<span>#${req.seq}</span><span>${esc(req.ip)}</span><span>${esc(req.country)}</span>`;
  card.appendChild(meta);

  // Raw HTTP-style view.
  const pre = el('div', 'http');
  pre.appendChild(httpLine(req));
  card.appendChild(pre);

  if (req.rule) {
    card.appendChild(el('div', 'flag-auto',
      `&#9881; Matches your rule &ldquo;<b>${esc(describeRule(req.rule))}</b>&rdquo; &rarr; auto-BLOCK. Swipe/tap to override.`));
  }

  main.appendChild(card);
  main.appendChild(el('div', 'feedback', '&nbsp;'));
  // Test hook (only when ?test is in the URL): exposes ground truth so an
  // automated playtest can decide correctly. No effect in normal play.
  if (location.search.includes('test')) window.__waf = { kind: req.kind, accept: req.accept, isAttack: req.isAttack };
  setButtons(true);
  attachSwipe(card);
  startTimer();
  updateHud();
}

// Build the request/response block with tappable encoded tokens.
function httpLine(req) {
  const wrap = el('div');
  const qs = Object.keys(req.query).length
    ? '?' + Object.entries(req.query).map(([k, v]) => `${k}=${tokenHTML(k, String(v))}`).join('&amp;')
    : '';
  wrap.appendChild(rawRow(`<span class="hm">${esc(req.method)}</span> <span class="hp">${esc(req.path)}</span>${qs} <span class="hv">HTTP/1.1</span>`));
  wrap.appendChild(rawRow(`<span class="hk">Host:</span> meowmart.example`));
  Object.entries(req.headers).forEach(([k, v]) =>
    wrap.appendChild(rawRow(`<span class="hk">${esc(k)}:</span> ${tokenHTML(k, String(v), 'header')}`)));
  const bodyKeys = Object.keys(req.body);
  if (bodyKeys.length) {
    wrap.appendChild(rawRow('<span class="hk">Content-Type:</span> application/x-www-form-urlencoded'));
    wrap.appendChild(el('div', 'hblank', '&nbsp;'));
    wrap.appendChild(rawRow(bodyKeys.map((k) => `${k}=${tokenHTML(k, String(req.body[k]))}`).join('&amp;')));
  }
  // delegate token taps
  wrap.addEventListener('click', (e) => {
    const t = e.target.closest('.tok');
    if (t) { e.stopPropagation(); openDecoder(t.dataset.field); }
  });
  return wrap;
}
function rawRow(html) { return el('div', 'hrow', html); }

// A value becomes a tappable token when it looks encoded or interesting.
// Headers are only flagged on real encoding markers, so normal User-Agents,
// Hosts and tokens don't masquerade as decode targets.
function tokenHTML(field, val, grp) {
  const flag = grp === 'header' ? hasEncoding(val) : interesting(val);
  if (flag) return `<span class="tok" data-field="${esc(field)}">${esc(val)}</span>`;
  return `<span class="hval">${esc(val)}</span>`;
}
function hasEncoding(v) {
  return /%[0-9a-fA-F]{2}|&#x?[0-9a-fA-F]+;|\\x[0-9a-fA-F]{2}|\\u[0-9a-fA-F]{4}|^[A-Za-z0-9+/]{16,}={0,2}$/.test(v.trim());
}
function interesting(v) {
  return hasEncoding(v) ||
    /['"<>;(){}]|\.\.|UNION|SELECT|<script|onerror|onload|169\.254|localhost|\/etc\/|\$\(|`|\bor\b\s*1\s*=\s*1/i.test(v);
}
function describeRule(r) {
  const verb = { contains: 'contains', path: 'path', ip: 'IP' }[r.field];
  return `${verb} ${r.value}`;
}

// =============================================================== decoder
function openDecoder(field) {
  const req = game.current;
  if (!req) return;
  const fields = [];
  Object.entries(req.query).forEach(([k, v]) => fields.push(['query', k, String(v)]));
  Object.entries(req.body).forEach(([k, v]) => fields.push(['body', k, String(v)]));
  Object.entries(req.headers).forEach(([k, v]) => fields.push(['header', k, String(v)]));
  const only = field ? fields.filter(([, k]) => k === field) : fields;
  const list = (only.length ? only : fields);

  openSheet('&#128269; Decoder', (sheet) => {
    if (game.diff.autoDecode) {
      sheet.appendChild(el('p', 'muted', 'Tap-free on Easy: here is each field fully decoded.'));
      list.forEach(([grp, k, v]) => {
        const chain = game.decodeAll(v);
        const box = el('div', 'layer' + (chain.length > 1 ? ' final' : ''));
        box.innerHTML = `<div class="lname">${esc(grp)} &middot; ${esc(k)}${chain.length > 1 ? ` &middot; ${chain.length - 1} layer(s)` : ''}</div>
          <div class="lval">${esc(chain[chain.length - 1].value)}</div>`;
        sheet.appendChild(box);
      });
    } else {
      sheet.appendChild(el('p', 'muted', 'Pick a transform to peel one layer. Wrong guesses do nothing. Decode until it reads as plain text.'));
      list.forEach(([grp, k, v]) => sheet.appendChild(decoderField(grp, k, v)));
    }
    const close = el('button', 'cta', 'Close'); close.onclick = closeSheet;
    sheet.appendChild(close);
  });
  vibrate(6);
}

function decoderField(grp, k, raw) {
  const id = grp + ':' + k;
  if (work[id] === undefined) work[id] = raw;
  const box = el('div', 'decbox');
  const render = () => {
    box.innerHTML = '';
    box.appendChild(el('div', 'lname', `${esc(grp)} &middot; ${esc(k)}`));
    const cur = el('div', 'lval mono'); cur.textContent = work[id];
    box.appendChild(cur);
    const row = el('div', 'decbtns');
    DECODERS.forEach((d) => {
      const b = el('button', 'decbtn', esc(d.label));
      b.onclick = () => {
        const out = d.apply(work[id]);
        if (out == null || out === work[id]) {
          b.classList.add('no');
          setTimeout(() => b.classList.remove('no'), 350);
          vibrate(12);
        } else {
          work[id] = out;
          vibrate(8);
          render();
        }
      };
      row.appendChild(b);
    });
    box.appendChild(row);
    if (work[id] !== raw) {
      const reset = el('button', 'decreset', '&#8634; reset');
      reset.onclick = () => { work[id] = raw; render(); };
      box.appendChild(reset);
    }
  };
  render();
  return box;
}

// =============================================================== block + classify
function openClassSheet() {
  if (!awaiting) return;
  const classes = CLASSES.filter((c) => game.diff.classes.includes(c.id));
  openSheet('Classify the threat', (sheet) => {
    const grid = el('div', 'chips');
    classes.forEach((c, i) => {
      const chip = el('button', 'chip');
      chip.innerHTML = `<span class="e">${c.emoji}</span><span>${esc(c.label)}</span><span class="num">${i + 1}</span>`;
      chip.onclick = () => decide('block', c.id);
      grid.appendChild(chip);
    });
    sheet.appendChild(grid);
    if (!game.diff.requireClass) {
      const skip = el('button', 'cta block-cta', 'Block without a label');
      skip.onclick = () => decide('block', null);
      sheet.appendChild(skip);
    }
  });
  vibrate(6);
}

// =============================================================== rules
function openRuleSheet() {
  openSheet(`Firewall rules &middot; ${game.ruleSlotsLeft} slot${game.ruleSlotsLeft === 1 ? '' : 's'} left`, (sheet) => {
    if (game.rules.length) {
      game.rules.forEach((r, i) => {
        const row = el('div', 'rulerow');
        row.innerHTML = `<span>&#9881; block when ${esc(describeRule(r))}</span>`;
        const del = el('button', 'xbtn', '&times;');
        del.onclick = () => { game.removeRule(i); openRuleSheet(); updateHud(); };
        row.appendChild(del);
        sheet.appendChild(row);
      });
    }
    if (game.ruleSlotsLeft <= 0) {
      sheet.appendChild(el('p', 'muted', 'No slots left. Remove one to free it up. Loose rules block real customers.'));
    } else {
      sheet.appendChild(el('p', 'muted', 'Auto-block future matches. Rules see values after one URL-decode, like a real WAF. Keep them tight.'));
      const f = el('div');
      f.innerHTML =
        `<div class="field"><label>When</label>
          <select id="rField">
            <option value="contains">request contains</option>
            <option value="path">path starts with</option>
            <option value="ip">source IP starts with</option>
          </select></div>
         <div class="field"><label>Value</label>
          <input id="rVal" placeholder="UNION SELECT  /  /admin  /  198.51.100." autocapitalize="off" autocomplete="off" spellcheck="false"></div>`;
      sheet.appendChild(f);
      const add = el('button', 'cta', 'Add rule');
      add.onclick = () => {
        const field = $('#rField').value, value = $('#rVal').value.trim();
        if (!value) return;
        game.addRule({ field, value });
        closeSheet(); updateHud();
        flash(`Rule added: block when ${describeRule({ field, value })}`, 'good');
      };
      sheet.appendChild(add);
    }
    const close = el('button', 'decreset', 'Close'); close.onclick = closeSheet;
    sheet.appendChild(close);
  });
}

// =============================================================== directives drawer
function openDirectives() {
  openSheet('&#128203; Directives', (sheet) => {
    sheet.appendChild(el('h4', null, 'Standing orders'));
    SITE.standing.forEach((d) => sheet.appendChild(el('div', 'dirrow standing', esc(d))));
    sheet.appendChild(el('h4', null, `This run (${game.directives.length})`));
    if (!game.directives.length) sheet.appendChild(el('p', 'muted', 'None yet. The boss adds one each shift.'));
    game.directives.forEach((d) => sheet.appendChild(el('div', 'dirrow', esc(d.text))));
    const close = el('button', 'cta', 'Back'); close.onclick = closeSheet;
    sheet.appendChild(close);
  });
}

// =============================================================== decide
function setButtons(on) { ['#bPass', '#bBlock', '#bDecode', '#bRule'].forEach((s) => { const b = $(s); if (b) b.disabled = !on; }); }

function decide(decision, chosenClass) {
  if (!awaiting) return;
  awaiting = false;
  closeSheet(); stopTimer(); setButtons(false);
  const ratio = game.diff.timer ? 1 - (timeLeft / timeBudget) : 1;
  const res = game.resolve(decision, chosenClass, { timeRatio: ratio });
  afterResolve(res);
}

function afterResolve(res) {
  showStamp(res.correct, res.timeout);
  vibrate(res.correct ? 12 : [30, 40, 30]);
  flash(res.message, res.correct ? 'good' : 'bad');
  updateHud();
  setTimeout(() => {
    if (res.over) return endGame();
    if (res.patchEvent) return runPatch(res.patchEvent, res.shiftEvent);
    if (res.shiftEvent && res.shiftEvent.added) return runShift(res.shiftEvent);
    nextRequest();
  }, res.correct ? 820 : 1650);
}

function flash(msg, kind) { const fb = $('#main .feedback'); if (fb) { fb.textContent = msg; fb.className = 'feedback ' + (kind || ''); } }

function showStamp(ok, timeout) {
  const st = el('div', 'stamp ' + (ok ? 'ok' : 'bad'));
  st.innerHTML = `<b>${ok ? 'CLEARED' : timeout ? 'DROPPED' : 'DENIED'}</b>`;
  document.body.appendChild(st);
  setTimeout(() => st.remove(), 650);
}

// =============================================================== patch event
function runPatch(patch, pendingShift) {
  stopTimer();
  openSheet('&#9888; INCIDENT &middot; patch required', (sheet) => {
    sheet.appendChild(el('p', null, esc(patch.prompt)));
    sheet.appendChild(el('p', 'muted', `Endpoint: ${esc(patch.endpoint)}`));
    const order = patch.options.map((_, i) => i).sort(() => Math.random() - 0.5);
    order.forEach((idx) => {
      const opt = el('button', 'patch-opt', esc(patch.options[idx].code));
      opt.onclick = () => {
        const r = game.applyPatch(patch, idx);
        sheet.innerHTML = '<div class="grip"></div>';
        sheet.appendChild(el('h3', null, r.ok ? '&#9989; Patched' : '&#10060; Wrong patch'));
        sheet.appendChild(el('p', null, esc(r.explain)));
        sheet.appendChild(el('p', r.ok ? 'feedback good' : 'feedback bad',
          `${r.bonus > 0 ? '+' : ''}${r.bonus}` + (r.ok ? ` &middot; ${esc(patch.endpoint)} is hardened against ${patch.cls.toUpperCase()} this run.` : '')));
        const cont = el('button', 'cta', 'Back to the gate');
        cont.onclick = () => { closeSheet(); updateHud(); if (pendingShift && pendingShift.added) runShift(pendingShift); else nextRequest(); };
        sheet.appendChild(cont);
        updateHud();
      };
      sheet.appendChild(opt);
    });
  }, { sticky: true });
}

// =============================================================== shift change
function runShift(ev) {
  stopTimer();
  openSheet(null, (sheet) => {
    sheet.appendChild(el('div', 'shiftbig', `SHIFT ${ev.shift}`));
    sheet.appendChild(el('p', 'muted', `+${ev.bonus} for surviving the last shift.`));
    sheet.appendChild(el('h4', null, '&#128203; NEW DIRECTIVE'));
    sheet.appendChild(el('div', 'dirrow hot', esc(ev.added.text)));
    const cont = el('button', 'cta', 'Clock in');
    cont.onclick = () => { closeSheet(); nextRequest(); };
    sheet.appendChild(cont);
  }, { sticky: true });
  vibrate([10, 30, 10]);
}

// =============================================================== timer + ticker
function startTimer() {
  if (!game.diff.timer) return;
  timeBudget = game.timerBudget; timeLeft = timeBudget;
  const bar = $('#tbar');
  clearInterval(timerId);
  timerId = setInterval(() => {
    timeLeft -= 0.1;
    if (bar) {
      const pct = Math.max(0, (timeLeft / timeBudget) * 100);
      bar.style.width = pct + '%';
      bar.style.background = pct < 30 ? 'var(--red)' : pct < 60 ? 'var(--amber)' : 'var(--accent)';
    }
    if (timeLeft <= 0) {
      stopTimer();
      awaiting = false; setButtons(false);
      afterResolve(game.timeout());
    }
  }, 100);
}
function stopTimer() { clearInterval(timerId); timerId = null; }

function startTicker() {
  const codes = [200, 200, 200, 301, 404, 403, 500];
  const lines = [];
  for (let i = 0; i < 12; i++) {
    const t = new Date(Date.now() - i * 1234);
    const hh = [t.getHours(), t.getMinutes(), t.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
    lines.push(`[${hh}] ${randIp()} ${randMethod()} ${SITE.endpoints[Math.floor(Math.random() * SITE.endpoints.length)]} ${codes[Math.floor(Math.random() * codes.length)]}`);
  }
  const t = $('#tickText'); if (t) t.textContent = lines.join('   ·   ');
}
function randIp() { return `${192 + Math.floor(Math.random() * 12)}.0.2.${Math.floor(Math.random() * 254)}`; }
function randMethod() { return ['GET', 'GET', 'GET', 'POST', 'PUT'][Math.floor(Math.random() * 5)]; }

// =============================================================== swipe
function attachSwipe(card) {
  let x0 = 0, y0 = 0, drag = false, done = false;
  const passInd = $('.swipe-ind.pass', card), blockInd = $('.swipe-ind.block', card);
  const TH = 95;
  const down = (x, y) => { x0 = x; y0 = y; drag = true; done = false; };
  const move = (x, y) => {
    if (!drag) return;
    const dx = x - x0, dy = y - y0;
    if (Math.abs(dy) > Math.abs(dx) * 1.3 && Math.abs(dy) > 16) { drag = false; reset(); return; }
    card.style.transform = `translateX(${dx}px) rotate(${dx / 32}deg)`;
    passInd.style.opacity = dx < -20 ? Math.min(1, -dx / TH) : 0;
    blockInd.style.opacity = dx > 20 ? Math.min(1, dx / TH) : 0;
  };
  const up = (x) => {
    if (!drag) return; drag = false;
    const dx = x - x0;
    if (dx <= -TH && !done) { done = true; animateOut(card, -1); decide('pass'); return; }
    if (dx >= TH && !done) { done = true; reset(); openClassSheet(); return; }
    reset();
  };
  const reset = () => {
    card.style.transition = 'transform .18s'; card.style.transform = '';
    passInd.style.opacity = 0; blockInd.style.opacity = 0;
    setTimeout(() => { card.style.transition = ''; }, 180);
  };
  card.addEventListener('touchstart', (e) => down(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  card.addEventListener('touchmove', (e) => move(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  card.addEventListener('touchend', (e) => up((e.changedTouches[0] || {}).clientX ?? x0));
  let md = false;
  card.addEventListener('mousedown', (e) => { if (e.target.closest('.tok')) return; md = true; down(e.clientX, e.clientY); });
  window.addEventListener('mousemove', (e) => { if (md) move(e.clientX, e.clientY); });
  window.addEventListener('mouseup', (e) => { if (md) { md = false; up(e.clientX); } });
}
function animateOut(card, dir) {
  card.style.transition = 'transform .25s ease, opacity .25s';
  card.style.transform = `translateX(${dir * 520}px) rotate(${dir * 24}deg)`;
  card.style.opacity = '0';
}

// =============================================================== end
function endGame() {
  stopTimer(); closeSheet();
  const rep = game.report();
  const best = store.get('waf.best', {});
  const isBest = !best[game.diffKey] || rep.score > best[game.diffKey];
  if (isBest) { best[game.diffKey] = rep.score; store.set('waf.best', best); }

  app.innerHTML = '';
  const s = el('div', 'screen');
  s.appendChild(el('div', 'logo', `SHIFT OVER<small>${game.integrity <= 0 ? 'SITE BREACHED' : 'REPUTATION RUINED'}</small>`));
  s.appendChild(el('p', null, `<b class="big">${rep.score}</b> pts &middot; ${esc(rep.difficulty)} &middot; reached shift ${rep.shift}` + (isBest ? ' &middot; &#127942; best!' : '')));
  s.appendChild(el('p', 'muted', `${rep.correct}/${rep.total} correct &middot; ${rep.accuracy}% accuracy &middot; best combo &times;${Math.min(4, 1 + Math.floor(rep.bestCombo / 3))}`));

  const card = el('div', 'brief');
  card.appendChild(el('h4', null, 'Incident report &middot; accuracy by type'));
  rep.perClass.forEach((c) => {
    const row = el('div', 'reprow');
    const col = c.pct >= 70 ? 'var(--accent)' : c.pct >= 40 ? 'var(--amber)' : 'var(--red)';
    row.innerHTML = `<div class="rl"><span>${esc(c.label)}</span><span>${c.right}/${c.seen} &middot; ${c.pct}%</span></div>
      <div class="repbar"><i style="width:${c.pct}%;background:${col}"></i></div>`;
    card.appendChild(row);
  });
  s.appendChild(card);

  const again = el('button', 'cta', '&#9654; NEW SHIFT'); again.onclick = startGame;
  s.appendChild(again);
  const menu = el('button', 'diffbtn center', 'Menu / change difficulty'); menu.onclick = renderMenu;
  s.appendChild(menu);
  app.appendChild(s);
  game = null;
}

// =============================================================== keyboard
window.addEventListener('keydown', (e) => {
  if (!game || !awaiting) return;
  const k = e.key.toLowerCase();
  if (k === 'a' || k === 'arrowleft') { e.preventDefault(); decide('pass'); }
  else if (k === 'd' || k === 'arrowright') { e.preventDefault(); openClassSheet(); }
  else if (k === ' ') { e.preventDefault(); openDecoder(); }
  else if (/^[1-6]$/.test(k)) {
    const classes = CLASSES.filter((c) => game.diff.classes.includes(c.id));
    const c = classes[parseInt(k, 10) - 1];
    if (c) decide('block', c.id);
  }
});

applyScanlines();
renderMenu();
