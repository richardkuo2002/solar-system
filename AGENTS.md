## Git workflow

- Never commit, push, merge, force-push, delete branches, or modify `main`
  without explicit user approval.
- For all code changes, create or reuse a feature branch:
  `feat/<feature>`, `fix/<issue>`, or `chore/<task>`.
- You may commit and push to the current non-main feature branch only after:
  1. showing a concise diff summary,
  2. running relevant tests, lint, and build checks,
  3. reporting the exact commands and results.
- Create a pull request targeting `main`, but never merge it.
- Never directly change CI/CD, deployment, authentication, secret handling,
  environment configuration, database migrations, or dependency lockfiles
  without asking first.
- Never commit secrets, `.env` files, credentials, generated assets, or local
  agent memory.

## UI / CSS changes

- Any change touching `css/style.css` or layout-affecting `src/render/`
  code: screenshot-check at both 390×844 (mobile) and 1366×768 (desktop)
  before reporting the change done. See `docs/ui-review.md` for the fixed
  checklist, the overflow check, and the AI review-loop rule (concrete
  screenshot-anchored complaints, converge in ≤3 rounds).
