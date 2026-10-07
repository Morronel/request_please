# REQUEST, PLEASE — WAF Simulator

A frontend-only, mobile-first game in the spirit of *Papers, Please*, but you
play a **Web Application Firewall**. HTTP requests queue at your gate; you
inspect them, decode their payloads, and decide **PASS** or **BLOCK** — and
classify every attack you block.

No backend, no build step. Just static files.

## Play

Open `index.html` in a browser, or serve the folder:

```sh
npx http-server . -p 8080   # then open http://localhost:8080
```

Works on desktop and phones. On a phone, swipe the request card left to pass
or right to block; tap glowing tokens to decode them.

## Controls

- **PASS / BLOCK** buttons in the thumb zone, or swipe the card.
- Tap a highlighted token, or the 🔍 button, to open the decoder (it peels
  encoding layers: URL, Base64, HTML entities, hex, unicode).
- ⚙ opens the rule builder (auto-block matching requests — but keep rules
  tight or you'll block real customers).
- Desktop: `A`/`←` pass, `D`/`→` block, `Space` decode, `1`–`6` class.

## Modes

Endless mode at three difficulties — **easy / medium / hard** — which scale
the timer, how many encoding layers payloads hide behind, which attack
classes appear (SQLi, XSS, path traversal, command injection, SSRF, policy),
and how many decoys mimic real attacks.

See [`docs/DESIGN.md`](docs/DESIGN.md) for the full design.

## Structure

- `index.html` — entry point
- `src/style.css` — CRT/terminal styling, mobile layout
- `src/content.js` — attacks, legit traffic, encoders, patch events (data)
- `src/engine.js` — game logic (scoring, difficulty, rules), no DOM
- `src/ui.js` — DOM rendering, swipe/tap controls, bottom sheets
