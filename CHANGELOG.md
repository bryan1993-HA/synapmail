# Changelog

All notable changes to Synapmail will be documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [2026-08-25] — Brand identity integration

### Added
- **Brand kit** — complete asset set in `public/brand/` (SVG, PNG, animated)
  - `svg/` — icone, icone-negatif, icone-mono, logo-horizontal, logo-vertical, variantes mono/négatif
  - `png/` — favicon@64, icone@512, icone@1024, horizontal@2400, vertical@1600, variantes mono/négatif
  - `anime/` — `synapmail-anime.svg` (logo animé)
- **Favicon & apple-touch-icon** — `app/layout.tsx` metadata pointe vers `synapmail-favicon@64.png` et `synapmail-icone@512.png`
- **Logo animé sur les pages auth** — login et register affichent `synapmail-anime.svg` à la place de l'icône Mail générique
- **Logo dans la sidebar** — `synapmail-icone-negatif.svg` (version blanche) remplace le carré bleu + icône Mail
- **Logo dans la mobile top bar** — `synapmail-icone.svg` (couleur) dans `AppShell`
- **README mis à jour** — logo horizontal centré en tête du README GitHub + badges réalignés

## [2026-08-24] — Drag & drop, context menu, keyboard shortcuts, notifications, draft auto-save

### Added
- **Drag & drop** — any email row in `MessageList` is now draggable (`draggable` + HTML5 dataTransfer); dropping onto a folder in `Sidebar` moves the message(s) via `/api/messages/bulk`; the drop target folder highlights with a blue ring during drag-over; if messages are checked (bulk selection), dragging any of them moves the whole checked set
- **Right-click context menu** (`MessageContextMenu`) — right-clicking any message row shows a contextual menu:
  - Mark as read / Mark as unread
  - Star / Unstar
  - Move to → (hover submenu listing all folders)
  - Delete (red)
  - Menu auto-closes on click outside or `Escape`; position clamped to viewport
- **Keyboard shortcuts** (`useKeyboardShortcuts` hook) — global `keydown` listener, skips when an input/textarea/contenteditable is focused:
  - `c` → new compose
  - `r` → reply to current message
  - `a` → reply all
  - `f` → forward
  - `Delete` / `#` → delete current message
  - `u` → mark current message as unread
  - `/` → focus search bar
  - `Escape` → close compose window
- **Desktop notifications — click to open** — clicking a browser notification now dispatches `synapmail:open-message` which `MailClient` listens to and opens the message directly; sender name used as notification title; preview text shown in body; `tag` prevents duplicate notifications for the same UID
- **Draft auto-save** (`compose` mode only) — `ComposeModal` auto-saves To/Cc/Bcc/Subject/body to `localStorage` (`synapmail:draft:<accountId>`) 3 seconds after the last change; on next open, draft is restored with a "Brouillon restauré ×" badge in the title bar; draft is cleared on Send, Cancel, or manual dismiss of the badge
- **ReadingPane — To/Cc recipients** visible below sender name in message header

### Internal
- `ReadingPane` gains `onMessageLoaded` prop — called when full message loads; used by `MailClient` to track `currentMessage` for keyboard shortcuts
- `MailClient` exposes `searchInputRef` to `MessageList` for the `/` shortcut

## [2026-08-24] — Bulk message actions + enhanced compose

### Added
- **Bulk actions in message list** — hover over the avatar of any email to reveal a checkbox; selecting one or more messages replaces the filter bar with a bulk action toolbar:
  - Mark as read / unread (MailOpen / Mail icons)
  - Move to folder (dropdown fetched from `/api/folders?account=<id>`)
  - Delete (red trash, with optimistic list update)
  - Select all / deselect all on current page
  - Clear selection (×)
  - Clicking any row while in selection mode toggles that row's checkbox instead of opening the message
- **Reply All** — new `replyAll` mode in `ComposeModal`; pre-fills *To* with the original sender, *Cc* with all other recipients (To + Cc minus own email), and auto-expands the Cc field; button added to `ReadingPane` action bar
- **BCC / Cci field** — compose now has a *Cci* toggle button (alongside *Cc*); field appears/hides with a × button; value sent to `/api/send` as `bcc`
- **Forward with attachments** — when forwarding a message that has attachments, all attachments are pre-listed in the compose window as removable chips; on send, the selected attachments are re-fetched from IMAP server-side and included in the outgoing email via nodemailer
- **To/CC recipients visible in ReadingPane** — message header now shows *À :* and *Cc :* lines below the sender address

### Changed
- `ComposeModal` — mode type extended to `'compose' | 'reply' | 'replyAll' | 'forward'`; Cc field now has a close button
- `ReadingPane` — new `onReplyAll` prop; shows To + Cc in header

### API
- **`POST /api/messages/bulk` (PATCH)** — bulk mark read/unread or move; body: `{ uids, action, accountId, folder, destination? }`
- **`DELETE /api/messages/bulk`** — bulk delete; body: `{ uids, accountId, folder }`
- **`POST /api/send`** — now accepts `forwardedAttachments: { uid, accountId, folder, partIdx, filename, contentType }[]`; fetches each attachment from IMAP and attaches to outgoing email

### Internal
- `lib/imap.ts` — added `markReadBulk`, `deleteMessagesBulk`, `moveMessagesBulk`, `getAttachmentContent`; `getMessage` now also parses and returns `cc` field

## [2026-08-24] — Sidebar: folder list reactive per account

### Fixed
- **Sidebar — dossiers non réactifs au changement de compte** : la liste des dossiers restait celle du compte par défaut même après avoir basculé vers un autre compte
  - `activeAccountId` est désormais un state React (initialisé depuis `localStorage`, mis à jour via l'event `synapmail:account-change`)
  - La clé SWR devient `/api/folders?account=<id>` — chaque compte a son propre cache de dossiers
  - Un `useEffect` écoute `synapmail:account-change` pour mettre à jour le state et déclencher le re-fetch automatique

## [2026-08-24] — Account wizard & bug fixes

### Added
- **Account setup wizard** — multi-step wizard (`AccountWizard.tsx`) replacing the raw form for adding email accounts
  - Step 1: visual provider grid (auto-fit, fills full page width) — Gmail, Outlook/Hotmail, Yahoo, iCloud, Proton Mail, OVH/Orange/Free, custom
  - Step 2: credentials (email + password) for known providers — IMAP/SMTP auto-filled
  - Step 3: manual server config (IMAP host/port + SMTP host/port) for ISP/custom accounts
  - Auto-detects provider from typed email domain on blur
  - Inline connection test (IMAP + SMTP) before saving
  - App-password warning banners for Gmail, Yahoo, iCloud
  - Proton Mail auto-fills Bridge localhost ports (1143/1025)
  - Brand SVG logos: Gmail (multicolor envelope), Outlook (blue envelope), Yahoo (purple Y!), iCloud (cloud), Proton Mail (purple P), France flag (OVH/ISP), gear (custom)
- **`AccountsClient.tsx`** — extracted client component; separates list / add (wizard) / edit (classic form) modes; fixes SWR cache-key conflict with Sidebar
- **`ErrorBoundary.tsx`** — React class error boundary wrapping the accounts page for diagnostic output

### Fixed
- **`useSearchParams()` without Suspense** — crashed `/settings/accounts`, `/mail`, and every page using `Sidebar`
  - `app/(app)/settings/accounts/page.tsx` converted to server component; `searchParams` passed as props
  - `app/(app)/mail/page.tsx` wraps `<MailClient>` in `<Suspense>`
  - `Sidebar.tsx` replaces `useSearchParams()` with `useEffect + window.location.search`
- **`g.map is not a function`** — SWR cache conflict: `Sidebar` and old `AccountsClient` shared key `/api/accounts` with different fetchers; fixed by aligning fetcher signatures (return full response, extract `.data` locally)
- **Settings page in English** — `app/(app)/settings/page.tsx` was a hardcoded English client component; rewritten as async server component using `getTranslations()`

## [2026-08-24] — UI/UX

### Changed
- **MessageList — indicateur non-lu** : le dot bleu flottant a été remplacé par une bordure gauche colorée (`border-l-[3px] border-l-primary`), cohérent avec le pattern sélection active
- **MessageList — badge thread** : le badge de comptage (ex: "2") passe en `bg-primary text-white font-bold` pour être lisible sur l'avatar coloré
- **MessageList — focus clavier** : ajout de `focus-visible:ring-2 focus-visible:ring-ring` sur chaque ligne pour l'accessibilité clavier
- **MessageList — transitions** : `transition-all` remplacé par `transition-colors duration-150` (flat design, plus performant)
- **MessageList — preview** : taille `text-[11px]` pour distinguer visuellement le sujet et le preview

### Tooling
- Installation du skill [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) dans `.claude/skills/` — design system generator + 192 règles UX/accessibilité

## [2026-08-24]

### Added
- **Attachment inline preview** — images display as clickable thumbnails (lightbox), PDFs open in a native browser iframe viewer; no download required; download button still available in modal
- **Paperclip indicator in message list** — icon next to the date for threads with attachments; blue on unread, grey on read
- **Profile settings page** — `/settings/profile` with name edit and password change; backed by `app/api/profile/route.ts` (GET + PATCH)

### Fixed
- `/settings/profile` returning 404 — page and API route were missing entirely
- ComposeModal signature switcher: "Sans signature" did not remove the current signature, and switching back doubled it — root cause was `indexOf('<p>-- </p>')` failing due to Tiptap whitespace normalization; replaced with regex `/<p[^>]*>--\s*<\/p>/`
- Attachment detection in message list always returned `false` — imapflow exposes `disposition` as a plain string, not an object; also added `parameters.name` fallback for servers that omit `Content-Disposition`
- Attachment API: added `?inline=true` query param that switches `Content-Disposition` from `attachment` to `inline` so the browser can display content natively

### Added (initial release)
- Initial project setup (Next.js 14, TypeScript, Tailwind CSS, shadcn/ui)
- Three-column layout (Sidebar / MessageList / ReadingPane)
- Auth.js v5 multi-user authentication (credentials provider + Microsoft OAuth2)
- PostgreSQL database schema (users, email_accounts, signatures, messages_cache, user_settings)
- IMAP integration via imapflow (basic auth + XOAUTH2 for Microsoft/Google)
- SMTP integration via nodemailer (basic auth + OAuth2)
- Tiptap rich editor for email composition (bold, italic, underline, strikethrough, alignment, lists, link, blockquote, code, headings, HR)
- next-intl internationalization (English + French)
- Docker deployment configuration
- MIT License
- REST API (accounts, messages, folders, send, search, thread, attachments, signatures, admin)
- Dark/Light/System theme with ThemeToggle
- Fully responsive layout (mobile overlay sidebar + hamburger, desktop three-column)
- **Search** — IMAP search by sender, subject, content with debounce
- **Attachments** — download endpoint + attachment UI in reading pane (mailparser)
- **Thread view** — client-side conversation grouping by normalized subject, expandable cards (Gmail-style)
- **Signatures** — per-user rich-text signatures, auto-insert on compose, dropdown selector
- **Browser notifications** — permission request + new mail alert via SWR polling
- **Admin panel** — `/admin/users` CRUD: list users, toggle role, delete, create
- **Multi-account** — account switcher in sidebar (localStorage persistence + custom events)
- **Microsoft OAuth2 IMAP/SMTP** — personal Live/Outlook accounts via XOAUTH2 (tenant: consumers)
