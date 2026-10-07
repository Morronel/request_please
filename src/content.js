// Content for REQUEST, PLEASE — attack/legit request templates and encoders.
// Everything here is data: adding a new attack or legit request means adding
// a template, not touching the engine.

// ---- encoders (used to wrap payloads in layers) --------------------------

export const encoders = {
  url: {
    name: 'URL-encode',
    encode: (s) => encodeURIComponent(s),
  },
  doubleUrl: {
    name: 'Double URL-encode',
    encode: (s) => encodeURIComponent(encodeURIComponent(s)),
  },
  base64: {
    name: 'Base64',
    encode: (s) => btoa(unescape(encodeURIComponent(s))),
  },
  htmlEntity: {
    name: 'HTML entities',
    encode: (s) =>
      s.replace(/./g, (c) =>
        /[a-zA-Z0-9 ]/.test(c) ? c : '&#' + c.charCodeAt(0) + ';'
      ),
  },
  hex: {
    name: 'Hex escapes',
    encode: (s) =>
      s.replace(/./g, (c) =>
        /[a-zA-Z0-9 ]/.test(c) ? c : '\\x' + c.charCodeAt(0).toString(16).padStart(2, '0')
      ),
  },
  unicode: {
    name: 'Unicode escapes',
    encode: (s) =>
      s.replace(/./g, (c) =>
        /[a-zA-Z0-9 ]/.test(c) ? c : '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')
      ),
  },
};

// Try to decode one layer of an opaque string. Returns {name, value} or null.
export function decodeOneLayer(s) {
  // Double / single URL-encoding
  if (/%25[0-9a-fA-F]{2}/.test(s)) {
    try {
      const d = decodeURIComponent(s);
      if (d !== s) return { name: 'URL-decode', value: d };
    } catch (e) { /* fall through */ }
  }
  if (/%[0-9a-fA-F]{2}/.test(s)) {
    try {
      const d = decodeURIComponent(s.replace(/\+/g, ' '));
      if (d !== s) return { name: 'URL-decode', value: d };
    } catch (e) { /* fall through */ }
  }
  // HTML entities
  if (/&#x?[0-9a-fA-F]+;/.test(s)) {
    const d = s.replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
               .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
    if (d !== s) return { name: 'HTML-entity decode', value: d };
  }
  // Hex escapes
  if (/\\x[0-9a-fA-F]{2}/.test(s)) {
    const d = s.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    if (d !== s) return { name: 'Hex-unescape', value: d };
  }
  // Unicode escapes
  if (/\\u[0-9a-fA-F]{4}/.test(s)) {
    const d = s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    if (d !== s) return { name: 'Unicode-unescape', value: d };
  }
  // Base64 (only if it looks like base64 and decodes to printable text)
  if (/^[A-Za-z0-9+/]{8,}={0,2}$/.test(s.trim()) && s.trim().length % 4 === 0) {
    try {
      const d = decodeURIComponent(escape(atob(s.trim())));
      if (d !== s && /[ -~]/.test(d) && !/[\x00-\x08\x0e-\x1f]/.test(d)) {
        return { name: 'Base64-decode', value: d };
      }
    } catch (e) { /* not base64 */ }
  }
  return null;
}

// Fully decode a string through every recognizable layer. Returns the chain.
export function decodeChain(s) {
  const chain = [{ name: 'raw', value: s }];
  let cur = s;
  let guard = 0;
  while (guard++ < 8) {
    const next = decodeOneLayer(cur);
    if (!next || next.value === cur) break;
    chain.push(next);
    cur = next.value;
  }
  return chain;
}

// ---- attack classes ------------------------------------------------------

export const CLASSES = [
  { id: 'sqli', label: 'SQL Injection', emoji: '💉' },
  { id: 'xss', label: 'XSS', emoji: '📜' },
  { id: 'traversal', label: 'Path Traversal', emoji: '📂' },
  { id: 'cmdi', label: 'Command Injection', emoji: '🐚' },
  { id: 'ssrf', label: 'SSRF', emoji: '🔁' },
  { id: 'policy', label: 'Policy Violation', emoji: '🚫' },
];

// ---- flavour pools -------------------------------------------------------

export const IPS = [
  '192.0.2.14', '192.0.2.77', '198.51.100.9', '198.51.100.42',
  '203.0.113.7', '203.0.113.88', '198.51.100.200', '203.0.113.19',
];
export const COUNTRIES = ['US', 'DE', 'NL', 'BR', 'IN', 'SG', 'RU', 'CN', 'FR', 'GB'];
export const UAS = [
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0',
  'Mozilla/5.0 (X11; Linux x86_64) Gecko/20100101 Firefox/125.0',
  'curl/8.4.0',
  'python-requests/2.31.0',
  'MeowMart-App/3.1 (Android 14)',
];

export const SITE = {
  name: 'MeowMart',
  tagline: 'the internet pet superstore',
  endpoints: ['/', '/search', '/product', '/cart', '/checkout', '/login',
              '/account', '/api/orders', '/api/user', '/admin', '/avatar', '/fetch'],
  directives: [
    'The /admin panel is internal only — public requests to it are a policy violation.',
    'Partner bot MeowMart-App is trusted. Normal shoppers use browsers.',
    'Avatars are uploaded as base64 — decode them, but images are fine.',
  ],
};

// ---- request templates ---------------------------------------------------
// A template produces a request object. `kind` is 'legit' or an attack class.
// `payloadField` tells the engine which field holds the interesting token so
// it can wrap it in encoding layers for medium/hard.

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Legit requests -----------------------------------------------------------
const legit = [
  () => ({ method: 'GET', path: '/search', query: { q: pick(['cat tree', 'dog food', 'litter box', 'aquarium filter']) }, why: 'Ordinary product search.' }),
  () => ({ method: 'GET', path: '/product', query: { id: String(100 + Math.floor(Math.random() * 800)) }, why: 'Numeric product id, nothing odd.' }),
  () => ({ method: 'POST', path: '/cart', body: { sku: 'CAT-' + (1000 + Math.floor(Math.random() * 900)), qty: String(1 + Math.floor(Math.random() * 4)) }, why: 'Adding an item to the cart.' }),
  () => ({ method: 'POST', path: '/login', body: { user: pick(['sophie', 'liam', 'noah', 'mia']), pass: '••••••••' }, why: 'Plain login, no injection.' }),
  () => ({ method: 'GET', path: '/account', headers: { Cookie: 'session=a3f9c2e1b7d4' }, why: 'Logged-in shopper viewing their account.' }),
  () => ({ method: 'GET', path: '/api/orders', headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJ1aWQiOjQyfQ.sig' }, why: 'Valid-looking API token, normal endpoint.' }),
  // decoy: contains scary-looking but harmless content
  () => ({ method: 'POST', path: '/search', body: { q: "How do I use ' OR 1=1 safely in a tutorial?" }, why: 'A forum search that just MENTIONS SQL — no actual injection against our query.', decoy: true }),
  () => ({ method: 'POST', path: '/product', body: { review: 'I love the <b>blue</b> collar!' }, why: 'A review using a harmless bold tag, not a script.', decoy: true }),
  () => ({ method: 'POST', path: '/avatar', body: { img: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==' }, why: 'Base64 avatar upload — decodes to an image header, not code.', decoy: true }),
];

// Attacks ------------------------------------------------------------------
const attacks = [
  { kind: 'sqli', payloadField: 'q',
    make: () => ({ method: 'GET', path: '/search', query: { q: "' OR 1=1--" } }),
    why: "Classic SQL injection: ' OR 1=1-- makes the WHERE clause always true." },
  { kind: 'sqli', payloadField: 'id',
    make: () => ({ method: 'GET', path: '/product', query: { id: '1 UNION SELECT username,password FROM users--' } }),
    why: 'UNION-based SQLi trying to pull the users table.' },
  { kind: 'sqli', payloadField: 'user',
    make: () => ({ method: 'POST', path: '/login', body: { user: "admin'--", pass: 'x' } }),
    why: "Auth bypass: admin'-- comments out the password check." },
  { kind: 'xss', payloadField: 'q',
    make: () => ({ method: 'GET', path: '/search', query: { q: '<script>alert(1)</script>' } }),
    why: 'Reflected XSS: a script tag echoed back into the page.' },
  { kind: 'xss', payloadField: 'review',
    make: () => ({ method: 'POST', path: '/product', body: { review: '<img src=x onerror=alert(document.cookie)>' } }),
    why: 'Stored XSS via an img onerror handler stealing cookies.' },
  { kind: 'traversal', payloadField: 'file',
    make: () => ({ method: 'GET', path: '/avatar', query: { file: '../../../../etc/passwd' } }),
    why: 'Path traversal climbing out of the upload dir to /etc/passwd.' },
  { kind: 'traversal', payloadField: 'page',
    make: () => ({ method: 'GET', path: '/product', query: { page: '....//....//windows/win.ini' } }),
    why: 'Traversal using ....// to dodge naive ../ filters.' },
  { kind: 'cmdi', payloadField: 'host',
    make: () => ({ method: 'POST', path: '/api/user', body: { host: '127.0.0.1; cat /etc/shadow' } }),
    why: 'Command injection: ; chains a second shell command.' },
  { kind: 'cmdi', payloadField: 'name',
    make: () => ({ method: 'POST', path: '/cart', body: { name: 'cat$(reboot)' } }),
    why: 'Command injection via $() command substitution.' },
  { kind: 'ssrf', payloadField: 'url',
    make: () => ({ method: 'GET', path: '/fetch', query: { url: 'http://169.254.169.254/latest/meta-data/' } }),
    why: 'SSRF reaching the cloud metadata endpoint to steal credentials.' },
  { kind: 'ssrf', payloadField: 'url',
    make: () => ({ method: 'POST', path: '/fetch', body: { url: 'http://localhost:6379/' } }),
    why: 'SSRF pointed at an internal Redis port.' },
  { kind: 'policy', payloadField: null,
    make: () => ({ method: 'GET', path: '/admin', headers: { 'X-Forwarded-For': pick(IPS) } }),
    why: 'Public request to the internal-only /admin panel — policy violation.' },
  { kind: 'policy', payloadField: null,
    make: () => ({ method: 'GET', path: '/api/user', query: { id: '*' }, headers: {} }),
    why: 'Wildcard id trying to enumerate every user — policy violation.' },
];

export function legitPool() { return legit; }
export function attackPool() { return attacks; }

// ---- patch events --------------------------------------------------------
// Each has a correct snippet index and plausible wrong ones.
export const PATCHES = [
  {
    cls: 'sqli', endpoint: '/search',
    prompt: 'Vuln report: /search builds SQL from the q parameter. Pick the fix.',
    options: [
      { code: 'db.query("SELECT * FROM items WHERE name LIKE ?", [q])', ok: true },
      { code: 'db.query("SELECT * FROM items WHERE name LIKE \'" + q + "\'")', ok: false },
      { code: 'db.query("SELECT * FROM items WHERE name LIKE \'" + q.replace("\'","") + "\'")', ok: false },
    ],
    explain: 'Parameterized queries separate data from code — the only real fix.',
  },
  {
    cls: 'xss', endpoint: '/product',
    prompt: 'Vuln report: reviews on /product are rendered as raw HTML. Pick the fix.',
    options: [
      { code: 'el.textContent = review', ok: true },
      { code: 'el.innerHTML = review', ok: false },
      { code: 'el.innerHTML = review.replace("<script>","")', ok: false },
    ],
    explain: 'Assigning to textContent escapes everything; blacklisting tags is bypassable.',
  },
  {
    cls: 'traversal', endpoint: '/avatar',
    prompt: 'Vuln report: /avatar joins a user path onto the upload dir. Pick the fix.',
    options: [
      { code: 'if (!resolve(dir, f).startsWith(dir)) throw 403', ok: true },
      { code: 'f = f.replace("../", "")', ok: false },
      { code: 'f = decodeURIComponent(f)', ok: false },
    ],
    explain: 'Resolve the real path and confirm it stays inside the base dir.',
  },
  {
    cls: 'ssrf', endpoint: '/fetch',
    prompt: 'Vuln report: /fetch requests any URL a user supplies. Pick the fix.',
    options: [
      { code: 'if (!ALLOWED_HOSTS.has(new URL(u).hostname)) throw 403', ok: true },
      { code: 'if (u.includes("169.254")) throw 403', ok: false },
      { code: 'u = u.replace("localhost","")', ok: false },
    ],
    explain: 'An allow-list of hostnames beats trying to blacklist every internal address.',
  },
];
