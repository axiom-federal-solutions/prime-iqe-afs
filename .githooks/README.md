# PRIME Git Hooks

Shared git hooks that travel with the repo. Designed to prevent regressions
of the wrong-Supabase-project bug that cost us multiple cycles of "no data."

## What's here

- **`pre-commit`** — blocks any commit that adds references to stale Supabase
  project IDs (`luilinnjlsmtgkqopzmg`, `lsgaifejjoxqudjhkeev`). Only the canonical
  `czoyvxyfewqaoewzxlin` is allowed.

## Activation

These hooks live under `.githooks/` (instead of the default `.git/hooks/`) so
they're tracked in git. To activate, point git at this directory:

```bash
git config core.hooksPath .githooks
```

This is run automatically as part of `npm install` (see the `prepare` script
in `package.json`), so anyone who clones and installs gets the protection
without thinking about it.

To verify it's wired up:

```bash
git config --get core.hooksPath
# Should print: .githooks
```

## Bypassing (don't)

If you have a genuine emergency and need to bypass:

```bash
git commit --no-verify -m "your message"
```

If you find yourself reaching for `--no-verify` to avoid the stale-URL check,
something is wrong with your change — go fix the URL instead.

## Adding a hook

Drop the script in this folder, name it for the git lifecycle event
(`pre-commit`, `pre-push`, `commit-msg`, etc.), and make it executable:

```bash
chmod +x .githooks/pre-commit
```

On Windows the executable bit is implicit; just make sure the file has a
shebang line (`#!/usr/bin/env bash`).
