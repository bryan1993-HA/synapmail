# Synapmail

> **Self-hosted, open-source email client — IMAP/SMTP, multi-account, rich editor**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker)](https://www.docker.com/)

> **Warning** — Active Development. The project is functional but APIs may change between versions.

---

## Features

- **Three-column layout** — Sidebar / Message list / Reading pane, fully responsive
- **Multi-user** — Each user manages their own email accounts and settings
- **Multi-account** — Connect any number of IMAP/SMTP mailboxes per user
- **Rich email editor** — Tiptap-powered composer with formatting, links, images, attachments
- **Dark / Light theme** — System detection, manual override
- **Full internationalization** — English and French built-in, easy to extend
- **Email signatures** — Per-account rich-text signatures
- **Starred & flagged messages** — Visual indicators and filter
- **Real-time notifications** — Server-Sent Events for new mail alerts
- **Encrypted credential storage** — Email passwords stored AES-256-GCM encrypted
- **Admin panel** — User management, account overview
- **Search** — Full-text search across IMAP folders
- **Thread view** — Conversation grouping
- **Attachment support** — Download and attach files
- **Docker-first deployment** — One command to run

---

## Quick Start (Docker)

### 1. Clone the repository

```bash
git clone https://github.com/bryan1993-HA/synapmail.git
cd synapmail
```

### 2. Create Docker configuration

```bash
mkdir -p /path/to/docker/synapmail
cp .env.example /path/to/docker/synapmail/.env
```

### 3. Configure environment

Edit `/path/to/docker/synapmail/.env`:

```env
NEXTAUTH_URL=https://mail.yourdomain.com
NEXTAUTH_SECRET=$(openssl rand -base64 32)
DATABASE_URL=postgresql://synapmail_user:password@postgres:5432/synapmail
ENCRYPTION_KEY=$(openssl rand -hex 32)
NEXT_PUBLIC_APP_URL=https://mail.yourdomain.com
REGISTRATION_ENABLED=true
```

### 4. Start with Docker Compose

```bash
docker compose -f /path/to/docker/synapmail/docker-compose.yml up -d --build
```

The app will be available at `http://localhost:3500`.

### 5. Create your admin account

With `REGISTRATION_ENABLED=true`, navigate to `http://localhost:3500/register` to create the first user. After setup, set `REGISTRATION_ENABLED=false` in your `.env` and restart the container.

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXTAUTH_URL` | Yes | Full public URL of the app (e.g. `https://mail.example.com`) |
| `NEXTAUTH_SECRET` | Yes | Random secret for JWT signing — `openssl rand -base64 32` |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `ENCRYPTION_KEY` | Yes | 32-byte hex key for encrypting email passwords — `openssl rand -hex 32` |
| `NEXT_PUBLIC_APP_URL` | Yes | Same as `NEXTAUTH_URL`, exposed to client |
| `REGISTRATION_ENABLED` | No | `true` to allow new registrations (default: `true`) |

### `.env.example`

See [.env.example](.env.example) for the full template.

---

## Multi-User Setup

Synapmail supports multiple independent users on one instance:

1. First user to register can be promoted to admin via direct DB update:
   ```sql
   UPDATE users SET role = 'admin' WHERE email = 'your@email.com';
   ```
2. Admin users can access `/admin/users` to manage other users.
3. Set `REGISTRATION_ENABLED=false` once all users are created to prevent open registration.
4. Each user independently manages their own IMAP/SMTP accounts under Settings > Email accounts.

---

## REST API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/accounts` | List email accounts for authenticated user |
| `POST` | `/api/accounts` | Add a new email account |
| `PATCH` | `/api/accounts/[id]` | Update an email account |
| `DELETE` | `/api/accounts/[id]` | Remove an email account |
| `GET` | `/api/messages?folder=&page=&filter=` | List messages (IMAP) |
| `GET` | `/api/messages/[id]?account=&folder=` | Fetch message content |
| `DELETE` | `/api/messages/[id]?account=&folder=` | Delete a message |
| `PATCH` | `/api/messages/[id]/read` | Mark as read / unread |
| `POST` | `/api/messages/[id]/move` | Move to another folder |
| `POST` | `/api/messages/[id]/star` | Star / unstar |
| `GET` | `/api/folders?account=` | List IMAP folders |
| `POST` | `/api/send` | Send an email via SMTP |
| `GET` | `/api/search?q=&account=` | Full-text search |
| `GET` | `/api/attachments/[id]` | Download attachment |
| `GET` | `/api/stream` | Server-Sent Events for new mail |

All endpoints require authentication. Responses follow `{ data?, error? }` shape.

---

## Development

### Prerequisites

- Node.js 20+
- PostgreSQL 16+

### Setup

```bash
git clone https://github.com/bryan1993-HA/synapmail.git
cd synapmail
npm install
cp .env.example .env.local
# Edit .env.local with your values
npm run dev
```

App runs at `http://localhost:3000`.

### Useful commands

```bash
npm run dev        # Start dev server
npm run build      # Production build
npm run lint       # ESLint
```

### Docker (production)

```bash
docker compose -f /mnt/stockage/docker/synapmail/docker-compose.yml up -d --build
docker compose -f /mnt/stockage/docker/synapmail/docker-compose.yml logs -f synapmail
docker compose -f /mnt/stockage/docker/synapmail/docker-compose.yml down
```

---

## Internationalization (i18n)

Synapmail uses [next-intl](https://next-intl-docs.vercel.app/) for translations.

| Language | Code | File |
|----------|------|------|
| English | `en` | `locales/en.json` |
| French | `fr` | `locales/fr.json` |

To add a new language:
1. Create `locales/[code].json` with the same keys as `en.json`
2. Add the locale code to the `locales` array in `middleware.ts`
3. Update `lib/i18n.ts` if needed

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full guide.

In short:
1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Commit using [Conventional Commits](https://www.conventionalcommits.org/): `feat: add X`, `fix: Y`, `docs: Z`
4. Open a Pull Request

---

## License

[MIT](LICENSE) — Bryan Thoury, 2025–present.
