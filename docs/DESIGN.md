# REQUEST, PLEASE — design doc (endless mode)

A Papers, Please–style shift game where you are the Web Application Firewall.
HTTP requests queue up at your gate. You inspect them, decode what they carry,
and decide: **PASS** or **BLOCK**. Get it right and the site stays up and the
customers stay happy. Get it wrong and you either let an attacker in or you
block a paying customer, and your SOC lead writes you up.

Frontend only, no build step, no backend. Plain HTML + CSS + vanilla JS
modules. State persists in `localStorage` (high scores, settings).

## Core loop

1. **Shift starts.** You get a short briefing: the site you defend
   (e.g. "MeowMart pet shop"), its known endpoints, and today's directives
   ("The /admin panel is internal only", "Partner bot `PartnerSync/2.1` is allowed").
2. **A request arrives** as a card: method, path, query, headers, body,
   source IP and country.
3. **Inspect.** Tap any highlighted token to open the *Decoder*. Decoding is
   layered: tap again to peel the next layer (URL → Base64 → HTML entities…).
4. **Decide.** PASS or BLOCK. If you BLOCK, you must also **classify** the
   attack (SQLi, XSS, Path Traversal, Command Injection, SSRF, Policy). A
   correct block with a wrong class gets partial credit.
5. **Feedback.** Instant verdict stamp, short "why" explanation with the
   decoded payload, score delta. Then the next request.
6. **Rules.** Every few requests you can spend a *rule slot* to write a
   simple WAF rule (pick field + operator + value). Rules auto-handle future
   matching requests, which is great until a rule is too broad and starts
   eating legit traffic (false positives cost you).
7. **Patch events.** Occasionally an incident pops: "Vuln found in
   /search". You pick the right patch from 3 code snippets (parameterized
   query vs. string concat, output encoding vs. none, etc.). Correct patch
   makes that whole class harmless on that endpoint for the rest of the shift.
8. **Endless.** Requests keep coming; the queue speeds up over time. The
   run ends when **Integrity** (breaches) or **Reputation** (false
   positives / timeouts) hits zero.

## Meters and scoring

- **Integrity** (starts 3 ♥): lose one per attack you PASS.
- **Reputation** (starts 3 ★): lose one per legit request you BLOCK, or per
  request that times out in the queue.
- **Score:** +100 correct pass, +150 correct block, +50 bonus for right
  class, combo multiplier for streaks (x1 → x4), speed bonus.
- Every 10 correct decisions refills one meter (max 3) to keep runs going.

## Difficulty tiers

| | Easy | Medium | Hard |
|---|---|---|---|
| Timer per request | none | 25 s | 15 s, shrinking |
| Encoding depth | 0–1 (URL) | 1–2 (URL, Base64, HTML) | 2–3, mixed, plus hex/unicode/double-URL |
| Attack share | ~40% | ~50% | ~55%, with look-alike legit traffic |
| Classes | SQLi, XSS, Traversal | + CmdI, Policy | + SSRF, header-borne attacks |
| Decoys | none | benign quotes/`<b>` in comments | lots: legit SQL tutorial posts, base64 avatars, etc. |
| Rules | 3 slots, hinted | 2 slots | 1 slot, false positives hurt double |
| Patch events | every ~8 | every ~10 | every ~12, harder snippets |
| Classification | multiple choice, hint on wrong | required for full score | required, wrong class = half points only |

## Mobile controls (fat-finger first)

- One-column layout, request card scrolls, **decision bar fixed at the
  bottom** in the thumb zone: two big buttons (≥ 56 px tall), PASS left
  (green), BLOCK right (red).
- **Swipe** the card right to pass, left to block (with visual drag
  feedback and a threshold so stray scrolls don't fire).
- Tappable tokens have ≥ 44 px hit areas via padding; tap opens a bottom
  sheet decoder, not a tiny popover.
- Classification is a bottom sheet with 6 large chip buttons + emoji icon.
- Haptics via `navigator.vibrate` where available; can be turned off.
- Desktop: keyboard shortcuts (`A`/`←` pass, `D`/`→` block, `1-6` class,
  `Space` decode).

## Nerd flavour

- Terminal/CRT look: monospace, green-on-black, scanline overlay (toggleable).
- Fake log ticker at the top ("[20:14:02] 203.0.113.7 GET /cart 200").
- IPs from documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24).
- Real-feeling user agents, cookie names, JWT-shaped tokens.
- Payloads are the classic textbook examples (`' OR 1=1--`,
  `<script>alert(1)</script>`, `../../etc/passwd`), recognizable and
  educational, aimed at a fictional site.
- Post-run "incident report" with your accuracy per class.

## Out of scope for now

Campaign/story, sound, accounts, online leaderboard.

## Tech

`index.html`, `src/*.js` (ES modules), `src/style.css`. Served as static
files (GitHub Pages compatible). Content is generated from templates in
`src/content.js`, so new attacks and legit traffic are data, not code.


---

## v2 — what makes it actually fun (post-review pass)

The first cut was a decision drill. This pass makes it a *shift*, in the
Papers, Please sense: rules pile up, pressure builds, and you juggle.

- **Raw HTTP view.** Requests render as a real request block (request line,
  `Host`, headers, form body) in monospace, not a tidy key/value table. You
  read traffic the way you would in a proxy. Only genuinely suspicious or
  encoded values are highlighted as decode targets, so normal headers
  (User-Agent, Host, session cookies) stay quiet and don't cry wolf.
- **Hands-on decoding.** On medium/hard you don't get the answer handed to
  you. You tap a token and *choose* which transform to apply — URL, Base64,
  HTML entities, hex, unicode — peeling one layer at a time. A wrong guess
  does nothing (the button shakes). You decode until it reads as plain text,
  then judge. Easy keeps auto-decode so newcomers learn the shapes.
- **Shifts + escalating directives.** Every ~10–15 requests a shift ends
  (+250) and the boss adds a *new directive* that changes what's allowed:
  block an IP range, freeze checkout, require auth on `/api/`, honour a
  red-team header, ban `curl`. Directives stack and are injected into live
  traffic, so you're constantly re-learning the ruleset mid-run — that's the
  Papers, Please tension.
- **Rules that bite both ways.** A rule auto-blocks matching traffic and is
  evaluated after one URL-decode (like a real WAF), so you can catch encoded
  attacks — but too broad and it eats real customers, which costs you.
- **Decoys that look exactly like attacks.** Apostrophes in surnames,
  URL-encoded ampersands, base64 preference cookies, `<b>` in reviews, PNG
  avatars. Blocking these is a false positive.

All content (attacks, legit traffic, decoys, directives, patches, decoders)
lives in `src/content.js` as data. A test hook behind `?test=1` exposes
ground truth so the playtest harness can drive full runs; it's inert in
normal play.
