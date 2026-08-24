# Synapmail — Project Map

Quick navigation reference for every file and feature.

---

## Find It Fast

| I need to... | Go to |
|---|---|
| Change logo / brand assets | `public/brand/` (svg/, png/, anime/) |
| Change favicon | `app/layout.tsx` → metadata.icons |
| Change login page | `app/(auth)/login/page.tsx` |
| Change email list | `components/layout/MessageList.tsx` |
| Change bulk actions / checkboxes / drag | `components/layout/MessageList.tsx` |
| Change right-click context menu | `components/ui/MessageContextMenu.tsx` |
| Change email viewer | `components/layout/ReadingPane.tsx` |
| Change attachment preview | `components/layout/ReadingPane.tsx` → `AttachmentSection` |
| Change compose (reply/replyAll/forward/BCC) | `components/mail/ComposeModal.tsx` |
| Change draft auto-save | `components/mail/ComposeModal.tsx` → `DRAFT_KEY` / localStorage |
| Change signature logic | `components/mail/ComposeModal.tsx` → `handleSigChange` |
| Change sidebar / drag-drop targets | `components/layout/Sidebar.tsx` |
| Change keyboard shortcuts | `hooks/useKeyboardShortcuts.ts` |
| Change desktop notifications | `hooks/useEmailNotifications.ts` |
| Add/edit translations | `locales/en.json` + `locales/fr.json` |
| Change auth logic | `lib/auth.ts` |
| Change DB queries | `lib/db.ts` |
| Change IMAP logic | `lib/imap.ts` |
| Change SMTP / forwarded attachments | `lib/smtp.ts` + `app/api/send/route.ts` |
| Change profile (name/password) | `app/(app)/settings/profile/page.tsx` + `app/api/profile/route.ts` |
| Add email account (wizard) | `app/(app)/settings/accounts/AccountWizard.tsx` |
| Change account list / edit form | `app/(app)/settings/accounts/AccountsClient.tsx` |
| Add provider to wizard | `AccountWizard.tsx` → `PROVIDERS` constant |
| Bulk IMAP operations | `lib/imap.ts` → `markReadBulk`, `deleteMessagesBulk`, `moveMessagesBulk` |
| Bulk API | `app/api/messages/bulk/route.ts` |
| Add API route | `app/api/` |
| Change middleware | `middleware.ts` |
| Change global styles | `app/globals.css` |
| Change Docker config | `/mnt/stockage/docker/synapmail/` |

---

## Directory Tree

```
/mnt/stockage/Web/synapmail/
│
├── CLAUDE.md              ← AI context (read first)
├── PROJECT_MAP.md         ← This file
├── README.md              ← GitHub public readme
├── CHANGELOG.md           ← Release history
├── CONTRIBUTING.md        ← How to contribute
├── LICENSE                ← MIT
├── .env.example           ← Env template (no secrets)
├── middleware.ts          ← Auth guard + i18n routing
├── next.config.mjs        ← Next.js + withNextIntl
├── tailwind.config.ts
├── tsconfig.json
│
├── public/
│   └── brand/
│       ├── svg/                      ← Logos vectoriels (icone, horizontal, vertical + mono/négatif)
│       ├── png/                      ← Exports PNG (favicon@64, icone@512/1024, logos @2400/1600)
│       └── anime/                    ← Logo animé (synapmail-anime.svg)
│
├── app/
│   ├── layout.tsx                    ← Root: ThemeProvider + IntlProvider + favicon metadata
│   ├── globals.css                   ← CSS variables (dark/light)
│   ├── (auth)/                       ← Public routes
│   │   ├── login/page.tsx
│   │   └── register/page.tsx
│   ├── (app)/                        ← Protected routes
│   │   ├── layout.tsx                ← AppShell
│   │   ├── mail/
│   │   │   ├── page.tsx              ← Server component (auth guard)
│   │   │   └── MailClient.tsx        ← Client: orchestrates all mail UI + keyboard shortcuts
│   │   ├── settings/
│   │   │   ├── page.tsx              ← Settings index (server component)
│   │   │   ├── accounts/
│   │   │   │   ├── page.tsx          ← Server component (passes searchParams as props)
│   │   │   │   ├── AccountsClient.tsx
│   │   │   │   ├── AccountWizard.tsx ← Multi-step wizard (provider grid → credentials → advanced)
│   │   │   │   └── ErrorBoundary.tsx
│   │   │   ├── profile/page.tsx
│   │   │   └── signatures/page.tsx
│   │   └── admin/users/page.tsx
│   └── api/
│       ├── auth/[...nextauth]/route.ts
│       ├── accounts/
│       │   ├── route.ts              ← GET list / POST create
│       │   ├── [id]/route.ts         ← PATCH update / DELETE remove
│       │   └── test/route.ts         ← POST test IMAP+SMTP
│       ├── messages/
│       │   ├── route.ts              ← GET list (paginated, filtered)
│       │   ├── [id]/
│       │   │   ├── route.ts          ← GET / PATCH (read, star) / DELETE
│       │   │   └── attachment/[partId]/route.ts  ← GET download or inline preview
│       │   ├── bulk/route.ts         ← PATCH (mark read/move) + DELETE (bulk)
│       │   └── search/route.ts       ← GET full-text search (via IMAP)
│       ├── folders/route.ts          ← GET IMAP folder list
│       ├── send/route.ts             ← POST SMTP send (+ forwarded attachments)
│       ├── profile/route.ts          ← GET + PATCH user profile
│       └── stream/route.ts           ← GET Server-Sent Events
│
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx             ← Three-column shell + mobile drawer
│   │   ├── Sidebar.tsx              ← Accounts + folders + drag-drop targets
│   │   ├── MessageList.tsx          ← Email list: threads, checkboxes, bulk bar, drag source, context menu
│   │   ├── ReadingPane.tsx          ← Email viewer: body, attachments, reply/replyAll/forward
│   │   └── ThreadPane.tsx           ← Multi-message thread view
│   ├── mail/
│   │   └── ComposeModal.tsx         ← Compose / reply / replyAll / forward + BCC + draft auto-save
│   └── ui/
│       ├── MessageContextMenu.tsx   ← Right-click context menu (mark, star, move, delete)
│       ├── ThemeToggle.tsx
│       └── [shadcn components]
│
├── hooks/
│   ├── useEmailNotifications.ts     ← Browser notifications with click-to-open
│   └── useKeyboardShortcuts.ts      ← Global keyboard shortcuts (c/r/a/f/Delete/u//)
│
├── lib/
│   ├── auth.ts                      ← Auth.js config (credentials + XOAUTH2)
│   ├── db.ts                        ← PostgreSQL pool
│   ├── imap.ts                      ← imapflow wrapper (list, get, delete, move, flags, bulk, attachments)
│   ├── smtp.ts                      ← nodemailer wrapper (send + verify)
│   ├── encrypt.ts                   ← AES-256-GCM encrypt/decrypt
│   ├── msOAuth.ts                   ← Microsoft OAuth2 token refresh
│   └── utils.ts                     ← cn() + helpers
│
├── types/
│   ├── email.ts                     ← Message, Folder, Attachment, EmailAddress, Thread
│   ├── account.ts                   ← EmailAccount, Signature, User
│   └── api.ts                       ← API response types
│
├── locales/
│   ├── en.json
│   └── fr.json
│
└── docker/ → /mnt/stockage/docker/synapmail/
    ├── docker-compose.yml
    └── .env
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/accounts` | List user email accounts |
| POST | `/api/accounts` | Add email account |
| PATCH | `/api/accounts/[id]` | Update account |
| DELETE | `/api/accounts/[id]` | Remove account |
| POST | `/api/accounts/test` | Test IMAP + SMTP connection |
| GET | `/api/messages?account=&folder=&page=&filter=` | List messages (paginated) |
| GET | `/api/messages/[id]?account=&folder=` | Get full message + attachments |
| PATCH | `/api/messages/[id]?account=&folder=` | Mark read/unread or star |
| DELETE | `/api/messages/[id]?account=&folder=` | Delete message |
| **PATCH** | **`/api/messages/bulk`** | **Bulk mark read/unread or move to folder** |
| **DELETE** | **`/api/messages/bulk`** | **Bulk delete** |
| GET | `/api/messages/[id]/attachment/[partId]?account=&folder=&inline=` | Download or inline-preview |
| GET | `/api/folders?account=` | List IMAP folders |
| POST | `/api/send` | Send email (supports `forwardedAttachments`) |
| GET | `/api/search?q=&account=` | Full-text IMAP search |
| GET | `/api/profile` | Get current user |
| PATCH | `/api/profile` | Update name or password |
| GET | `/api/stream` | Server-Sent Events — new mail notify |

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `users` | App users (admin / user roles) |
| `email_accounts` | IMAP/SMTP accounts per user |
| `signatures` | Email signatures per account |
| `messages_cache` | Cached message metadata (reserved for future offline mode) |
| `user_settings` | Per-user preferences (theme, language, etc.) |

---

## Keyboard Shortcuts

| Key | Action | Condition |
|-----|--------|-----------|
| `c` | New compose | Always |
| `r` | Reply | Message open |
| `a` | Reply all | Message open |
| `f` | Forward | Message open |
| `Delete` / `#` | Delete | Message open |
| `u` | Mark as unread | Message open |
| `/` | Focus search | Always |
| `Escape` | Close compose | Compose open |

Disabled when an `<input>`, `<textarea>`, or `contenteditable` is focused.

---

## Docker

```bash
# Build & start
docker compose -f /mnt/stockage/docker/synapmail/docker-compose.yml up -d --build

# Logs
docker compose -f /mnt/stockage/docker/synapmail/docker-compose.yml logs -f

# Stop
docker compose -f /mnt/stockage/docker/synapmail/docker-compose.yml down
```

Container: `synapmail` | Port: `3500→3000`
