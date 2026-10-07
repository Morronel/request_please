// Game engine for REQUEST, PLEASE. Pure logic, no DOM.
import {
  encoders, decodeChain, CLASSES, IPS, COUNTRIES, UAS, SITE,
  legitPool, attackPool, PATCHES,
} from './content.js';

export const DIFFICULTY = {
  easy: {
    label: 'Easy', timer: 0, encodeDepth: 0, attackShare: 0.4,
    classes: ['sqli', 'xss', 'traversal', 'policy'], decoys: false,
    ruleSlots: 3, fpPenalty: 1, requireClass: false, patchEvery: 8,
  },
  medium: {
    label: 'Medium', timer: 25, encodeDepth: 2, attackShare: 0.5,
    classes: ['sqli', 'xss', 'traversal', 'cmdi', 'policy'], decoys: true,
    ruleSlots: 2, fpPenalty: 1, requireClass: true, patchEvery: 10,
  },
  hard: {
    label: 'Hard', timer: 15, timerShrink: 0.985, encodeDepth: 3, attackShare: 0.55,
    classes: ['sqli', 'xss', 'traversal', 'cmdi', 'ssrf', 'policy'], decoys: true,
    ruleSlots: 1, fpPenalty: 2, requireClass: true, patchEvery: 12,
  },
};

const rand = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rand(a.length)];

const LAYER_ENCODERS = ['url', 'base64', 'htmlEntity', 'hex', 'unicode', 'doubleUrl'];

// Wrap a payload string in up to `depth` encoding layers.
function obfuscate(value, depth) {
  let out = value;
  const used = [];
  for (let i = 0; i < depth; i++) {
    const enc = pick(LAYER_ENCODERS.filter((e) => !used.includes(e)));
    if (!enc) break;
    used.push(enc);
    out = encoders[enc].encode(out);
  }
  return out;
}

let reqSeq = 0;

export function buildRequest(diff, patchedEndpoints) {
  const isAttack = Math.random() < diff.attackShare;
  let base, kind, why, payloadField = null;

  if (isAttack) {
    const pool = attackPool().filter((a) => diff.classes.includes(a.kind));
    const tpl = pick(pool);
    base = tpl.make();
    kind = tpl.kind;
    why = tpl.why;
    payloadField = tpl.payloadField;

    // If this endpoint+class was patched this shift, it's now harmless → legit.
    if (patchedEndpoints[`${tpl.kind}:${base.path}`]) {
      kind = 'legit';
      why = 'This looks like an attack, but you patched this endpoint — the payload is now neutralised, so it is legitimate traffic.';
    } else if (payloadField && diff.encodeDepth > 0) {
      // Obfuscate the payload in the field that carries it.
      const depth = 1 + rand(diff.encodeDepth);
      const container = base.query && base.query[payloadField] !== undefined ? base.query
        : base.body && base.body[payloadField] !== undefined ? base.body : null;
      if (container) container[payloadField] = obfuscate(container[payloadField], depth);
    }
  } else {
    const tpl = pick(legitPool());
    base = tpl();
    kind = 'legit';
    why = base.why;
    if (base.decoy && !diff.decoys) {
      // On easy, swap decoys for a plain legit request to keep it fair.
      return buildRequest(diff, patchedEndpoints);
    }
  }

  return {
    seq: ++reqSeq,
    method: base.method,
    path: base.path,
    query: base.query || {},
    body: base.body || {},
    headers: Object.assign(
      { 'User-Agent': pick(UAS) },
      base.headers || {}
    ),
    ip: pick(IPS),
    country: pick(COUNTRIES),
    kind,          // 'legit' or an attack class id
    why,
    isAttack: kind !== 'legit',
    decoy: !!base.decoy,
  };
}

// A rule: field (path|ip|contains), op, value. Returns 'block' if it matches.
export function ruleMatches(rule, req) {
  const hay = JSON.stringify({ path: req.path, query: req.query, body: req.body,
    headers: req.headers, ip: req.ip }).toLowerCase();
  const v = rule.value.toLowerCase();
  switch (rule.field) {
    case 'path': return req.path.toLowerCase() === v || req.path.toLowerCase().startsWith(v);
    case 'ip': return req.ip === rule.value;
    case 'contains': return hay.includes(v);
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
    this.correct = 0;
    this.total = 0;
    this.sinceRefill = 0;
    this.sincePatch = 0;
    this.rules = [];
    this.patched = {};               // 'cls:/path' -> true
    this.stats = {};                 // per-class {seen, right}
    this.timerBudget = this.diff.timer;
    this.over = false;
    CLASSES.forEach((c) => (this.stats[c.id] = { seen: 0, right: 0 }));
    this.stats.legit = { seen: 0, right: 0 };
    this.current = null;
  }

  get ruleSlotsLeft() { return this.diff.ruleSlots - this.rules.length; }

  next() {
    this.current = buildRequest(this.diff, this.patched);
    // Auto-apply rules.
    const autoBlocked = this.rules.find((r) => ruleMatches(r, this.current));
    this.current.autoBlocked = autoBlocked || null;
    return this.current;
  }

  // Decode a token string fully; UI uses this for the decoder sheet.
  decode(str) { return decodeChain(str); }

  comboMult() { return Math.min(4, 1 + Math.floor(this.combo / 3)); }

  // decision: 'pass' | 'block'; chosenClass only for block.
  // timeTakenRatio: 0..1 of the timer used (for speed bonus); 1 if no timer.
  resolve(decision, chosenClass, timeTakenRatio = 1) {
    const req = this.current;
    this.total++;
    const statKey = req.isAttack ? req.kind : 'legit';
    this.stats[statKey].seen++;

    let correct = false;
    let delta = 0;
    let message = '';
    let classRight = null;

    if (req.isAttack) {
      if (decision === 'block') {
        correct = true;
        classRight = chosenClass === req.kind;
        delta = 150 + (classRight ? 50 : 0);
        message = classRight
          ? `Correct block. ${req.why}`
          : (this.diff.requireClass
              ? `Blocked, but wrong class (it was ${classLabel(req.kind)}). Half credit. ${req.why}`
              : `Blocked. It was ${classLabel(req.kind)}. ${req.why}`);
        if (this.diff.requireClass && !classRight) delta = Math.floor(delta / 2);
      } else {
        correct = false;
        delta = 0;
        message = `Breach! You passed an attack. ${req.why}`;
        this.integrity--;
      }
    } else {
      if (decision === 'pass') {
        correct = true;
        delta = 100;
        message = `Correct pass. ${req.why}`;
      } else {
        correct = false;
        delta = 0;
        message = `False positive — that was legitimate. ${req.why}`;
        this.reputation -= this.diff.fpPenalty;
      }
    }

    if (correct) {
      this.combo++;
      this.correct++;
      this.stats[statKey].right++;
      const mult = this.comboMult();
      const speed = this.diff.timer ? Math.round(30 * (1 - timeTakenRatio)) : 0;
      delta = delta * mult + speed;
      this.sinceRefill++;
      if (this.sinceRefill >= 10) {
        this.sinceRefill = 0;
        if (this.integrity < this.maxMeter) this.integrity++;
        else if (this.reputation < this.maxMeter) this.reputation++;
        message += ' (+1 meter refilled)';
      }
    } else {
      this.combo = 0;
    }

    this.score += delta;
    if (this.integrity <= 0 || this.reputation <= 0) this.over = true;

    // Shrinking timer on hard.
    if (this.diff.timerShrink) this.timerBudget = Math.max(6, this.timerBudget * this.diff.timerShrink);

    // Should a patch event trigger?
    this.sincePatch++;
    let patchEvent = null;
    if (!this.over && this.sincePatch >= this.diff.patchEvery) {
      this.sincePatch = 0;
      const avail = PATCHES.filter(
        (p) => this.diff.classes.includes(p.cls) && !this.patched[`${p.cls}:${p.endpoint}`]
      );
      if (avail.length) patchEvent = pick(avail);
    }

    return {
      correct, delta, message, classRight,
      integrity: this.integrity, reputation: this.reputation,
      score: this.score, combo: this.combo, mult: this.comboMult(),
      over: this.over, patchEvent, wasAttack: req.isAttack, actualClass: req.kind,
    };
  }

  applyPatch(patch, choiceIndex) {
    const ok = patch.options[choiceIndex] && patch.options[choiceIndex].ok;
    if (ok) {
      this.patched[`${patch.cls}:${patch.endpoint}`] = true;
      this.score += 200;
    } else {
      this.score = Math.max(0, this.score - 50);
    }
    return { ok, explain: patch.explain, bonus: ok ? 200 : -50 };
  }

  addRule(rule) {
    if (this.ruleSlotsLeft <= 0) return false;
    this.rules.push(rule);
    return true;
  }

  report() {
    const perClass = Object.entries(this.stats)
      .filter(([, s]) => s.seen > 0)
      .map(([k, s]) => ({
        key: k,
        label: k === 'legit' ? 'Legit traffic' : classLabel(k),
        seen: s.seen, right: s.right,
        pct: Math.round((s.right / s.seen) * 100),
      }));
    return {
      score: this.score, total: this.total, correct: this.correct,
      accuracy: this.total ? Math.round((this.correct / this.total) * 100) : 0,
      perClass, difficulty: this.diff.label,
    };
  }
}

export function classLabel(id) {
  const c = CLASSES.find((x) => x.id === id);
  return c ? c.label : id;
}

export { CLASSES, SITE };
