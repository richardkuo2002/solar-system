# UI / CSS change verification

Checklist for any change that touches `css/style.css`, or JS that affects
layout (panel structure, collapsible state, anything in `src/render/`).
Scope and rationale decided by a council review (`/council`, 2026-10-06,
`shipping` triad: Torvalds/Musashi/Feynman) — see that conversation for the
full deliberation. Summary of why this exists and why it stays this small:

- Every mobile-layout bug found in that session (a CSS-specificity bug
  hiding/showing elements, a missing-scroll bug, a layout-overload bug) was
  caught by resizing a Playwright-driven browser to two fixed viewports,
  screenshotting, and looking — done ad hoc, invented fresh each time. This
  doc just writes that proven loop down so it stops being reinvented.
- Explicitly **not** adopted: a `playwright` npm dependency, a CI
  visual-regression job, pixel-diff baselines (Percy/Chromatic-style), a
  third "tablet" breakpoint, a dedicated vision-diff MCP server. All of
  these are what industry teams reach for once manual comparison becomes
  the bottleneck — for this zero-build, single-maintainer repo, it hasn't.
  Revisit if that changes (more contributors, weekly UI churn).

## Fixed viewports

Only two. Don't add a third without a real bug that only shows up there.

- **Mobile**: 390×844
- **Desktop**: 1366×768

(These aren't arbitrary — they're the two sizes that caught every mobile
layout bug found so far.)

## Steps

1. Serve the repo locally (it's zero-build — any static server works, e.g.
   `npx http-server -p 8532 -c-1 .`).
2. Via the Playwright MCP tools: for each viewport above, `browser_resize`,
   `browser_navigate` to the page, wait for it to settle, then
   `browser_take_screenshot` (not `fullPage` unless the bug is about content
   below the fold — the viewport screenshot is what the checklist below is
   about).
3. Also check overflow directly — a screenshot alone can hide it:
   `browser_evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }))`.
   They should match; a bigger `scrollWidth` means something is forcing
   horizontal scroll.
4. Read both screenshots against this fixed checklist (not a vibe check):
   - Nothing clipped, cut off, or overlapping another element.
   - No horizontal scrollbar / `scrollWidth` mismatch (step 3).
   - **Parity**: anything shown on desktop is still reachable on mobile
     (not silently `display:none`'d away) — reachable via scroll or a
     collapsible toggle is fine, invisible-and-unreachable is not.
   - Text and interactive controls are legible/tappable at the mobile size.
5. Clean up: delete any screenshot files you wrote into the repo directory,
   stop the local server.

## The AI review loop

When iterating on a fix, anchor every round in an actual screenshot, not a
self-description of the CSS. The failure mode to avoid: the same agent that
wrote the CSS is a weak judge of its own output from the code alone.

- Give a **concrete complaint tied to what's in the screenshot** ("the
  card's bottom padding is inconsistent with the top", "the collapsed
  header still reserves 40px it shouldn't") — never a vague "make it
  better" (that regresses to average, unfocused changes).
- Expect convergence in **3 rounds or fewer**. Round 2 commonly pulls back
  round 1's overcorrection.
- If round 3 still hasn't converged, stop and flag it to the user instead
  of continuing to iterate — that's a signal the fix needs a design
  decision, not more tweaking.

## When this doesn't apply

Pure logic/data changes with no rendered-layout impact (e.g. orbital
mechanics math, i18n string wording, test-only changes) don't need this —
use judgment, don't screenshot every single diff reflexively.
