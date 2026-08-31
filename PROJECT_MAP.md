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
| Change email viewer / security banner | `components/layout/ReadingPane.tsx` |
| Change attachment preview | `components/layout/ReadingPane.tsx` → `AttachmentSection` |
| Change compose (reply/replyAll/forward/BCC) | `components/mail/ComposeModal.tsx` |
| Change draft auto-save | `components/mail/ComposeModal.tsx` → `DRAFT_KEY` / localStorage |
| Change scheduled send / undo send | `components/mail/ComposeModal.tsx` |
| Change compose templates dropdown | `components/mail/ComposeModal.tsx` → LayoutTemplate section |
| Change signature logic | `components/mail/ComposeModal.tsx` → `handleSigChange` |
| Change To/Cc/Bcc autocomplete | `components/mail/EmailTokenInput.tsx` |
| Change MDN toast | `components/mail/MdnToast.tsx` |
| Change scheduled emails popover | `components/mail/ScheduledPopover.tsx` |
| Change sidebar / drag-drop / collapsible | `components/layout/Sidebar.tsx` |
| Change settings sidebar nav | `components/settings/SettingsSidebar.tsx` |
| Change rules UI | `components/settings/RulesClient.tsx` |
| Change keyboard shortcuts | `hooks/useKeyboardShortcuts.ts` |
| Change desktop notifications | `hooks/useEmailNotifications.ts` |
| Add/edit translations | `locales/en.json` + `locales/fr.json` |
| Change auth logic | `lib/auth.ts` |
| Change DB queries | `lib/db.ts` |
| Change IMAP logic | `lib/imap.ts` |
| Change SMTP / forwarded attachments | `lib/smtp.ts` + `app/api/messages/send/route.ts` |
| Change scheduled email worker | `lib/scheduler.ts` |
| Change SSE events for scheduler | `lib/schedulerEvents.ts` |
| Change rules engine | `lib/rules.ts` |
| Change contacts extraction | `lib/contacts.ts` |
| Change profile (name/password) | `app/(app)/settings/profile/page.tsx` + `app/api/profile/route.ts` |
| Change appearance settings | `app/(app)/settings/appearance/page.tsx` + `app/api/settings/route.ts` |
| Change composition settings (undo send delay) | `app/(app)/settings/composition/page.tsx` |
| Change contacts page | `app/(app)/settings/contacts/page.tsx` |
| Change notifications settings | `app/(app)/settings/notifications/page.tsx` |
| Change reading pane settings | `app/(app)/settings/reading/page.tsx` |
| Change rules settings page | `app/(app)/settings/rules/page.tsx` |
| Change templates settings page | `app/(app)/settings/templates/page.tsx` |
| Add email account (wizard) | `app/(app)/settings/accounts/AccountWizard.tsx` |
| Change account list / edit form | `app/(app)/settings/accounts/AccountsClient.tsx` |
| Add provider to wizard | `AccountWizard.tsx` → `PROVIDERS` constant |
| Bulk IMAP operations | `lib/imap.ts` → `markReadBulk`, `deleteMessagesBulk`, `moveMessagesBulk` |
| Bulk API | `app/api/messages/bulk/route.ts` |
| Pixel tracking (read receipts) | `app/api/track/[token]/route.ts` + `app/api/track/status/route.ts` |
| MDN registration | `app/api/messages/[id]/mdn/route.ts` |
| Add API route | `app/api/` |
| Change middleware | `middleware.ts` |
| Change global styles | `app/globals.css` |
| Change Docker config | `/mnt/stockage/docker/synapmail/` |
| Regenerate README screenshots | `node scripts/gen-screenshots.mjs` (requires Docker) |
| Add/edit CI pipeline | `.github/workflows/ci.yml` |
| Change Docker build/publish | `.github/workflows/docker.yml` |
| Change scheduler boot | `instrumentation.ts` |

---

## Directory Tree

```
/mnt/stockage/Web/synapmail/
│
├── CLAUDE.md              ← AI context (read first)
├── PROJECT_MAP.md         ← This file
├── README.md              ← GitHub public readme (inline screenshots, badges, ghcr.io install)
├── CHANGELOG.md           ← Release history
├── CONTRIBUTING.md        ← How to contribute (CI, branch protection, screenshots)
├── CODE_OF_CONDUCT.md     ← Contributor Covenant v2.1
├── SECURITY.md            ← Vulnerability reporting policy
├── VALIDATE.md            ← Manual test checklist
├── LICENSE                ← MIT
├── .env.example           ← Env template (no secrets)
├── instrumentation.ts     ← Next.js boot hook — starts scheduler + initDb()
├── middleware.ts          ← Auth guard + i18n routing
├── next.config.mjs        ← Next.js + withNextIntl
├── tailwind.config.ts
├── tsconfig.json
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml              ← ESLint + CodeQL on every PR / push to main
│   │   ├── docker.yml          ← Build multi-arch image + push to ghcr.io on push/tag
│   │   └── release.yml         ← Auto-generate GitHub Release from conventional commits on tag
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.yml      ← Structured bug report form
│   │   ├── feature_request.yml ← Feature suggestion form
│   │   └── config.yml          ← Disable blank issues; link to security advisory + discussions
│   └── pull_request_template.md← PR checklist (conventions, i18n, build, lint, no secrets)
│
├── docs/
│   └── screenshots/            ← README images (generated via scripts/gen-screenshots.mjs)
│       ├── inbox.png
│       ├── compose.png
│       ├── settings.png
│       ├── mobile.png
│       └── README.md           ← ⚠️ Regeneration instructions (re-run after UI changes)
│
├── scripts/
│   └── gen-screenshots.mjs     ← Playwright script: login + inject fictional data + capture
│
├── public/
│   ├── favicon.ico
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
│   ├── (app)/                        ← Protected routes (auth guard in middleware)
│   │   ├── layout.tsx                ← AppShell
│   │   ├── mail/
│   │   │   ├── page.tsx              ← Server component (auth guard + Suspense)
│   │   │   └── MailClient.tsx        ← Client: orchestrates all mail UI + keyboard shortcuts + undo send
│   │   ├── settings/
│   │   │   ├── layout.tsx            ← Settings shell: SettingsSidebar + <children>
│   │   │   ├── page.tsx              ← Settings index redirect (server component)
│   │   │   ├── accounts/
│   │   │   │   ├── page.tsx          ← Server component (passes searchParams as props)
│   │   │   │   ├── AccountsClient.tsx
│   │   │   │   ├── AccountWizard.tsx ← Multi-step wizard (provider grid → credentials → advanced)
│   │   │   │   └── ErrorBoundary.tsx
│   │   │   ├── appearance/page.tsx   ← Theme + language settings
│   │   │   ├── composition/page.tsx  ← Undo send delay
│   │   │   ├── contacts/page.tsx     ← Contact list (search, edit, delete)
│   │   │   ├── notifications/page.tsx← Desktop notification toggle
│   │   │   ├── profile/page.tsx      ← Name + password change
│   │   │   ├── reading/page.tsx      ← Reading pane default
│   │   │   ├── rules/page.tsx        ← Email rules (uses RulesClient)
│   │   │   ├── signatures/page.tsx   ← Email signatures
│   │   │   └── templates/page.tsx    ← Compose templates (Tiptap editor)
│   │   └── admin/users/page.tsx      ← Admin: user management
│   └── api/
│       ├── auth/[...nextauth]/route.ts
│       ├── accounts/
│       │   ├── route.ts              ← GET list / POST create
│       │   ├── [id]/route.ts         ← PATCH update / DELETE remove
│       │   └── test/route.ts         ← POST test IMAP+SMTP
│       ├── admin/users/
│       │   ├── route.ts              ← GET list / POST create user (admin)
│       │   └── [id]/route.ts         ← PATCH role / DELETE user (admin)
│       ├── contacts/
│       │   ├── route.ts              ← GET list+search / (auto-populated)
│       │   └── [id]/route.ts         ← PATCH name / DELETE
│       ├── folders/route.ts          ← GET IMAP folder list
│       ├── messages/
│       │   ├── route.ts              ← GET list (paginated, filtered, cached)
│       │   ├── send/route.ts         ← POST SMTP send (+ scheduled + forwarded attachments)
│       │   ├── search/route.ts       ← GET full-text IMAP search
│       │   ├── thread/route.ts       ← GET thread messages by subject
│       │   ├── bulk/route.ts         ← PATCH mark read/move + DELETE bulk
│       │   └── [id]/
│       │       ├── route.ts          ← GET full message / PATCH (read, star) / DELETE
│       │       ├── mdn/route.ts      ← POST register received MDN read receipt
│       │       └── attachment/[partId]/route.ts ← GET download or inline preview
│       ├── oauth/microsoft/
│       │   ├── route.ts              ← GET initiate OAuth2 flow
│       │   └── callback/route.ts     ← GET OAuth2 callback + token exchange
│       ├── profile/route.ts          ← GET current user / PATCH name + password
│       ├── register/route.ts         ← POST create user (when REGISTRATION_ENABLED)
│       ├── rules/
│       │   ├── route.ts              ← GET list / POST create
│       │   ├── run/route.ts          ← POST run all rules now
│       │   ├── import/route.ts       ← POST import rules JSON
│       │   ├── export/route.ts       ← GET export rules JSON
│       │   ├── sieve/route.ts        ← GET export as Sieve script
│       │   └── [id]/
│       │       ├── route.ts          ← PATCH update / DELETE
│       │       └── test/route.ts     ← POST test rule on a folder
│       ├── scheduled/
│       │   ├── route.ts              ← GET list pending scheduled emails
│       │   └── [id]/route.ts         ← DELETE cancel scheduled email
│       ├── search/route.ts           ← GET legacy search endpoint
│       ├── settings/route.ts         ← GET + PATCH user settings (UPSERT)
│       ├── signatures/
│       │   ├── route.ts              ← GET list / POST create
│       │   └── [id]/route.ts         ← PATCH update / DELETE
│       ├── stream/route.ts           ← GET Server-Sent Events (new mail + scheduler events)
│       ├── templates/
│       │   ├── route.ts              ← GET list / POST create
│       │   └── [id]/route.ts         ← PATCH update / DELETE
│       ├── track/
│       │   ├── [token]/route.ts      ← GET pixel tracker (1×1 GIF + log open)
│       │   └── status/route.ts       ← GET tracking status for a message
│       └── unsubscribe/route.ts      ← POST handle List-Unsubscribe clicks
│
├── components/
│   ├── layout/
│   │   ├── AppShell.tsx             ← Three-column shell + mobile drawer
│   │   ├── Sidebar.tsx              ← Accounts + folders + drag-drop + collapsible + unread badges
│   │   ├── MessageList.tsx          ← Email list: threads, checkboxes, bulk bar, drag source, context menu, quick actions
│   │   ├── ReadingPane.tsx          ← Email viewer: body, attachments, reply/replyAll/forward, SecurityBanner
│   │   └── ThreadPane.tsx           ← Multi-message thread view
│   ├── mail/
│   │   ├── ComposeModal.tsx         ← Compose / reply / replyAll / forward + BCC + templates + scheduled + undo send
│   │   ├── EmailTokenInput.tsx      ← To/Cc/Bcc token input with contact autocomplete
│   │   ├── MdnToast.tsx             ← 30-second toast for received read receipts (MDN)
│   │   └── ScheduledPopover.tsx     ← Popover listing pending scheduled emails with cancel
│   ├── settings/
│   │   ├── RulesClient.tsx          ← Rules page client component (form, drag-drop priority, stats)
│   │   └── SettingsSidebar.tsx      ← Settings navigation sidebar
│   ├── providers.tsx                ← React context providers (session, theme, toaster)
│   └── ui/
│       ├── MessageContextMenu.tsx   ← Right-click context menu (mark, star, move, delete)
│       ├── ThemeToggle.tsx
│       └── [shadcn components]      ← avatar, badge, button, dialog, dropdown-menu, input, label,
│                                        scroll-area, select, separator, sheet, tabs, textarea, toast, tooltip
│
├── hooks/
│   ├── useEmailNotifications.ts     ← Browser notifications: permission, display, click-to-open, settings-aware
│   └── useKeyboardShortcuts.ts      ← Global keyboard shortcuts (c/r/a/f/Delete/u/Escape//)
│
├── lib/
│   ├── accounts.ts                  ← Account helpers (get by ID, default account)
│   ├── auth.ts                      ← Auth.js config (credentials + XOAUTH2)
│   ├── contacts.ts                  ← Contact extraction + upsert logic
│   ├── db.ts                        ← PostgreSQL pool — query<T>(sql, values?)
│   ├── encrypt.ts                   ← AES-256-GCM encrypt/decrypt
│   ├── i18n.ts                      ← next-intl server config
│   ├── imap.ts                      ← imapflow wrapper (list, get, delete, move, flags, bulk, attachments)
│   ├── msOAuth.ts                   ← Microsoft OAuth2 token refresh
│   ├── routing.ts                   ← next-intl routing config
│   ├── rules.ts                     ← Rules engine: evaluate conditions, run actions, execute all
│   ├── scheduler.ts                 ← Scheduled email worker (FOR UPDATE SKIP LOCKED, 60 s interval)
│   ├── schedulerEvents.ts           ← SSE event emitter for scheduler (scheduled_sent)
│   ├── smtp.ts                      ← nodemailer wrapper (send + verify)
│   └── utils.ts                     ← cn() + helpers
│
├── types/
│   ├── contact.ts                   ← Contact interface
│   ├── email.ts                     ← Message, Folder, Attachment, EmailAddress, Thread
│   ├── account.ts                   ← EmailAccount, Signature, User
│   ├── api.ts                       ← API response types
│   ├── rule.ts                      ← Rule, RuleCondition, RuleAction interfaces
│   └── template.ts                  ← ComposeTemplate interface
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

### Accounts
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/accounts` | List user email accounts |
| POST | `/api/accounts` | Add email account |
| PATCH | `/api/accounts/[id]` | Update account |
| DELETE | `/api/accounts/[id]` | Remove account |
| POST | `/api/accounts/test` | Test IMAP + SMTP connection |

### Messages
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/messages?account=&folder=&page=&filter=` | List messages (paginated, cached) |
| GET | `/api/messages/[id]?account=&folder=` | Get full message + attachments |
| PATCH | `/api/messages/[id]` | Mark read/unread or star |
| DELETE | `/api/messages/[id]` | Delete message |
| PATCH | `/api/messages/bulk` | Bulk mark read/unread or move |
| DELETE | `/api/messages/bulk` | Bulk delete |
| GET | `/api/messages/[id]/attachment/[partId]?inline=` | Download or inline-preview attachment |
| POST | `/api/messages/[id]/mdn` | Register received MDN (read receipt) |
| GET | `/api/messages/search?q=&account=` | Full-text IMAP search |
| GET | `/api/messages/thread?subject=&account=` | Thread messages by normalized subject |
| POST | `/api/messages/send` | Send email (immediate or scheduled, forwarded attachments) |

### Folders & Stream
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/folders?account=` | List IMAP folders |
| GET | `/api/stream` | Server-Sent Events (new mail + scheduled_sent) |

### Scheduled
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/scheduled` | List pending scheduled emails |
| DELETE | `/api/scheduled/[id]` | Cancel scheduled email |

### Contacts
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/contacts?account=&q=` | List / search contacts |
| PATCH | `/api/contacts/[id]` | Update contact name |
| DELETE | `/api/contacts/[id]` | Delete contact |

### Rules
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/rules?account=` | List rules |
| POST | `/api/rules` | Create rule |
| PATCH | `/api/rules/[id]` | Update rule |
| DELETE | `/api/rules/[id]` | Delete rule |
| POST | `/api/rules/[id]/test` | Test rule on a folder |
| POST | `/api/rules/run` | Run all rules now |
| GET | `/api/rules/export` | Export rules as JSON |
| POST | `/api/rules/import` | Import rules from JSON |
| GET | `/api/rules/sieve` | Export as Sieve script |

### Templates
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/templates?account=` | List compose templates |
| POST | `/api/templates` | Create template |
| PATCH | `/api/templates/[id]` | Update template |
| DELETE | `/api/templates/[id]` | Delete template |

### Settings & Profile
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/settings` | Get user settings |
| PATCH | `/api/settings` | Update settings (UPSERT) |
| GET | `/api/profile` | Get current user |
| PATCH | `/api/profile` | Update name or password |

### Tracking
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/track/[token]` | Read receipt pixel (1×1 GIF + DB log) |
| GET | `/api/track/status?messageId=` | Tracking status for a sent message |
| POST | `/api/unsubscribe` | Handle List-Unsubscribe |

---

## Database Tables

| Table | Purpose |
|-------|---------|
| `users` | App users (admin / user roles) |
| `email_accounts` | IMAP/SMTP accounts per user |
| `signatures` | Rich-text signatures per account |
| `messages_cache` | Cached message metadata (fast list + unread badges) |
| `user_settings` | Per-user preferences (theme, language, notifications, undo_send_delay…) |
| `scheduled_emails` | Emails queued for future delivery (status: pending/sent/failed) |
| `sent_tracking` | Read receipt tracking tokens + open timestamps |
| `email_rules` | User-defined filter rules with conditions + actions |
| `rule_execution_log` | Per-rule execution history (uid, action, timestamp) |
| `compose_templates` | Saved email templates with `{{variable}}` support |
| `contacts` | Auto-extracted contacts per account (name, email, frequency) |

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
docker compose -f /mnt/stockage/docker/synapmail/docker-compose.yml logs -f synapmail

# Stop
docker compose -f /mnt/stockage/docker/synapmail/docker-compose.yml down
```

Container: `synapmail` | Port: `3500→3000`

---

## Custom Events (cross-component communication)

| Event | Emitter | Listener | Payload |
|-------|---------|----------|---------|
| `synapmail:account-change` | Account switcher (Sidebar) | Sidebar, MailClient | `{ accountId }` |
| `synapmail:compose` | Header compose button | ComposeModal | — |
| `synapmail:open-message` | Notification click | MailClient | `{ uid, accountId, folder }` |
