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
