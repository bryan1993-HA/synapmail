# Changelog

All notable changes to Synapmail will be documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

- t4 — Snooze messages (postpone email to a chosen date/time)

---

## [2026-08-31] — V2 complete: security, read receipts, contacts, rules, templates

### Added — Security (t19, t20)
- **Phishing detection** — parses `Authentication-Results` header (SPF / DKIM / DMARC pass/fail/missing); displays a color-coded `SecurityBanner` in ReadingPane (green = all pass, orange = missing, red = fail or spoofing); sender address highlighted in red + "(unofficial domain)" label when spoofing is detected
- **Display-name spoofing detection** — 30+ brands (Amazon, PayPal, Google, Apple, Microsoft, Netflix, Meta, banks…) matched via keyword multi-alias; Reply-To mismatch also flagged
- **Lookalike domain detection** — pure-JS Levenshtein distance against brand canonical domains (catches `amaz0n.com`, `arnazon.com`, `g00gle.com`…)
- **Deceptive link detection** — parses email HTML body before render; warns when visible link text says one domain but `href` resolves to a different one
- **Dangerous attachment warning** — red badge on `.exe`, `.scr`, `.vbs`, `.bat`, `.js`, `.jar`, `.ps1` attachments
- **Urgency keyword detection** — subject-line badge for words like URGENT, suspended account, immediate refund (multilingual EN + FR)

### Added — Read Receipts (t15)
- **Outgoing pixel tracking** — 1×1 transparent GIF injected into sent emails; `/api/track/[token]` logs the open event with timestamp; opt-in toggle in ComposeModal (unchecked by default)
- **MDN header** — `Disposition-Notification-To` added to outgoing emails when tracking is enabled (RFC 8098); compatible clients reply with a read receipt email
- **MDN toast** — `MdnToast` component displays a 30-second toast when an MDN response email is received; matched by subject + account (handles Outlook message-ID rewriting)
- **Eye icon in Sent list** — messages with confirmed opens show an eye icon + open timestamp
- **`/api/track/[token]`** — pixel endpoint (returns 1×1 GIF, logs open), `/api/track/status` returns tracking state for a message, `/api/messages/[id]/mdn` registers received MDN events

### Added — Contacts (t3)
- **Auto-extracted contacts** — email addresses harvested from incoming and outgoing messages via PostgreSQL `xmax` pattern (one insert per unique address per message); noreply blocklist (EN + FR) applied
- **Contact autocomplete** — `EmailTokenInput` component in ComposeModal replaces bare text fields for To/Cc/Bcc; typeahead dropdown, keyboard navigation (↑↓ Enter), token chips with ×
- **Settings → Contacts** — full contact list with search, edit (name), delete; `/api/contacts` CRUD

### Added — Rules / Filters (t5)
- **Full rules engine** — `lib/rules.ts` evaluates multi-condition rules against messages; conditions: `from`, `to`, `subject`, `body`, `has_attachment`, `size_gt`, `size_lt`, `is_unsubscribe`, `is_priority`; logical AND/OR; actions: `move`, `mark_read`, `star`, `delete`, `forward`
- **Auto-run every 5 min** — scheduler calls `runAllRules()` for each account
- **Settings → Rules** — `RulesClient` component: create/edit rules via multi-step form, drag-and-drop priority reordering, enable/disable toggle, per-rule execution stats, "Test on folder" button
- **"Create rule from message"** — button in ReadingPane opens Rules page pre-filled with sender
- **JSON import/export** — `/api/rules/import` and `/api/rules/export`
- **Sieve export** — `/api/rules/sieve` generates a Sieve script for external mail servers
- **Execution log** — `rule_execution_log` table tracks runs (rule_id, message_uid, action, executed_at)

### Added — Compose Templates (t6)
- **Template library** — `compose_templates` DB table; CRUD via `/api/templates`
- **Settings → Templates** — Tiptap editor for template body, `{{variable}}` badge preview, name/subject fields
- **ComposeModal integration** — `LayoutTemplate` icon in footer opens a dropdown (bottom-full, avoids toolbar overflow-hidden clipping); selecting a template loads subject + body; variables resolved via inline modal form before inserting
- **Save as template** — `BookmarkPlus` button saves the current compose content as a new template

---

## [2026-08-30] — Undo Send, Settings refactor, phishing foundation

### Added — Undo Send (t14)
- **Countdown toast** — "Sending in Xs… Cancel" banner (no backdrop); app fully usable during countdown; only active for immediate sends (not scheduled)
- **Cancel** — clears `setTimeout`, modal reopens with original content intact
- **Delay configuration** — Settings → Composition: select Disabled / 5 s / 10 s / 30 s; persisted via `/api/settings`

### Added — Settings refactor (t16)
- **Settings sidebar navigation** — `SettingsSidebar` component; 8 pages: Profile, Appearance, Reading, Notifications, Composition, Email Accounts, Signatures, (Rules, Templates, Contacts)
- **Settings layout** — `app/(app)/settings/layout.tsx` server component wrapping all settings pages
- **Appearance page** — theme (dark/light/system) + language (EN/FR) with live preview; changes write a locale cookie and reload the page
- **Reading page** — reading pane default on/off
- **Notifications page** — desktop notification toggle
- **Composition page** — undo send delay selector
- **`/api/settings`** — GET + PATCH with DB UPSERT; `user_settings` table stores theme, language, messages_per_page, thread_view, reading_pane, notifications, undo_send_delay
- **`initDb()`** — called from `instrumentation.ts` on server boot to ensure all DB tables exist

### Fixed — Settings wiring (t17, t18)
- **reading_pane → MailClient** — SWR `/api/settings` in MailClient; `settingsPaneInitialized` ref ensures the DB value sets the initial state without overriding subsequent user interactions
- **notifications → useEmailNotifications** — SWR `/api/settings` (deduplicated cache key); `notificationsEnabled` gates both permission request and notification creation; notification icon updated to `/brand/png/synapmail-favicon@64.png`

---

## [2026-08-29] — Scheduler robustness, scheduled emails view

### Added — Scheduler robustness (t12)
- **`instrumentation.ts`** — Next.js 14 `experimentalInstrumentationHook`; scheduler starts at process boot, independent of any active user session or SSE connection
- **`lib/schedulerEvents.ts`** — emits `scheduled_sent` SSE events when a scheduled email is delivered; consumed by MailClient to refresh the scheduled popover

### Added — Scheduled emails view (t11)
- **`ScheduledPopover`** — clock icon + badge in MessageList toolbar showing the count of pending scheduled emails; popover lists them with from/to/subject/scheduled-date; hover reveals a × cancel button
- **SWR 60 s refresh** + automatic refresh on `scheduled_sent` SSE event
- **Cancel endpoint** — `DELETE /api/scheduled/[id]` removes the pending send from DB

---

## [2026-08-27] — Scheduled send, UI polish

### Added — Scheduled send (t1)
- **Date/time picker in ComposeModal** — calendar + time input in a Popover; relative shortcuts (In 1 hour, Tomorrow morning, Monday morning)
- **`scheduled_emails` DB table** — stores sender, recipient, subject, body, attachments, account_id, scheduled_at, status (pending/sent/failed)
- **`/api/scheduled`** GET (list pending) + `DELETE /api/scheduled/[id]` (cancel)
- **`/api/messages/send`** — when `scheduledAt` is provided, saves to `scheduled_emails` instead of sending immediately
- **`lib/scheduler.ts`** — atomic worker using `FOR UPDATE SKIP LOCKED`; runs every 60 s; sends due emails via SMTP, marks as sent, emits SSE event

### Added — UI polish (t13)
- **Collapsible sidebar** — icon-only mode (`w-14`) ↔ full mode (`w-64`); toggle button at bottom; state persisted in localStorage; folder labels and account names hidden in collapsed mode, tooltips shown on hover
- **Resizable columns** — drag handle between MessageList and ReadingPane; width clamped 240–600 px; persisted in localStorage
- **Hover quick actions on message rows** — reply, archive, delete buttons appear on row hover; no selection required
- **Unread badges in sidebar** — folder names show unread count from `messages_cache`
- **Redesigned empty state** — illustration + contextual message per folder (Inbox, Sent, Drafts…)
- **ComposeModal polish** — backdrop blur, blue header bar, toolbar follows active theme, signature dropdown uses custom shadcn Select

---

## [2026-08-25] — Brand identity integration

### Added
- **Brand kit** — complete asset set in `public/brand/` (SVG, PNG, animated)
  - `svg/` — icone, icone-negatif, icone-mono, logo-horizontal, logo-vertical, variantes mono/négatif
  - `png/` — favicon@64, icone@512, icone@1024, horizontal@2400, vertical@1600, variantes mono/négatif
  - `anime/` — `synapmail-anime.svg` (logo animé)
- **Favicon & apple-touch-icon** — `app/layout.tsx` metadata points to `synapmail-favicon@64.png` and `synapmail-icone@512.png`
- **Animated logo on auth pages** — login and register display `synapmail-anime.svg` replacing the generic Mail icon
- **Logo in sidebar** — `synapmail-icone-negatif.svg` (white) replaces the blue square + Mail icon
- **Logo in mobile top bar** — `synapmail-icone.svg` (color) in `AppShell`
- **README updated** — centered horizontal logo in README header + realigned badges

---

## [2026-08-24] — Drag & drop, context menu, keyboard shortcuts, notifications, draft auto-save

### Added
- **Drag & drop** — email rows in `MessageList` are draggable (HTML5 dataTransfer); dropping onto a sidebar folder moves message(s) via `/api/messages/bulk`; drop target highlights with a blue ring; checked messages drag as a set
- **Right-click context menu** (`MessageContextMenu`) — mark read/unread, star/unstar, move to folder (hover submenu), delete; auto-closes on click outside or `Escape`; position clamped to viewport
- **Keyboard shortcuts** (`useKeyboardShortcuts`) — `c` compose, `r` reply, `a` reply all, `f` forward, `Delete`/`#` delete, `u` mark unread, `/` focus search, `Escape` close compose; disabled when input/textarea/contenteditable focused
- **Desktop notifications — click to open** — clicking a notification dispatches `synapmail:open-message`; `MailClient` listens and opens the message directly
- **Draft auto-save** — compose mode only; saves To/Cc/Bcc/Subject/body to localStorage (`synapmail:draft:<accountId>`) 3 s after last change; restored on next open with "Brouillon restauré ×" badge; cleared on Send, Cancel, or badge dismiss
- **ReadingPane — To/Cc recipients** visible below sender name

### Internal
- `ReadingPane` → `onMessageLoaded` prop (used by `MailClient` to track `currentMessage` for shortcuts)
- `MailClient` exposes `searchInputRef` to `MessageList` for the `/` shortcut

---

## [2026-08-24] — Bulk actions + enhanced compose

### Added
- **Bulk actions** — checkbox on avatar hover; bulk toolbar: mark read/unread, move to folder, delete, select all; optimistic list update
- **Reply All** — pre-fills To (original sender) + Cc (all others minus own address); new button in ReadingPane
- **BCC field** — toggle `Cci` button; field dismissible with ×; value sent to `/api/send`
- **Forward with attachments** — attachments pre-listed as removable chips; re-fetched from IMAP server-side via `getAttachmentContent`

### API
- `PATCH /api/messages/bulk` — mark read/unread or move; body: `{ uids, action, accountId, folder, destination? }`
- `DELETE /api/messages/bulk` — bulk delete
- `POST /api/send` — accepts `forwardedAttachments: { uid, accountId, folder, partIdx, filename, contentType }[]`

### Internal
- `lib/imap.ts` — added `markReadBulk`, `deleteMessagesBulk`, `moveMessagesBulk`, `getAttachmentContent`; `getMessage` now returns `cc` field

---

## [2026-08-24] — Sidebar: reactive folder list per account

### Fixed
- **Sidebar folders not updating on account switch** — `activeAccountId` is now React state (initialized from localStorage, updated via `synapmail:account-change` event); SWR key per account `/api/folders?account=<id>`; `useEffect` drives automatic re-fetch

---

## [2026-08-24] — Account wizard & bug fixes

### Added
- **Account setup wizard** (`AccountWizard.tsx`) — Step 1: visual provider grid (Gmail, Outlook, Yahoo, iCloud, Proton Mail, OVH/ISP, custom); Step 2: credentials with auto-fill + connection test + app-password banners; Step 3: manual IMAP/SMTP config; auto-detects provider on email blur; brand SVG logos per provider
- **`AccountsClient.tsx`** — extracted client component; list / add (wizard) / edit modes; fixes SWR cache-key conflict
- **`ErrorBoundary.tsx`** — React class error boundary for accounts page

### Fixed
- `useSearchParams()` without Suspense — crashed `/settings/accounts`, `/mail`, Sidebar; fixed via server component + props pattern and `useEffect + window.location.search`
- `g.map is not a function` — SWR cache conflict between Sidebar and AccountsClient; fixed by aligning fetcher signatures
- Settings page English hardcoding — rewritten as async server component using `getTranslations()`

---

## [2026-08-24] — UI/UX

### Changed
- MessageList unread indicator: blue dot → left border (`border-l-[3px] border-l-primary`)
- Thread count badge: `bg-primary text-white font-bold`
- Keyboard focus visible rings on message rows
- `transition-all` → `transition-colors duration-150`
- Preview text: `text-[11px]` for visual hierarchy

---

## [2026-08-24] — Initial release

### Added
- **Core email client** — three-column layout (Sidebar / MessageList / ReadingPane), fully responsive
- **Auth.js v5** — multi-user credentials provider + Microsoft OAuth2 (XOAUTH2)
- **PostgreSQL schema** — users, email_accounts, signatures, messages_cache, user_settings
- **IMAP** via imapflow (basic auth + XOAUTH2)
- **SMTP** via nodemailer
- **Tiptap rich editor** — bold, italic, underline, strikethrough, alignment, lists, link, blockquote, code, headings, HR
- **next-intl** — English + French
- **Docker** deployment configuration
- **Thread view** — client-side conversation grouping by normalized subject
- **Signatures** — per-user rich-text signatures, auto-insert, dropdown selector
- **Attachment inline preview** — images lightbox, PDFs native iframe
- **Paperclip indicator** in message list
- **Profile settings** page (`/settings/profile`) — name + password change
- **Browser notifications** — permission request + new mail alert via SSE
- **Admin panel** — `/admin/users` CRUD: list, role toggle, delete, create
- **Multi-account** — account switcher in sidebar (localStorage + custom events)
- **Search** — IMAP full-text search with debounce
- **MIT License**
