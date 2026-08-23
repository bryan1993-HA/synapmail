# Contributing to Synapmail

Thank you for your interest in contributing to Synapmail!

## Code of Conduct

Please be respectful and constructive in all interactions. We follow the standard open-source community norms — harassment and discrimination of any kind will not be tolerated.

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

## Testing

Currently there are no automated tests. When adding complex logic (encryption, IMAP parsing, date calculations), please add comments explaining the expected behaviour so others can verify manually.

---

## Questions?

Open a GitHub Issue or start a Discussion. We're happy to help.
