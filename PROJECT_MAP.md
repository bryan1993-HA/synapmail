# Synapmail — Project Map

Quick navigation reference for every file and feature.

---

## 🗺️ Find It Fast

| I need to... | Go to |
|---|---|
| Change login page | `app/(auth)/login/page.tsx` |
| Change email list | `components/layout/MessageList.tsx` |
| Change email viewer | `components/layout/ReadingPane.tsx` |
| Change attachment preview | `components/layout/ReadingPane.tsx` → `AttachmentSection` |
| Change compose | `components/mail/ComposeModal.tsx` |
| Change signature logic | `components/mail/ComposeModal.tsx` → `handleSigChange` |
| Change sidebar/folders | `components/layout/Sidebar.tsx` |
| Change rich editor | `components/compose/RichEditor.tsx` |
| Add/edit translations | `locales/en.json` + `locales/fr.json` |
| Change auth logic | `lib/auth.ts` |
| Change DB queries | `lib/db.ts` |
| Change IMAP logic / attachment detection | `lib/imap.ts` → `detectAttachments` |
| Change profile (name/password) | `app/(app)/settings/profile/page.tsx` + `app/api/profile/route.ts` |
| Change SMTP logic | `lib/smtp.ts` |
| Add API route | `app/api/` |
| Change middleware | `middleware.ts` |
| Change global styles | `app/globals.css` |
| Change Docker config | `/mnt/stockage/docker/synapmail/` |
| Change env variables | `/mnt/stockage/docker/synapmail/.env` |

---

## 📁 Directory Tree

```
/mnt/stockage/Web/synapmail/
│
├── 📄 CLAUDE.md              ← AI context (read first)
├── 📄 PROJECT_MAP.md         ← This file
├── 📄 README.md              ← GitHub public readme
├── 📄 CHANGELOG.md           ← Release history
├── 📄 CONTRIBUTING.md        ← How to contribute
├── 📄 LICENSE                ← MIT
├── 📄 .env.example           ← Env template (no secrets)
├── 📄 .gitignore
├── 📄 middleware.ts          ← Auth guard + i18n
├── 📄 next.config.mjs        ← Next.js + withNextIntl
├── 📄 tailwind.config.ts
├── 📄 tsconfig.json
│
├── 📁 app/
│   ├── layout.tsx            ← Root: ThemeProvider + IntlProvider
│   ├── globals.css           ← CSS variables (dark/light)
│   ├── (auth)/               ← Public routes (no auth)
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── (app)/                ← Protected routes
│   │   ├── layout.tsx        ← AppShell (three-column)
│   │   ├── mail/page.tsx     ← Main inbox view
│   │   ├── settings/         ← User settings
│   │   └── admin/            ← Admin panel
│   └── api/                  ← REST API
│       ├── auth/             ← Auth.js
│       ├── accounts/         ← Email accounts CRUD
│       ├── messages/         ← IMAP read/delete
│       ├── folders/          ← Folder list
│       ├── send/             ← SMTP send
│       ├── search/           ← Full-text search
│       ├── attachments/      ← File download
│       └── stream/           ← SSE new mail notify
│
├── 📁 components/
│   ├── layout/               ← App shell components
│   │   ├── AppShell.tsx      ← Three-column container
│   │   ├── Sidebar.tsx       ← Accounts + folders
│   │   ├── MessageList.tsx   ← Email list (center)
│   │   └── ReadingPane.tsx   ← Email viewer (right)
│   ├── compose/              ← Email composition
│   │   ├── ComposeModal.tsx
│   │   ├── RichEditor.tsx    ← Tiptap
│   │   └── AttachmentList.tsx
│   ├── mail/                 ← Email-specific components
│   │   ├── MessageRow.tsx
│   │   ├── MessageViewer.tsx
│   │   ├── ThreadView.tsx
│   │   └── FolderTree.tsx
│   ├── ui/                   ← shadcn/ui components
│   └── providers.tsx         ← Context providers
│
├── 📁 lib/
│   ├── auth.ts               ← Auth.js config
│   ├── db.ts                 ← PostgreSQL client
│   ├── imap.ts               ← imapflow wrapper
│   ├── smtp.ts               ← nodemailer wrapper
│   ├── accounts.ts           ← Account helpers + encryption
│   ├── encrypt.ts            ← AES-256-GCM encrypt/decrypt
│   └── utils.ts              ← cn() + misc
│
├── 📁 types/
│   ├── email.ts              ← Email, Message, Folder, Attachment types
│   ├── account.ts            ← EmailAccount, User types
│   └── api.ts                ← API response types
│
├── 📁 locales/
│   ├── en.json               ← English
│   └── fr.json               ← French
│
├── 📁 public/
│   ├── logo.svg
│   └── screenshots/          ← README screenshots
│
└── 📁 docker/ (symlink info)
    → /mnt/stockage/docker/synapmail/
       ├── docker-compose.yml
       └── .env
```

---

## 🔌 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/accounts` | List user email accounts |
| POST | `/api/accounts` | Add email account |
| PATCH | `/api/accounts/[id]` | Update account |
| DELETE | `/api/accounts/[id]` | Remove account |
| GET | `/api/messages?account=&folder=&page=&filter=` | List messages |
| GET | `/api/messages/[id]?account=&folder=` | Get message content |
| DELETE | `/api/messages/[id]?account=&folder=` | Delete message |
| PATCH | `/api/messages/[id]/read` | Mark read/unread |
| POST | `/api/messages/[id]/move` | Move to folder |
| POST | `/api/messages/[id]/star` | Star/unstar |
| GET | `/api/folders?account=` | List IMAP folders |
| POST | `/api/send` | Send email |
| GET | `/api/search?q=&account=` | Search messages |
| GET | `/api/messages/[id]/attachment/[partId]?account=&folder=&inline=` | Download or preview attachment |
| GET | `/api/profile` | Get current user profile |
| PATCH | `/api/profile` | Update name or password |
| GET | `/api/stream` | SSE new mail events |

---

## 🗄️ Database Tables

| Table | Purpose |
|-------|---------|
| `users` | App users (admin/user roles) |
| `email_accounts` | IMAP/SMTP accounts per user |
| `signatures` | Email signatures per account |
| `messages_cache` | Cached message metadata |
| `user_settings` | Per-user preferences |

---

## 🌍 i18n Keys Structure

```json
{
  "auth": { "login": {}, "register": {} },
  "mail": { "inbox": {}, "compose": {}, "folders": {} },
  "settings": { "accounts": {}, "profile": {}, "signatures": {} },
  "admin": { "users": {} },
  "common": { "actions": {}, "errors": {} }
}
```

---

## 🐳 Docker

```bash
# Build & start
docker compose -f /mnt/stockage/docker/synapmail/docker-compose.yml up -d --build

# Logs
docker compose -f /mnt/stockage/docker/synapmail/docker-compose.yml logs -f

# Stop
docker compose -f /mnt/stockage/docker/synapmail/docker-compose.yml down
```

Container: `synapmail` | Port: `3500→3000` | Network: `reverse-proxy_ngix_net`
