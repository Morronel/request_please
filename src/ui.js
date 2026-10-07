// DOM/UI layer for REQUEST, PLEASE.
import { Game, DIFFICULTY, ruleMatches } from './engine.js';
import { CLASSES, SITE } from './engine.js';

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

function vibrate(ms) {
  if (settings.haptics && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} }
}
function applyScanlines() { document.body.classList.toggle('scanlines', settings.scanlines); }

let game = null;
let chosenDiff = 'easy';
let timerId = null;
let timeLeft = 0;
let timeBudget = 0;
let pendingClass = null;      // selected class before confirming a block
let awaitingDecision = false;

const app = $('#app');

// ----------------------------------------------------------- bottom sheet
function openSheet(title, buildBody) {
  let wrap = $('#sheet');
  if (!wrap) {
    wrap = el('div', 'sheet-wrap'); wrap.id = 'sheet';
    wrap.innerHTML = '<div class="scrim"></div><div class="sheet"><div class="grip"></div></div>';
    document.body.appendChild(wrap);
    $('.scrim', wrap).addEventListener('click', closeSheet);
  }
  const sheet = $('.sheet', wrap);
  sheet.innerHTML = '<div class="grip"></div>';
  if (title) sheet.appendChild(el('h3', null, esc(title)));
  buildBody(sheet);
  wrap.classList.add('open');
}
function closeSheet() { const w = $('#sheet'); if (w) w.classList.remove('open'); }

// ----------------------------------------------------------- menu screen
function renderMenu() {
  stopTimer();
  closeSheet();
  app.innerHTML = '';
  const s = el('div', 'screen');

  const best = store.get('waf.best', {});
  s.appendChild(el('div', 'logo', `REQUEST, PLEASE<small>WAF SIMULATOR · ENDLESS</small>`));

  const brief = el('div', 'brief');
  brief.innerHTML =
    `<h4>Your post: ${esc(SITE.name)} WAF</h4>
     <p class="muted">You are the firewall for ${esc(SITE.name)}, ${esc(SITE.tagline)}.
     Inspect each request, decode what it carries, then <b>PASS</b> real customers and
     <b>BLOCK</b> attacks. Tap glowing tokens to decode them. Classify every block.</p>
     <h4>Today's directives</h4>
     <ul>${SITE.directives.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>`;
  s.appendChild(brief);

  const sel = el('div', 'diffsel');
  Object.entries(DIFFICULTY).forEach(([key, d]) => {
    const b = el('button', 'diffbtn' + (key === chosenDiff ? ' sel' : ''));
    const bestScore = best[key] ? ` · best ${best[key]}` : '';
    b.innerHTML = `<b>${d.label}</b>${bestScore}
      <small>${d.timer ? d.timer + 's timer' : 'no timer'} · decode depth ${d.encodeDepth} ·
      ${d.classes.length} classes · ${d.ruleSlots} rule slot${d.ruleSlots > 1 ? 's' : ''}${d.decoys ? ' · decoys' : ''}</small>`;
    b.addEventListener('click', () => { chosenDiff = key; renderMenu(); });
    sel.appendChild(b);
  });
  s.appendChild(sel);

  const start = el('button', 'cta', '▶ START SHIFT');
  start.addEventListener('click', startGame);
  s.appendChild(start);

  const opts = el('div', null,
    `<div class="hint">
       <label style="cursor:pointer"><input type="checkbox" id="optScan" ${settings.scanlines ? 'checked' : ''}> CRT scanlines</label>
       &nbsp;&nbsp;
       <label style="cursor:pointer"><input type="checkbox" id="optHap" ${settings.haptics ? 'checked' : ''}> Haptics</label>
     </div>
     <p class="hint">Desktop: <kbd>A</kbd>/<kbd>←</kbd> pass · <kbd>D</kbd>/<kbd>→</kbd> block ·
     <kbd>Space</kbd> decode · <kbd>1</kbd>–<kbd>6</kbd> class</p>`);
  s.appendChild(opts);
  app.appendChild(s);

  $('#optScan').addEventListener('change', (e) => { settings.scanlines = e.target.checked; store.set('waf.scanlines', settings.scanlines); applyScanlines(); });
  $('#optHap').addEventListener('change', (e) => { settings.haptics = e.target.checked; store.set('waf.haptics', settings.haptics); });
}

// ----------------------------------------------------------- game screen
function startGame() {
  game = new Game(chosenDiff);
  renderGameShell();
  nextRequest();
}

function renderGameShell() {
  app.innerHTML = '';
  app.appendChild(el('div', 'ticker', `<span id="tickText"></span>`));
  const hud = el('div', 'hud');
  hud.innerHTML =
    `<div class="meters">
       <span class="meter" id="mInt" title="Integrity">♥♥♥</span>
       <span class="meter" id="mRep" title="Reputation">★★★</span>
     </div>
     <div class="score"><b id="sScore">0</b><div class="combo" id="sCombo">&nbsp;</div></div>`;
  app.appendChild(hud);
  const tb = el('div', 'timerbar'); tb.innerHTML = '<i id="tbar" style="width:100%"></i>';
  app.appendChild(tb);
  if (!game.diff.timer) tb.style.display = 'none';

  const main = el('main'); main.id = 'main';
  app.appendChild(main);

  const dec = el('div', 'decision');
  dec.innerHTML =
    `<button class="btn ghost" id="bDecode" title="Decode">🔍</button>
     <button class="btn pass" id="bPass">PASS</button>
     <button class="btn block" id="bBlock">BLOCK</button>
     <button class="btn ghost" id="bRule" title="Rules">⚙</button>`;
  app.appendChild(dec);

  $('#bPass').addEventListener('click', () => decide('pass'));
  $('#bBlock').addEventListener('click', () => openClassSheet());
  $('#bDecode').addEventListener('click', openDecodeAll);
  $('#bRule').addEventListener('click', openRuleSheet);

  updateHud();
  startTicker();
}

function updateHud() {
  const heart = (n) => '♥'.repeat(Math.max(0, n)) + '<span style="opacity:.25">♥</span>'.repeat(Math.max(0, game.maxMeter - n));
  const star = (n) => '★'.repeat(Math.max(0, n)) + '<span style="opacity:.25">★</span>'.repeat(Math.max(0, game.maxMeter - n));
  $('#mInt').innerHTML = heart(game.integrity);
  $('#mRep').innerHTML = star(game.reputation);
  $('#sScore').textContent = game.score;
  const c = $('#sCombo');
  c.innerHTML = game.combo >= 3 ? `combo x${game.comboMult()}` : '&nbsp;';
}

// ----------------------------------------------------------- render a request
function nextRequest() {
  if (game.over) return endGame();
  const req = game.next();
  pendingClass = null;
  awaitingDecision = true;
  const main = $('#main');
  main.innerHTML = '';

  const card = el('div', 'card'); card.id = 'card';
  card.innerHTML = `<div class="swipe-ind pass">◀ PASS</div><div class="swipe-ind block">BLOCK ▶</div>`;

  const head = el('div', 'req-head');
  head.innerHTML =
    `<span class="method">${esc(req.method)}</span>
     <span class="path">${esc(req.path)}</span>
     <span class="meta">#${req.seq}<br>${esc(req.ip)} · ${esc(req.country)}</span>`;
  card.appendChild(head);

  const addKV = (title, obj, tappable) => {
    const keys = Object.keys(obj || {});
    if (!keys.length) return;
    const box = el('div', 'kv'); box.appendChild(el('h4', null, title));
    keys.forEach((k) => {
      const row = el('div', 'row');
      row.appendChild(el('span', 'k', esc(k) + ':'));
      const vWrap = el('span', 'v');
      const val = String(obj[k]);
      if (tappable && looksEncodedOrInteresting(val)) {
        const tok = el('span', 'tok', esc(val));
        tok.addEventListener('click', () => openDecode(k, val));
        vWrap.appendChild(tok);
      } else {
        vWrap.textContent = val;
      }
      row.appendChild(vWrap);
      box.appendChild(row);
    });
    card.appendChild(box);
  };
  addKV('Query', req.query, true);
  addKV('Body', req.body, true);
  addKV('Headers', req.headers, true);

  if (req.autoBlocked) {
    card.appendChild(el('div', 'flag-auto',
      `⚙ Matched your rule "<b>${esc(describeRule(req.autoBlocked))}</b>". It will be blocked unless you override.`));
  }

  main.appendChild(card);
  main.appendChild(el('div', 'feedback', '&nbsp;'));

  setButtons(true);
  attachSwipe(card);
  startTimer();
}

// Heuristic: is this value worth a decode tap?
function looksEncodedOrInteresting(v) {
  return /%[0-9a-fA-F]{2}|&#|\\x|\\u|[A-Za-z0-9+/]{12,}={0,2}$|['"<>;(){}]|\.\.|UNION|SELECT|script|169\.254|localhost|etc\/|\$\(/i.test(v);
}

function describeRule(r) { return `${r.field} ${r.op || 'matches'} ${r.value}`; }

// ----------------------------------------------------------- decode sheets
function openDecode(field, value) {
  const chain = game.decode(value);
  openSheet(`Decode: ${field}`, (sheet) => {
    sheet.appendChild(el('p', 'muted', chain.length > 1
      ? `${chain.length - 1} layer(s) of encoding peeled.`
      : 'No encoding detected — this is the raw value.'));
    chain.forEach((layer, i) => {
      const box = el('div', 'layer' + (i === chain.length - 1 && chain.length > 1 ? ' final' : ''));
      box.innerHTML = `<div class="lname">${esc(layer.name)}</div><div class="lval">${esc(layer.value)}</div>`;
      sheet.appendChild(box);
    });
    const close = el('button', 'cta', 'Got it'); close.addEventListener('click', closeSheet);
    sheet.appendChild(close);
  });
  vibrate(8);
}

function openDecodeAll() {
  const req = game.current;
  if (!req) return;
  const fields = [];
  ['query', 'body', 'headers'].forEach((grp) =>
    Object.entries(req[grp]).forEach(([k, v]) => fields.push([k, String(v)])));
  openSheet('Decoder', (sheet) => {
    fields.forEach(([k, v]) => {
      const chain = game.decode(v);
      const box = el('div', 'layer' + (chain.length > 1 ? ' final' : ''));
      const last = chain[chain.length - 1];
      box.innerHTML = `<div class="lname">${esc(k)}${chain.length > 1 ? ' · ' + (chain.length - 1) + ' layer(s)' : ''}</div>
        <div class="lval">${esc(last.value)}</div>`;
      box.addEventListener('click', () => openDecode(k, v));
      sheet.appendChild(box);
    });
    const close = el('button', 'cta', 'Close'); close.addEventListener('click', closeSheet);
    sheet.appendChild(close);
  });
}

// ----------------------------------------------------------- block + classify
function openClassSheet() {
  if (!awaitingDecision) return;
  const classes = CLASSES.filter((c) => game.diff.classes.includes(c.id));
  if (!game.diff.requireClass) {
    // Easy: optional classify, but still ask (with a skip).
  }
  openSheet('Classify the threat', (sheet) => {
    const grid = el('div', 'chips');
    classes.forEach((c, i) => {
      const chip = el('button', 'chip');
      chip.innerHTML = `<span class="e">${c.emoji}</span> ${esc(c.label)} <span class="muted">${i + 1}</span>`;
      chip.addEventListener('click', () => { pendingClass = c.id; decide('block', c.id); });
      grid.appendChild(chip);
    });
    sheet.appendChild(grid);
    if (!game.diff.requireClass) {
      const skip = el('button', 'cta', 'Block without classifying');
      skip.style.background = 'var(--block)'; skip.style.color = '#fff';
      skip.addEventListener('click', () => decide('block', null));
      sheet.appendChild(skip);
    }
  });
  vibrate(8);
}

// ----------------------------------------------------------- rules
function openRuleSheet() {
  openSheet(`Rules (${game.ruleSlotsLeft} slot${game.ruleSlotsLeft === 1 ? '' : 's'} left)`, (sheet) => {
    if (game.rules.length) {
      sheet.appendChild(el('h4', null, 'Active rules'));
      game.rules.forEach((r) => sheet.appendChild(el('div', 'layer', `<div class="lval">⚙ block when ${esc(describeRule(r))}</div>`)));
    }
    if (game.ruleSlotsLeft <= 0) {
      sheet.appendChild(el('p', 'muted', 'No rule slots left this shift. Rules that are too broad will block real customers.'));
      const c = el('button', 'cta', 'Close'); c.addEventListener('click', closeSheet); sheet.appendChild(c);
      return;
    }
    sheet.appendChild(el('p', 'muted', 'Auto-block future requests that match. Be specific — a loose rule eats legit traffic.'));
    const f1 = el('div', 'field'); f1.innerHTML =
      `<label>Field</label><select id="rField">
        <option value="contains">body/query/header contains</option>
        <option value="path">path is</option>
        <option value="ip">source IP is</option>
      </select>`;
    const f2 = el('div', 'field'); f2.innerHTML =
      `<label>Value</label><input id="rVal" placeholder="e.g. UNION SELECT  ·  /admin  ·  203.0.113.7" autocapitalize="off" autocomplete="off" spellcheck="false">`;
    sheet.appendChild(f1); sheet.appendChild(f2);
    const add = el('button', 'cta', 'Add rule');
    add.addEventListener('click', () => {
      const field = $('#rField').value;
      const value = $('#rVal').value.trim();
      if (!value) return;
      game.addRule({ field, op: field === 'contains' ? 'contains' : 'is', value });
      closeSheet();
      flash(`Rule added: block when ${field} ${value}`, 'good');
    });
    sheet.appendChild(add);
  });
}

// ----------------------------------------------------------- decide + feedback
function setButtons(on) {
  ['#bPass', '#bBlock', '#bDecode', '#bRule'].forEach((s) => { const b = $(s); if (b) b.disabled = !on; });
}

function decide(decision, chosenClass) {
  if (!awaitingDecision) return;
  awaitingDecision = false;
  closeSheet();
  stopTimer();
  setButtons(false);

  const ratio = game.diff.timer ? 1 - (timeLeft / timeBudget) : 1;
  const res = game.resolve(decision, chosenClass, ratio);

  showStamp(res.correct);
  vibrate(res.correct ? 14 : [30, 40, 30]);

  const fb = $('#main .feedback');
  if (fb) { fb.textContent = res.message; fb.className = 'feedback ' + (res.correct ? 'good' : 'bad'); }
  updateHud();

  setTimeout(() => {
    if (res.over) return endGame();
    if (res.patchEvent) return runPatchEvent(res.patchEvent);
    nextRequest();
  }, res.correct ? 850 : 1700);
}

function flash(msg, kind) {
  const fb = $('#main .feedback');
  if (fb) { fb.textContent = msg; fb.className = 'feedback ' + (kind || ''); }
}

function showStamp(ok) {
  const st = el('div', 'stamp ' + (ok ? 'ok' : 'bad'));
  st.innerHTML = `<b>${ok ? 'VALID' : 'DENIED'}</b>`;
  document.body.appendChild(st);
  setTimeout(() => st.remove(), 650);
}

// ----------------------------------------------------------- patch event
function runPatchEvent(patch) {
  stopTimer();
  openSheet('⚠ INCIDENT — patch required', (sheet) => {
    sheet.appendChild(el('p', null, esc(patch.prompt)));
    sheet.appendChild(el('p', 'muted', `Endpoint: ${esc(patch.endpoint)}`));
    const order = patch.options.map((o, i) => i).sort(() => Math.random() - 0.5);
    order.forEach((idx) => {
      const opt = el('button', 'patch-opt', esc(patch.options[idx].code));
      opt.addEventListener('click', () => {
        const r = game.applyPatch(patch, idx);
        sheet.innerHTML = '<div class="grip"></div>';
        sheet.appendChild(el('h3', null, r.ok ? '✅ Patched' : '❌ Wrong patch'));
        sheet.appendChild(el('p', null, esc(r.explain)));
        sheet.appendChild(el('p', r.ok ? 'feedback good' : 'feedback bad', `${r.bonus > 0 ? '+' : ''}${r.bonus} points` +
          (r.ok ? ` · ${patch.endpoint} is now hardened against ${patch.cls.toUpperCase()}.` : '')));
        const cont = el('button', 'cta', 'Back to the gate');
        cont.addEventListener('click', () => { closeSheet(); updateHud(); nextRequest(); });
        sheet.appendChild(cont);
        updateHud();
      });
      sheet.appendChild(opt);
    });
  });
}

// ----------------------------------------------------------- timer + ticker
function startTimer() {
  if (!game.diff.timer) return;
  timeBudget = game.timerBudget;
  timeLeft = timeBudget;
  const bar = $('#tbar');
  clearInterval(timerId);
  timerId = setInterval(() => {
    timeLeft -= 0.1;
    if (bar) bar.style.width = Math.max(0, (timeLeft / timeBudget) * 100) + '%';
    if (timeLeft <= 0) {
      stopTimer();
      // timeout: counts as a missed decision → reputation hit, like a dropped customer
      awaitingDecision = false;
      setButtons(false);
      const req = game.current;
      game.total++;
      game.combo = 0;
      game.reputation -= 1;
      flash('⏱ Timed out — the request was dropped and a customer left. −1 ★', 'bad');
      vibrate([40, 40, 40]);
      updateHud();
      if (game.reputation <= 0) { game.over = true; setTimeout(endGame, 900); }
      else setTimeout(nextRequest, 1300);
    }
  }, 100);
}
function stopTimer() { clearInterval(timerId); timerId = null; }

function startTicker() {
  const codes = [200, 200, 200, 301, 404, 403, 500];
  const paths = SITE.endpoints;
  const lines = [];
  for (let i = 0; i < 10; i++) {
    const t = new Date(Date.now() - i * 1234);
    const hh = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0') + ':' + String(t.getSeconds()).padStart(2, '0');
    lines.push(`[${hh}] ${randIp()} ${randMethod()} ${paths[Math.floor(Math.random() * paths.length)]} ${codes[Math.floor(Math.random() * codes.length)]}`);
  }
  const t = $('#tickText'); if (t) t.textContent = lines.join('   ·   ');
}
function randIp() { return `${192 + Math.floor(Math.random() * 12)}.0.2.${Math.floor(Math.random() * 254)}`; }
function randMethod() { return ['GET', 'GET', 'GET', 'POST', 'PUT'][Math.floor(Math.random() * 5)]; }

// ----------------------------------------------------------- swipe
function attachSwipe(card) {
  let startX = 0, startY = 0, dragging = false, decided = false;
  const passInd = $('.swipe-ind.pass', card);
  const blockInd = $('.swipe-ind.block', card);
  const TH = 90;
  const onDown = (x, y) => { startX = x; startY = y; dragging = true; decided = false; };
  const onMove = (x, y) => {
    if (!dragging) return;
    const dx = x - startX, dy = y - startY;
    if (Math.abs(dy) > Math.abs(dx) * 1.3 && Math.abs(dy) > 14) { dragging = false; reset(); return; }
    card.style.transform = `translateX(${dx}px) rotate(${dx / 30}deg)`;
    passInd.style.opacity = dx < -20 ? Math.min(1, -dx / TH) : 0;
    blockInd.style.opacity = dx > 20 ? Math.min(1, dx / TH) : 0;
  };
  const onUp = (x) => {
    if (!dragging) return;
    dragging = false;
    const dx = x - startX;
    if (dx <= -TH && !decided) { decided = true; animateOut(card, -1); decide('pass'); return; }
    if (dx >= TH && !decided) { decided = true; animateOut(card, 1); openClassSheet(); reset(); return; }
    reset();
  };
  const reset = () => {
    card.style.transition = 'transform .18s'; card.style.transform = '';
    passInd.style.opacity = 0; blockInd.style.opacity = 0;
    setTimeout(() => { card.style.transition = ''; }, 180);
  };
  card.addEventListener('touchstart', (e) => onDown(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  card.addEventListener('touchmove', (e) => onMove(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  card.addEventListener('touchend', (e) => onUp((e.changedTouches[0] || {}).clientX || startX));
  // mouse (desktop drag)
  let mdown = false;
  card.addEventListener('mousedown', (e) => { if (e.target.closest('.tok')) return; mdown = true; onDown(e.clientX, e.clientY); });
  window.addEventListener('mousemove', (e) => { if (mdown) onMove(e.clientX, e.clientY); });
  window.addEventListener('mouseup', (e) => { if (mdown) { mdown = false; onUp(e.clientX); } });
}
function animateOut(card, dir) {
  card.style.transition = 'transform .25s ease, opacity .25s';
  card.style.transform = `translateX(${dir * 500}px) rotate(${dir * 25}deg)`;
  card.style.opacity = '0';
}

// ----------------------------------------------------------- end / report
function endGame() {
  stopTimer();
  closeSheet();
  const rep = game.report();
  const best = store.get('waf.best', {});
  const isBest = !best[game.diffKey] || rep.score > best[game.diffKey];
  if (isBest) { best[game.diffKey] = rep.score; store.set('waf.best', best); }

  app.innerHTML = '';
  const s = el('div', 'screen');
  s.appendChild(el('div', 'logo', `SHIFT OVER<small>${game.integrity <= 0 ? 'SITE BREACHED' : 'REPUTATION RUINED'}</small>`));
  s.appendChild(el('p', null, `<b style="color:var(--accent);font-size:26px">${rep.score}</b> points · ${rep.difficulty}` +
    (isBest ? ' · 🏆 new best!' : '')));
  s.appendChild(el('p', 'muted', `${rep.correct}/${rep.total} correct · ${rep.accuracy}% accuracy`));

  const card = el('div', 'brief');
  card.appendChild(el('h4', null, 'Incident report — accuracy by type'));
  rep.perClass.forEach((c) => {
    const row = el('div', 'reprow');
    row.innerHTML = `<div class="rl"><span>${esc(c.label)}</span><span>${c.right}/${c.seen} · ${c.pct}%</span></div>
      <div class="repbar"><i style="width:${c.pct}%;background:${c.pct >= 70 ? 'var(--accent)' : c.pct >= 40 ? 'var(--amber)' : 'var(--red)'}"></i></div>`;
    card.appendChild(row);
  });
  s.appendChild(card);

  const again = el('button', 'cta', '▶ NEW SHIFT');
  again.addEventListener('click', startGame);
  s.appendChild(again);
  const menu = el('button', 'diffbtn', 'Change difficulty / menu');
  menu.style.marginTop = '10px'; menu.style.textAlign = 'center';
  menu.addEventListener('click', renderMenu);
  s.appendChild(menu);
  app.appendChild(s);
  game = null;
}

// ----------------------------------------------------------- keyboard
window.addEventListener('keydown', (e) => {
  if (!game || !awaitingDecision) return;
  const k = e.key.toLowerCase();
  if (k === 'a' || k === 'arrowleft') { e.preventDefault(); decide('pass'); }
  else if (k === 'd' || k === 'arrowright') { e.preventDefault(); openClassSheet(); }
  else if (k === ' ') { e.preventDefault(); openDecodeAll(); }
  else if (/^[1-6]$/.test(k)) {
    const classes = CLASSES.filter((c) => game.diff.classes.includes(c.id));
    const c = classes[parseInt(k, 10) - 1];
    if (c) decide('block', c.id);
  }
});

// ----------------------------------------------------------- boot
applyScanlines();
renderMenu();
