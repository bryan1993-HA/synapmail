# Changelog

All notable changes to Synapmail will be documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Changed
- **Paramètres — refonte complète : coquille modale façon Gmail + design system partagé** (`components/settings/`, `app/(app)/@modal/`, `app/(app)/settings/`) :
  - Navigation douce vers `/settings` ou `/settings/<sous-page>` depuis l'app → la zone Paramètres s'ouvre en **modale par-dessus la page courante** (style Gmail / Linear). Chargement direct / rafraîchissement → page pleine classique (fallback).
  - Mécanisme : slot parallèle `app/(app)/@modal` + routes interceptrices `(.)settings` rendant `<SettingsModal>` ; `SettingsModalPanel` mappe le segment d'URL vers **le même composant feuille** que la route pleine page.
  - Design system `components/settings/primitives.tsx` (`SettingsPage` / `SettingsHeader` / `SettingsSection` / `SettingsRow` / `Toggle` / `ChoiceCards` / `Chips` / `SaveBar`) alignant toutes les pages sur le langage visuel du tableau de bord — cartes `rounded-2xl` sur `bg-card/80` + `shadow-sm` + `backdrop-blur`, accent violet, en-têtes à pastille d'icône.
  - Pages de config réécrites sur les primitives + i18n complète (`settings.nav` / `settings.common` / `settings.{reading,notifications,composition}`) : profil, apparence, lecture, notifications, composition. Sidebar restylée. Les bascules notifications / volet de lecture (ex-« Bientôt disponible ») sont désormais fonctionnelles.
  - Pages CRUD (comptes, signatures, templates, contacts, règles, IA) reprises sur le cadre `SettingsPage` + `SettingsHeader` et le style de carte partagé ; logique interne inchangée.
- **Fenêtre de composition — direction « Aurora » (verre dépoli sur aurore)** (`components/mail/ComposeModal.tsx`, `app/globals.css`) :
  - Fond : **aurore ambiante** (halos radiaux violet / fuchsia / cyan floutés, alpha ≤ 0,14) qui dérive lentement — `keyframes synap-aurora-drift`, gelé par `prefers-reduced-motion`. Elle n'apparaît que **dans la marge autour de la fenêtre**, sur un scrim `bg-background/80 backdrop-blur-lg` (arrière-plan de l'app flouté — le flou est sur le scrim, **jamais sur le panneau**, ce dernier point ayant rendu le corps illisible).
  - Panneau : **opaque** (`bg-card`, aucun `backdrop-blur`) — l'effet « verre » vient du liseré `ring-inset ring-white/25 dark:ring-white/[0.06]`, des coins `rounded-[24px]` et de la grande ombre douce. Contraste texte garanti en clair comme en sombre (pas de contenu de l'app qui transparaît).
  - Champs De / À / Objet en **pastilles encastrées** (`FIELD_ROW` : bord `border-black/10 dark:border-white/10`, `focus-within` → bord violet plein + `ring-2 ring-violet-500/40`).
  - Le sélecteur de compte **« De »** passe du `<select>` natif (menu OS blanc, hors thème) à un **menu déroulant maison** (`bg-popover`, coins arrondis, coches violettes, fermeture au clic extérieur) — même patron que le sélecteur de signature.
  - Barre d'outils / pied en bandes `bg-muted/40`, survols `hover:bg-muted`, état actif `bg-violet-500/20`.
  - Bouton **Envoyer** : pilule dégradée `from-violet-400 to-blue-400` + lueur `shadow-[0_10px_30px_-6px_rgba(139,92,246,.65)]`. Présélections de programmation en pilules.
  - Menus déroulants et sous-modales (template / variables) sur `bg-popover` opaque. Toast **Undo Send** en pilule opaque, barre de progression `from-violet-400 to-blue-400`.
  - Tout piloté par les tokens `card` / `popover` / `muted` + variantes `dark:` — accessible et cohérent dans les deux thèmes.
  - **En-tête** : pastille d'icône en verre, titre 15 px + adresse d'envoi (`fromEmail`) en sous-titre mono — supprime la répétition de l'adresse au pied.
  - **Largeur `max-w-[820px]`** (au lieu de `max-w-2xl` / 672 px) et boutons barre d'outils / pied resserrés à 28 px (`gap-0.5`, `shrink-0`) : la barre Tiptap et la rangée d'actions tiennent sur **une seule ligne**.
  - Animation d'entrée `motion-safe` (fade + zoom + slide). Accessibilité : `role="dialog"` + `aria-modal` + `aria-labelledby` + `aria-label` sur la croix. Aucun changement de comportement.

---

## [1.4.0] — 2026-09-09 — Vue Mail « Tri & focus » (Direction B)

Refonte de la présentation de la liste des messages et de l'état vide du volet de lecture,
issue de la maquette « Direction B ». Conserve le langage visuel du tableau de bord tout en
restant lisible pour le tri quotidien.

### Added
- **Regroupement par date** dans la liste — en-têtes collants « Aujourd'hui / Hier / 7 derniers jours / Ce mois-ci / mois AAAA », dérivés de la date du dernier message du fil. Désactivé en mode recherche. (`components/layout/MessageList.tsx`)
- **Bascule de densité Confort / Compact** dans la barre d'outils. Compact : lignes plus serrées, avatars réduits, ligne d'aperçu masquée. Mémorisée par navigateur (`localStorage: synapmail:mailDensity`).
- **Actions de ligne au coin haut-droit** — toujours visibles, hors du flux du sujet (l'objet et l'aperçu gardent toute la largeur) : Archiver (si un dossier d'archive est détecté), Marquer traité / non lu, Supprimer, Reporter. Remplacent les actions au survol.
- **Snooze / Reporter un message** — menu de présélections par ligne (Plus tard +3 h, Ce soir 18 h, Demain matin 8 h, Ce week-end, Semaine prochaine ; les présélections passées sont masquées). Le message disparaît de la liste et de la heuristique « À traiter » jusqu'à l'échéance, puis réapparaît.
  - Table `snoozed_messages` (`initDb`, idempotent) — `UNIQUE(account_id, folder, uid)`, index sur `snooze_until`.
  - `POST /api/messages/[id]/snooze` (UPSERT) + `DELETE …/snooze` (annuler).
  - `GET /api/snoozed?account=` — liste des reports en attente.
  - `GET /api/messages` filtre les UID reportés non échus (et corrige `total`).
  - `processSnoozes()` dans le scheduler — purge les reports échus toutes les 60 s ; le message revient à la prochaine synchro de la liste (poll 60 s).
  - **Popover « Reportés »** dans la barre d'outils (à côté des envois programmés), avec « Remettre dans la boîte ». (`components/mail/SnoozePopover.tsx`)
- **État vide du volet de lecture = liste « À traiter »** — reprend l'heuristique du tableau de bord (facture / échéance / réponse / contact clé / fréquent / suivi / pièce jointe), cliquable (ouvre le message via l'évènement `synapmail:open-message`). Légende clavier condensée en dessous.
  - `GET /api/focus?account=` — liste focus légère (une requête scoping au lieu de l'agrégation complète du dashboard).
  - `lib/focus.ts` — heuristique de scoring (`scoreFocus`, regex) extraite et partagée entre `/api/dashboard` et `/api/focus` ; `getFocusItems()` autonome (exclut les messages reportés).
- Bloc de traductions `mail.*` : `search`, `grp*`, `density*`, `archiveAction`, `markDone`, `snooze*`, `snoozed*`, `unsnooze`, `focusTitle`, `focusEmpty`, `reason_*` dans `locales/{fr,en}.json`.

### Changed
- **Liste des messages — défilement infini.** Le bouton « Charger plus » est remplacé par une sentinelle observée (`IntersectionObserver`, `rootMargin: 600px`, `root` = conteneur scrollable) qui incrémente la page automatiquement avant d'atteindre le bas. Un verrou (`loadingLockRef`) garantit une seule page en vol à la fois — l'enchaînement s'arrête quand le viewport est rempli ou que `total` est atteint. La sentinelle reste un `<button>` cliquable (repli clavier / si l'observer échoue), affiche « {count} message(s) restant(s) » ou un spinner « Chargement… », un bouton « Réessayer » si une page > 1 échoue, et « Fin de la liste » une fois tout chargé. Désactivé en mode recherche. Le verrou est réinitialisé sur changement de dossier/compte, de filtre et au rafraîchissement manuel. (`components/layout/MessageList.tsx`, clés `mail.loadingMore` / `mail.messagesRemaining` / `mail.endOfList`)
- **Lignes de la liste** — passage de `flex` à une grille `[avatar] [contenu]` avec `position: relative` pour ancrer les actions. Avatars : couleur (roue de hash) pour les non-lus, neutre `bg-muted` pour les lus. Contraste des messages lus légèrement accentué (aperçu à `text-muted-foreground/70`).
- **`/api/folders`** — le composant `MessageList` charge désormais la liste des dossiers dès qu'un compte est actif (même clé SWR que la Sidebar, donc mutualisée) pour résoudre le dossier d'archive.
- **`app/api/dashboard/route.ts`** — importe `scoreFocus` depuis `lib/focus.ts` au lieu de la copie locale (widget Focus inchangé).

### Fixed
- **`ReadingPane` — crash sur une réponse d'erreur.** Le `fetcher` ne vérifiait pas `res.ok` : un UID de cache périmé (message déplacé/expurgé depuis la dernière synchro) renvoyait `{ error }` que le composant lisait comme un message → `message.from.name` sur `undefined` → « Application error ». Le fetcher lève désormais sur `!ok` / corps `{ error }`, et un état récupérable (« impossible de charger » + Réessayer) remplace le rendu.
- **Ouverture d'un item « À traiter » dans un autre dossier.** `synapmail:open-message` transporte maintenant `folder` ; `MailClient` navigue vers ce dossier avant d'ouvrir le message (avant : le volet gardait le dossier courant et échouait).
- **`messages_cache` jamais purgé → items « À traiter » fantômes.** `listMessages` ne faisait qu'INSERT/UPDATE ; un message déplacé/supprimé depuis un autre client laissait sa ligne `is_read = false` indéfiniment (constaté : 26 « non lus » en cache pour 16 réels). Ces lignes remontaient dans la liste focus puis échouaient à l'ouverture. `listMessages` réconcilie désormais le cache d'un dossier à chaque chargement de la 1ʳᵉ page (`SEARCH ALL` UID → `DELETE` des UID absents), en tâche de fond.
- **Focus — dossiers Gmail « Tous les messages » / « Important » / « Deleted »** ajoutés à l'exclusion `NON_INBOX` de `lib/focus.ts` (un non-lu dans « All Mail » n'est plus compté en double avec sa copie dans INBOX).
- **Colonne liste — largeur fixe rognée sur écran étroit.** La colonne de la liste des messages était figée à `listWidth` px (`shrink-0`) à tous les points de rupture : sur un viewport / une fenêtre plus étroite que cette largeur, elle ne pouvait pas se réduire et son bord droit — donc les boutons d'action de coin (archiver / traité / supprimer / reporter) — était coupé par le `overflow-hidden` du `<main>`. La largeur redimensionnable ne s'applique plus qu'à partir de `lg` (comme la poignée de redimensionnement, déjà `hidden lg:block`) ; en dessous, la colonne prend `w-full`. (`app/(app)/mail/MailClient.tsx`)
- **Barre d'outils de la liste — segments rognés sur colonne étroite.** Les barres d'outils (filtre `Tous / Non lus` + densité `Confort / Compact` + icônes ; et la barre de sélection multiple) étaient sur une seule ligne `flex` non-cassable : en colonne étroite, `Non lus` et `Compact` étaient tronqués. Passage en `flex-wrap` avec `ml-auto` sur le groupe d'icônes de droite (remplace l'entretoise `flex-1`) → les contrôles passent proprement à la ligne suivante au lieu d'être coupés. (`components/layout/MessageList.tsx`)

### Notes
- Le report est purement côté application (aucun dossier IMAP « Snoozed ») : le message reste physiquement dans son dossier, seulement masqué de la liste. Visible tel quel depuis un autre client mail.
- La détection du dossier d'archive repose sur le nom/chemin (`/archives?/i`), aucun flag RFC 6154 ne survivant à `/api/folders`.

---

## [1.3.0] — 2026-09-09 — Command center dashboard

### Added
- **Tableau de bord `/dashboard`** — nouveau centre de commande en grille bento (glassmorphism, dégradé mesh ambiant, thème clair/sombre). Widgets :
  - **Bandeau KPI** — non-lus multi-comptes (+ nouveaux du jour), envoyés aujourd'hui, ouvertures suivies sur 7 j, envois programmés en attente ; compteurs animés (respectent `prefers-reduced-motion`).
  - **Focus** — 4-5 messages priorisés par heuristique (`lib`-less) : contact VIP/fréquent (table `contacts`), sujet facture/échéance/réponse, message suivi, pièce jointe. Chaque item porte une puce de raison colorée.
  - **Activité 14 jours** — courbe SVG reçus vs envoyés (aire dégradée, points de fin, delta de trafic), dérivée de `messages_cache`.
  - **Comptes** — non-lus par compte + barre de proportion, couleur du compte.
  - **Ils ont ouvert** — flux des ouvertures suivies (`sent_tracking.opened_at`, ré-ouvertures).
  - **Programmés** — timeline verticale des `scheduled_emails` en attente.
  - **Règles** — actions sur 7 j par règle (`rule_execution_log`), total + nombre de règles actives.
  - **À recontacter** — contacts importants sans échange depuis 10 j+.
  - **Écrire rapidement** — raccourcis de composition.
- **`GET /api/dashboard`** — endpoint d'agrégation unique (`Promise.all` de ~15 requêtes), forme `{ data }`. Aucune nouvelle table : lit `messages_cache`, `sent_tracking`, `scheduled_emails`, `email_rules` + `rule_execution_log`, `contacts`, `email_accounts`.
- **Préférence `start_view`** (`user_settings`, migration `ADD COLUMN IF NOT EXISTS`) — bascule "Ouvrir sur le tableau de bord" dans Réglages → Lecture. `/` redirige vers `/dashboard` ou `/mail` selon la valeur.
- **Entrée "Tableau de bord"** dans la Sidebar (modes étendu + réduit), icône `LayoutDashboard`.
- **Filtre par compte** — sélecteur « Tous les comptes ▾ » dans l'en-tête + clic sur une ligne du widget « Comptes ». `GET /api/dashboard?account=<id>` restreint tous les widgets (sauf la liste des comptes et les contacts, qui n'ont pas de dimension par compte en base). Choix mémorisé (`localStorage: synapmail:dashboardAccount`), `keepPreviousData` pour éviter le flash au changement, reset auto si le compte n'existe plus (`data.accountFilter` renvoyé par l'API).
- **Étiquette de compte** (pastille couleur + nom) sur chaque ligne Focus / Ils ont ouvert / Programmés — masquée quand le dashboard est déjà filtré sur un seul compte.
- Bloc de traductions `dashboard.*` + clé `mail.dashboard` dans `locales/{fr,en}.json`.

### Changed
- **Sidebar (barre de navigation)** — restylée pour s'accorder au tableau de bord : fond dégradé zinc + halo violet en haut, bouton « Nouveau message » en dégradé violet→bleu, états actifs `bg-violet-500/15` + liseré interne violet, badges non-lus violets, hover unifié (`white/[0.06]`). Aucun changement de structure ni de comportement. (`components/layout/Sidebar.tsx`, `components/layout/AppShell.tsx`)

### Notes
- Le dashboard reflète les données de `messages_cache` : les dossiers jamais ouverts dans l'app peuvent être sous-représentés jusqu'à leur première synchro.
- Le "Focus" est purement heuristique (pas d'appel LLM) — l'`ai_settings` n'est pas sollicité.

---

## [1.2.3] — 2026-09-09 — Sent folder sync & refresh fix

### Added
- **Sauvegarde dans Sent IMAP** — chaque email envoyé (immédiat ou programmé) est automatiquement appendé dans le dossier Envoyés du serveur IMAP via `appendToSentFolder()` (`lib/imap.ts`). Détection du dossier via flag spécial `\Sent` (RFC 6154) ou nom usuel ("Sent Items", "Sent Messages"). Compatible Stalwart, Gmail, Outlook.
- **MIME brut via MailComposer** — `sendMail()` (`lib/smtp.ts`) compile maintenant le message MIME une fois via `nodemailer/lib/mail-composer` et le retourne avec `{ messageId, raw }`, réutilisé pour l'append IMAP sans ré-encodage.

### Fixed
- **Refresh liste messages** — le bouton actualiser vidait `accumulated[]` immédiatement ; si SWR renvoyait les mêmes données (cache), l'effet ne se redéclenchait pas → liste vide. Corrigé avec un compteur `refreshKey` qui force l'effet à se relancer même si `data` n'a pas changé.
- **Crash test connexion compte** — `AccountsClient` crashait (`Cannot read properties of undefined`) quand l'API test retournait `{error}` au lieu de `{imap, smtp}`. Ajout d'une vérification de forme avant `setTestResult`.
- **TLS auto-signé IMAP/SMTP** — `tls: { rejectUnauthorized: false }` ajouté à imapflow et nodemailer pour les connexions internes Docker (Stalwart self-hosted).

---

## [1.2.2] — 2026-09-08 — Bug fixes & resilience

### Fixed — IMAP & performance
- **Pagination sans SEARCH ALL** — pour le filtre "Tous", la page de messages est maintenant dérivée directement de `mailbox.exists` (range de séquences), évitant un `SEARCH ALL` sur toute la boîte. Seuls les filtres "Non lus" et "Suivis" utilisent encore SEARCH. Gain significatif sur les grandes boîtes.
- **Détection dossiers spéciaux** — utilise désormais les attributs RFC 6154 SPECIAL-USE (`\Sent`, `\Drafts`, `\Junk`, `\Trash`) en priorité (indépendant de la langue du serveur), avec fallback par regex word-boundary. Corrige la détection sur les boîtes non-anglaises (Gmail FR, etc.)
- **Filtre `\Noselect`** — les dossiers non-sélectionnables (ex : `[Gmail]` parent) sont maintenant filtrés et n'apparaissent plus dans la sidebar

### Fixed — Sidebar
- **Suppression FALLBACK_FOLDERS** — les dossiers Outlook fictifs (`Sent Items`, `Deleted Items`, `Junk Email`…) ne sont plus affichés. Ces chemins n'existent pas sur Gmail/IMAP standard et causaient des dossiers vides trompeurs
- **Skeleton loading** — un skeleton animé (`bg-muted`) s'affiche pendant le chargement des dossiers (modes collapsed et expanded)
- **État d'erreur** — si `/api/folders` échoue, un message d'erreur explicite avec bouton Retry s'affiche au lieu d'une sidebar vide sans explication
- **Highlight dossier actif** — le surlignage dans la sidebar suit maintenant correctement le dossier sélectionné lors de la navigation (le `useEffect` sur `pathname` ne se déclenchait pas car `/mail` ne change pas entre dossiers)

### Fixed — Emails sortants (anti-spam)
- **Document HTML complet** — les emails sortants sont maintenant enveloppés dans un `<!DOCTYPE html><html>…</html>` complet, évitant le flag SpamAssassin `HTML_MIME_NO_HTML_TAG`
- **Partie text/plain** — une alternative `text/plain` est automatiquement dérivée du HTML, évitant le flag `MIME_HTML_ONLY`

### Fixed — IA Copilot
- **Strip CSS/JS des emails** — le prompt envoyé au modèle IA passe désormais par `htmlToText()` qui supprime `<style>`, `<script>`, `<head>` et décode les entités HTML avant l'envoi. Plus de CSS brut dans les résumés/traductions
- **Panel résultat scrollable** — le panneau de résultat IA a maintenant `max-h-[30vh] sm:max-h-[45vh] overflow-y-auto` pour éviter de pousser l'email hors de l'écran sur les longues traductions

### Fixed — Affichage emails (iframe)
- **Liens dans les emails** — tous les liens dans les emails s'ouvrent maintenant dans un nouvel onglet via `<base target="_blank">` injecté dans le `<head>`, avec `rel="noopener noreferrer"` sur chaque `<a>` (protection contre reverse tab-nabbing)

### Fixed — UX & hydration (mergés via PRs Pikatsuto)
- **Hydration errors** — ThemeToggle, AppShell et Sidebar utilisent le pattern SSR-safe : `useState(false/null)` + lecture `localStorage` dans `useEffect` (corrige React #418 / #423)
- **Reset liste au changement de compte** — la liste de messages est réinitialisée (page, sélection, recherche) quand le compte actif change
- **SWR global résilient** — `dedupingInterval: 5000` + `errorRetryCount: 2` : évite les tempêtes de requêtes lors de navigation rapide
- **État d'erreur MessageList** — un état d'erreur distinct avec bouton Retry s'affiche quand le chargement des messages échoue (au lieu du message "boîte vide" trompeur)
- **IMAP timeouts** — `connectionTimeout: 10s` + `greetingTimeout: 8s` : les hôtes IMAP lents ou inaccessibles échouent rapidement au lieu de bloquer la requête ~90s

### Added — Utilitaires partagés
- **`lib/html.ts`** — `htmlToText()` (strip HTML + décodage entités numériques) et `wrapHtmlDocument()`, partagés entre SMTP et l'API IA
- **`lib/email-iframe.ts`** — `buildIframeHtml()` (injection styles + `<base target="_blank">`) et `hardenIframeLinks()`, partagés entre ReadingPane et ThreadPane

---

## [1.2.1] — 2026-09-01 — GitHub repo quality

### Added
- **Community Standards** — `CODE_OF_CONDUCT.md` (Contributor Covenant v2.1), `SECURITY.md` (vulnerability reporting policy, scope, self-hosting best practices)
- **Issue templates** — structured YAML forms for bug reports and feature requests; blank issues disabled; link to private security advisory
- **Pull request template** — checklist (conventions, translations, build, ESLint, no secrets)
- **CI workflow** (`.github/workflows/ci.yml`) — ESLint + CodeQL (security-extended) run automatically on every PR and push to `main`
- **Docker workflow** (`.github/workflows/docker.yml`) — multi-arch build (`linux/amd64` + `linux/arm64`) pushed to `ghcr.io/bryan1993-ha/synapmail` on every push to `main` and on version tags; GHA layer cache
- **`docker-compose.yml`** — now pulls `ghcr.io/bryan1993-ha/synapmail:latest` by default; `build: .` kept as commented fallback for contributors
- **Branch protection** on `main` — PRs required; ESLint status check must pass before merge
- **GitHub Discussions** enabled
- **Topics** added to repo: `email-client`, `self-hosted`, `nextjs`, `imap`, `docker`, `typescript`, `ai`, `open-source`
- **README screenshots** — inline full-width images generated via Playwright with fictional data; `scripts/gen-screenshots.mjs` script for future regeneration
- **CI/Docker badges** added to README header

---

## [1.2.0] — 2026-09-01 — AI Copilot

### Added — AI Copilot (multi-provider)
- **Provider support** — Claude (Anthropic API), OpenAI-compatible endpoints, Ollama (local), Custom OpenAI-compatible base URL
- **Settings → IA Copilot** — simplified 3-step configuration: provider selection, credentials, save & test; collapsible advanced settings (system prompt, feature toggles)
- **Ollama auto-detection** — server-side scan of network interfaces derives gateway IPs dynamically; tests all candidates in parallel (`/api/ai/detect`)
- **AIToolbar in ReadingPane** — TL;DR summary, AI reply draft, translate (FR/EN); "Bientôt disponible" badges for tasks and priority scoring
- **AICompose in ComposeModal** — Améliorer button + tone selector (Formel/Décontracté/Assertif/Concis/Empathique)
- **`lib/ai.ts`** — unified multi-provider abstraction: Claude messages API, OpenAI chat completions, Ollama `/api/chat`
- **`ai_settings` DB table** — per-user provider config, encrypted API key, model, system prompt, feature flags

### Fixed
- **IMAP headers parsing** — imapflow v1 returns fetched headers as a `Buffer`, not a `Map`; calling `.get()` caused `TypeError` → 500 on all `/api/messages` requests; fixed by parsing Buffer as UTF-8 text with regex extraction

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
