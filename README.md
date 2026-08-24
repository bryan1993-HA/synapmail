<p align="center">
  <img src="https://raw.githubusercontent.com/bryan1993-HA/synapmail/main/public/brand/png/synapmail-logo-horizontal@2400.png" alt="Synapmail" width="480"/>
</p>

<p align="center">
  <strong>Self-hosted, open-source, AI-powered email client — IMAP/SMTP, multi-account, rich editor</strong>
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"/></a>
  <a href="https://nextjs.org/"><img src="https://img.shields.io/badge/Next.js-14-black?logo=next.js" alt="Next.js"/></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-5-blue?logo=typescript" alt="TypeScript"/></a>
  <a href="https://www.docker.com/"><img src="https://img.shields.io/badge/Docker-ready-2496ED?logo=docker" alt="Docker"/></a>
</p>

> **Active Development** — Functional and production-deployed. APIs may change between versions.

---

## Features

### Email client
- **Three-column layout** — Sidebar / Message list / Reading pane, fully responsive (mobile + tablet + desktop)
- **Thread view** — Conversation grouping by normalized subject (Gmail-style)
- **Multi-account** — Connect any number of IMAP/SMTP mailboxes; folder list updates instantly per account
- **Account setup wizard** — Auto-configures Gmail, Outlook, Yahoo, iCloud, Proton Mail, OVH/Orange/Free and custom servers; detects provider from email domain

### Message actions
- **Bulk selection** — Hover avatar → checkbox; select multiple messages and apply actions in one click
- **Bulk mark read / unread** — With optimistic local update
- **Bulk move to folder** — Dropdown of all IMAP folders
- **Bulk delete**
- **Drag & drop to folder** — Drag one or multiple messages onto any sidebar folder; highlighted drop target
- **Right-click context menu** — Mark read/unread, star/unstar, move to folder (hover submenu), delete
- **Keyboard shortcuts** — `c` compose, `r` reply, `a` reply all, `f` forward, `Delete`/`#` delete, `u` mark unread, `/` search, `Escape` close compose
- **Star / flag messages**

### Composition
- **Rich editor** — Tiptap: bold, italic, underline, strikethrough, alignment, lists, links, headings, blockquote, code, HR
- **Reply / Reply All / Forward**
- **CC and BCC** — Toggle fields individually
- **Forward with attachments** — Original attachments pre-listed as removable chips; re-fetched from IMAP server-side and sent
- **Email signatures** — Per-account rich-text signatures with switcher; auto-insert on compose
- **Draft auto-save** — Compose window auto-saves to localStorage every 3 s; restored on next open with "Brouillon restauré" badge

### Reading pane
- **Inline attachment preview** — Images as lightbox thumbnails, PDFs in native browser viewer
- **To / CC recipients** visible in message header
- **Auto mark-as-read** on open

### Notifications & real-time
- **Desktop notifications** — Browser Notification API; click opens the message directly in the app
- **Server-Sent Events** — Real-time new mail polling (30 s per account)

### Settings & admin
- **User profile** — Name and password change
- **Dark / Light / System theme**
- **Full i18n** — English and French built-in, easy to extend
- **Admin panel** — User management (create, role toggle, delete)
- **Microsoft OAuth2** — Connect Outlook/Live/Hotmail via XOAUTH2 (no password stored)
- **Encrypted credentials** — Email passwords AES-256-GCM encrypted at rest

---

## Screenshots

> _Screenshots available in [`public/screenshots/`](public/screenshots/)_

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

With `REGISTRATION_ENABLED=true`, navigate to `/register` to create the first user. After setup, set `REGISTRATION_ENABLED=false` and restart.

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXTAUTH_URL` | Yes | Full public URL (e.g. `https://mail.example.com`) |
| `NEXTAUTH_SECRET` | Yes | Random secret for JWT — `openssl rand -base64 32` |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `ENCRYPTION_KEY` | Yes | 32-byte hex key for email password encryption — `openssl rand -hex 32` |
| `NEXT_PUBLIC_APP_URL` | Yes | Same as `NEXTAUTH_URL`, exposed to client |
| `REGISTRATION_ENABLED` | No | `true` to allow new registrations (default: `true`) |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `c` | New compose |
| `r` | Reply |
| `a` | Reply all |
| `f` | Forward |
| `Delete` / `#` | Delete current message |
| `u` | Mark as unread |
| `/` | Focus search |
| `Escape` | Close compose |

Shortcuts are inactive when an input field or the editor is focused.

---

## REST API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/accounts` | List email accounts |
| `POST` | `/api/accounts` | Add email account |
| `PATCH` | `/api/accounts/[id]` | Update account |
| `DELETE` | `/api/accounts/[id]` | Remove account |
| `POST` | `/api/accounts/test` | Test IMAP + SMTP connection |
| `GET` | `/api/messages?account=&folder=&page=&filter=` | List messages |
| `GET` | `/api/messages/[id]?account=&folder=` | Get full message |
| `PATCH` | `/api/messages/[id]?account=&folder=` | Mark read/unread or star |
| `DELETE` | `/api/messages/[id]?account=&folder=` | Delete message |
| `PATCH` | `/api/messages/bulk` | Bulk mark read/unread or move |
| `DELETE` | `/api/messages/bulk` | Bulk delete |
| `GET` | `/api/messages/[id]/attachment/[partId]?account=&folder=&inline=` | Download or inline-preview attachment |
| `GET` | `/api/folders?account=` | List IMAP folders |
| `POST` | `/api/send` | Send email (with optional forwarded attachments) |
| `GET` | `/api/search?q=&account=` | Full-text IMAP search |
| `GET` | `/api/profile` | Get current user |
| `PATCH` | `/api/profile` | Update name or password |
| `GET` | `/api/stream` | Server-Sent Events — new mail |

All endpoints require authentication. Responses follow `{ data?, error? }` shape.

---

## Multi-User Setup

1. First user registers at `/register`.
2. Promote to admin:
   ```sql
   UPDATE users SET role = 'admin' WHERE email = 'your@email.com';
   ```
3. Admin can manage users at `/admin/users`.
4. Set `REGISTRATION_ENABLED=false` when done.
5. Each user independently manages their IMAP/SMTP accounts under Settings → Email accounts.

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

### Commands

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

## Internationalization

Synapmail uses [next-intl](https://next-intl-docs.vercel.app/).

| Language | Code | File |
|----------|------|------|
| English | `en` | `locales/en.json` |
| French | `fr` | `locales/fr.json` |

To add a language:
1. Create `locales/[code].json` matching the structure of `en.json`
2. Add the locale code to the `locales` array in `middleware.ts`

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Commit using [Conventional Commits](https://www.conventionalcommits.org/)
4. Open a Pull Request

---

## License

[MIT](LICENSE) — Bryan Thoury, 2025–present.
