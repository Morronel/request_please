// Game engine for REQUEST, PLEASE. Pure logic, no DOM.
import {
  encoders, decodeChain, CLASSES, IPS, COUNTRIES, UAS, SITE,
  legitPool, attackPool, PATCHES, DIRECTIVES, DECODERS,
} from './content.js';

export const DIFFICULTY = {
  easy: {
    label: 'Easy', blurb: 'No timer. Light encoding. Auto-decode allowed.',
    timer: 0, encodeChance: 0.35, encodeDepth: 1, attackShare: 0.45,
    classes: ['sqli', 'xss', 'traversal', 'policy'], decoys: false,
    ruleSlots: 3, fpPenalty: 1, requireClass: false, patchEvery: 8,
    shiftLen: 15, maxDirectives: 2, autoDecode: true,
  },
  medium: {
    label: 'Medium', blurb: '25s per request. Stacked encodings. Decoys.',
    timer: 25, encodeChance: 0.7, encodeDepth: 2, attackShare: 0.5,
    classes: ['sqli', 'xss', 'traversal', 'cmdi', 'policy'], decoys: true,
    ruleSlots: 2, fpPenalty: 1, requireClass: true, patchEvery: 10,
    shiftLen: 12, maxDirectives: 4, autoDecode: false,
  },
  hard: {
    label: 'Hard', blurb: 'Shrinking timer. Deep obfuscation. Every class.',
    timer: 15, timerShrink: 0.985, encodeChance: 0.9, encodeDepth: 3, attackShare: 0.55,
    classes: ['sqli', 'xss', 'traversal', 'cmdi', 'ssrf', 'policy'], decoys: true,
    ruleSlots: 1, fpPenalty: 2, requireClass: true, patchEvery: 12,
    shiftLen: 10, maxDirectives: 5, autoDecode: false,
  },
};

const rand = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rand(a.length)];

const LAYER_ENCODERS = ['url', 'base64', 'htmlEntity', 'hex', 'unicode'];

// Wrap a payload in `depth` distinct encoding layers.
function obfuscate(value, depth) {
  let out = value;
  const used = [];
  for (let i = 0; i < depth; i++) {
    const options = LAYER_ENCODERS.filter((e) => !used.includes(e));
    // Base64 only as the outermost layer reads naturally; keep it last.
    const enc = i < depth - 1 ? pick(options.filter((e) => e !== 'base64')) : pick(options);
    used.push(enc);
    out = encoders[enc].encode(out);
  }
  return out;
}

let reqSeq = 0;

function baseRequest(diff, wantAttack) {
  if (wantAttack) {
    const tpl = pick(attackPool().filter((a) => diff.classes.includes(a.kind)));
    return { base: tpl.make(), kind: tpl.kind, why: tpl.why, payloadField: tpl.payloadField };
  }
  let base;
  do { base = pick(legitPool())(); } while (base.decoy && !diff.decoys);
  return { base, kind: 'legit', why: base.why, payloadField: null };
}

// Build a request. `directive` (optional) is forced to apply to it.
export function buildRequest(diff, patched, directives, directive) {
  let wantAttack = Math.random() < diff.attackShare;
  if (directive) wantAttack = directive.verdict === 'pass'; // pentest wraps an attack

  const { base, kind: baseKind, why: baseWhy, payloadField } = baseRequest(diff, wantAttack);
  let kind = baseKind;
  let why = baseWhy;

  const req = {
    seq: ++reqSeq,
    method: base.method,
    path: base.path,
    query: { ...(base.query || {}) },
    body: { ...(base.body || {}) },
    headers: { 'User-Agent': pick(UAS.filter((u) => !u.startsWith('curl/'))), ...(base.headers || {}) },
    ip: pick(IPS.filter((ip) => !ip.startsWith('198.51.100.'))),
    country: pick(COUNTRIES),
    decoy: !!base.decoy,
    encodedLayers: 0,
  };
  if (directive) directive.inject(req);

  if (kind !== 'legit') {
    if (patched[`${kind}:${req.path}`]) {
      kind = 'legit';
      why = 'Looks hostile, but you patched this endpoint. The payload is harmless now, so it is legit traffic.';
    } else if (payloadField && Math.random() < diff.encodeChance) {
      const box = req.query[payloadField] !== undefined ? req.query
        : req.body[payloadField] !== undefined ? req.body : null;
      if (box) {
        const depth = 1 + rand(diff.encodeDepth);
        box[payloadField] = obfuscate(box[payloadField], depth);
        req.encodedLayers = depth;
      }
    }
  }

  // Directives override the base verdict. A 'pass' directive wins outright.
  const accept = kind === 'legit' ? [] : [kind];
  const passDir = directives.find((d) => d.verdict === 'pass' && d.applies(req));
  const blockDir = directives.find((d) => d.verdict === 'block' && d.applies(req));
  if (passDir) {
    kind = 'legit';
    why = `Directive: ${passDir.text}`;
    accept.length = 0;
  } else if (blockDir) {
    if (kind === 'legit') { kind = 'policy'; why = `Directive: ${blockDir.text}`; }
    if (!accept.includes('policy')) accept.push('policy');
    if (!accept.includes(kind)) accept.push(kind);
  }
  req.directive = passDir || blockDir || null;

  req.kind = kind;
  req.why = why;
  req.isAttack = kind !== 'legit';
  req.accept = accept;
  return req;
}

// A rule matches a request: field is path | ip | contains.
export function ruleMatches(rule, req) {
  const v = rule.value.toLowerCase();
  switch (rule.field) {
    case 'path': return req.path.toLowerCase().startsWith(v);
    case 'ip': return req.ip.startsWith(rule.value);
    case 'contains': {
      // Rules see the request after one round of URL decoding, like a real WAF.
      const hay = JSON.stringify({ path: req.path, query: req.query, body: req.body, headers: req.headers });
      let dec = hay;
      try { dec = decodeURIComponent(hay); } catch (e) { /* keep raw */ }
      return hay.toLowerCase().includes(v) || dec.toLowerCase().includes(v);
    }
    default: return false;
  }
}

export class Game {
  constructor(difficultyKey) {
    this.diffKey = difficultyKey;
    this.diff = DIFFICULTY[difficultyKey];
    this.integrity = 3;
    this.reputation = 3;
    this.maxMeter = 3;
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.correct = 0;
    this.total = 0;
    this.sinceRefill = 0;
    this.sincePatch = 0;
    this.shift = 1;
    this.inShift = 0;
    this.directives = [];
    this.rules = [];
    this.patched = {};
    this.stats = {};
    this.timerBudget = this.diff.timer;
    this.over = false;
    CLASSES.forEach((c) => (this.stats[c.id] = { seen: 0, right: 0 }));
    this.stats.legit = { seen: 0, right: 0 };
    this.current = null;
  }

  get ruleSlotsLeft() { return this.diff.ruleSlots - this.rules.length; }
  comboMult() { return Math.min(4, 1 + Math.floor(this.combo / 3)); }

  next() {
    // About a third of requests exercise an active directive, so rules matter.
    const forced = this.directives.length && Math.random() < 0.33 ? pick(this.directives) : null;
    this.current = buildRequest(this.diff, this.patched, this.directives, forced);
    this.current.rule = this.rules.find((r) => ruleMatches(r, this.current)) || null;
    return this.current;
  }

  decodeAll(str) { return decodeChain(str); }

  // decision: 'pass' | 'block'. chosenClass for manual blocks.
  // opts.auto: resolved by a player rule. opts.timeRatio: 0..1 of timer used.
  resolve(decision, chosenClass, opts = {}) {
    const req = this.current;
    const auto = !!opts.auto;
    this.total++;
    this.inShift++;
    const statKey = req.isAttack ? req.kind : 'legit';
    this.stats[statKey].seen++;

    let correct = false;
    let base = 0;
    let classRight = null;
    let message;

    if (req.isAttack && decision === 'block') {
      correct = true;
      if (auto) {
        base = 100;
        message = `Your rule caught it. ${req.why}`;
      } else {
        classRight = req.accept.includes(chosenClass);
        base = 150 + (classRight ? 50 : 0);
        if (classRight || chosenClass == null) message = `Clean block. ${req.why}`;
        else message = `Blocked, but it was ${classLabel(req.kind)}${this.diff.requireClass ? '. Half credit' : ''}. ${req.why}`;
        if (this.diff.requireClass && !classRight) base = Math.floor(base / 2);
      }
    } else if (req.isAttack) {
      message = `BREACH. You let an attack through. ${req.why}`;
      this.integrity--;
    } else if (decision === 'pass') {
      correct = true;
      base = 100;
      message = `Good pass. ${req.why}`;
    } else {
      message = auto
        ? `Your rule blocked a real customer. ${req.why}`
        : `False positive. That was a real customer. ${req.why}`;
      this.reputation -= this.diff.fpPenalty;
    }

    let delta = 0;
    if (correct) {
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.correct++;
      this.stats[statKey].right++;
      const speed = this.diff.timer && !auto ? Math.round(40 * (1 - (opts.timeRatio ?? 1))) : 0;
      delta = base * this.comboMult() + speed;
      if (++this.sinceRefill >= 10) {
        this.sinceRefill = 0;
        if (this.integrity < this.maxMeter) { this.integrity++; message += ' +1 ♥ restored.'; }
        else if (this.reputation < this.maxMeter) { this.reputation++; message += ' +1 ★ restored.'; }
      }
    } else {
      this.combo = 0;
    }
    this.score += delta;
    return this.afterDecision({ correct, delta, message, classRight, auto });
  }

  // The player ran out of time: the request is dropped.
  timeout() {
    const req = this.current;
    this.total++;
    this.inShift++;
    this.stats[req.isAttack ? req.kind : 'legit'].seen++;
    this.combo = 0;
    this.reputation--;
    return this.afterDecision({
      correct: false, delta: 0, timeout: true,
      message: `Timed out. The request was dropped and a customer gave up. ${req.why}`,
    });
  }

  afterDecision(res) {
    if (this.integrity <= 0 || this.reputation <= 0) this.over = true;
    if (this.diff.timerShrink) this.timerBudget = Math.max(7, this.timerBudget * this.diff.timerShrink);

    let patchEvent = null;
    let shiftEvent = null;
    if (!this.over) {
      if (++this.sincePatch >= this.diff.patchEvery) {
        const avail = PATCHES.filter((p) => this.diff.classes.includes(p.cls) && !this.patched[`${p.cls}:${p.endpoint}`]);
        if (avail.length) { patchEvent = pick(avail); this.sincePatch = 0; }
      }
      if (!patchEvent && this.inShift >= this.diff.shiftLen) shiftEvent = this.startShift();
    }
    return {
      ...res, integrity: this.integrity, reputation: this.reputation,
      score: this.score, combo: this.combo, mult: this.comboMult(),
      over: this.over, patchEvent, shiftEvent,
      wasAttack: this.current.isAttack, actualClass: this.current.kind,
    };
  }

  startShift() {
    this.shift++;
    this.inShift = 0;
    let added = null;
    if (this.directives.length < this.diff.maxDirectives) {
      const unused = DIRECTIVES.filter((d) => !this.directives.includes(d));
      if (unused.length) { added = pick(unused); this.directives.push(added); }
    }
    this.score += 250; // survived a shift
    return { shift: this.shift, added, bonus: 250 };
  }

  applyPatch(patch, choiceIndex) {
    const ok = !!(patch.options[choiceIndex] && patch.options[choiceIndex].ok);
    if (ok) { this.patched[`${patch.cls}:${patch.endpoint}`] = true; this.score += 200; }
    else this.score = Math.max(0, this.score - 50);
    return { ok, explain: patch.explain, bonus: ok ? 200 : -50 };
  }

  addRule(rule) {
    if (this.ruleSlotsLeft <= 0) return false;
    this.rules.push(rule);
    return true;
  }

  removeRule(i) { this.rules.splice(i, 1); }

  report() {
    const perClass = Object.entries(this.stats)
      .filter(([, s]) => s.seen > 0)
      .map(([k, s]) => ({
        key: k, label: k === 'legit' ? 'Legit traffic' : classLabel(k),
        seen: s.seen, right: s.right, pct: Math.round((s.right / s.seen) * 100),
      }));
    return {
      score: this.score, total: this.total, correct: this.correct,
      accuracy: this.total ? Math.round((this.correct / this.total) * 100) : 0,
      perClass, difficulty: this.diff.label, shift: this.shift, bestCombo: this.bestCombo,
    };
  }
}

export function classLabel(id) {
  const c = CLASSES.find((x) => x.id === id);
  return c ? c.label : id;
}

export { CLASSES, SITE, DECODERS };
