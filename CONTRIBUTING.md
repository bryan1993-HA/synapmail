# Contributing to Synapmail

Thank you for your interest in contributing to Synapmail!

## Code of Conduct

Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md).
TL;DR: be respectful, constructive, and welcoming to everyone.

---

## How to Contribute

### 1. Fork and clone

```bash
git clone https://github.com/YOUR_USERNAME/synapmail.git
cd synapmail
```

### 2. Install dependencies

```bash
npm install
```

### 3. Set up your environment

```bash
cp .env.example .env.local
# Edit .env.local with a local PostgreSQL instance and test IMAP/SMTP credentials
```

### 4. Run in development mode

```bash
npm run dev
```

### 5. Create a feature branch

```bash
git checkout -b feat/my-feature
# or
git checkout -b fix/some-bug
```

### 6. Make your changes

### 7. Open a Pull Request

Push your branch to your fork and open a PR against the `main` branch of `bryan1993-HA/synapmail`.

> **Note:** `main` is protected — all changes must go through a PR. The CI pipeline (ESLint + CodeQL) runs automatically and must pass before a PR can be merged.

---

## CI Pipeline

Every PR triggers two checks automatically via GitHub Actions:

| Check | What it does |
|-------|-------------|
| **ESLint** | Lints all TypeScript/TSX files |
| **CodeQL** | Static security analysis (security-extended ruleset) |

Run ESLint locally before pushing to catch issues early:

```bash
npm run lint
```

---

## Code Style

- **TypeScript strict mode** is enabled — no implicit `any`
- **ESLint** is configured — run `npm run lint` before submitting
- Use **arrow functions** for component-level helpers; avoid `function` declarations inside component bodies
- Use `cn()` from `lib/utils.ts` for conditional class names
- Server components by default, add `'use client'` only when needed

---

## Internationalization

Every user-facing string must be translated. When you add or modify text:

1. Add the key to `locales/en.json`
2. Add the French translation to `locales/fr.json`
3. Use `useTranslations('namespace.key')` in client components
4. Use `getTranslations('namespace')` in server components

Never hardcode user-visible strings in component files.

---

## Screenshots

If your PR changes the **visual appearance** of the app (layout, colors, new components, redesign), regenerate the README screenshots before submitting:

```bash
node scripts/gen-screenshots.mjs
git add docs/screenshots/
git commit -m "docs: update screenshots"
```

See [`docs/screenshots/README.md`](docs/screenshots/README.md) for full instructions.

---

## Commit Style

Follow [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | Use for |
|--------|---------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation changes |
| `chore:` | Dependency updates, config changes |
| `refactor:` | Code changes without feature/fix |
| `style:` | Formatting only |
| `test:` | Tests |

Examples:
```
feat: add attachment download support
fix: handle IMAP connection timeout gracefully
docs: update README with multi-user setup guide
chore: upgrade imapflow to 1.8.0
```

---

## Security

Please **do not open public issues for security vulnerabilities**.
Report them privately via [GitHub Security Advisories](https://github.com/bryan1993-HA/synapmail/security/advisories/new) or by email — see [SECURITY.md](SECURITY.md).

---

## Questions?

Start a [GitHub Discussion](https://github.com/bryan1993-HA/synapmail/discussions) — we're happy to help.
