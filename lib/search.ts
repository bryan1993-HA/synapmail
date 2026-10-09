/**
 * Recherche de courrier — source unique du contrat, partagée par la barre
 * d'application (qui écrit), la liste des messages (qui lit) et l'API.
 *
 * L'état de la recherche vit dans l'URL de la boîte (`/mail?q=…&scope=…`) : un
 * seul champ la pilote, un rechargement la conserve, et aucun composant n'en
 * garde une copie qui pourrait diverger.
 */
import { MAIL_PATH } from './compose'
import { originKey } from './mailOrigin'

export const SEARCH_PARAM = 'q'
export const SCOPE_PARAM = 'scope'
export const SCOPE_FOLDER = 'folder'
export const SCOPE_ALL = 'all'
/** Toutes les boîtes ACCESSIBLES (propres + reçues en partage), tous dossiers. */
export const SCOPE_ACCOUNTS = 'accounts'
/**
 * Les portées, dans l'ordre où le sélecteur les propose. Source unique : l'omnibar
 * boucle dessus, l'URL en porte la valeur, la route et la liste la relisent.
 */
export const SEARCH_SCOPES = [SCOPE_FOLDER, SCOPE_ALL, SCOPE_ACCOUNTS] as const
export type SearchScope = typeof SEARCH_SCOPES[number]

/**
 * Clé i18n (espace `mail`) du libellé d'une portée. Source unique : le sélecteur
 * de l'omnibar ET l'infobulle du bandeau de résultats lisent CETTE table — elles
 * ne peuvent donc pas nommer autrement la même portée.
 */
export const SCOPE_LABEL: Record<SearchScope, 'searchThisFolder' | 'searchAllFolders' | 'searchAllAccounts'> = {
  [SCOPE_FOLDER]: 'searchThisFolder',
  [SCOPE_ALL]: 'searchAllFolders',
  [SCOPE_ACCOUNTS]: 'searchAllAccounts',
}

/**
 * Boîtes balayées EN PARALLÈLE par la portée « toutes les boîtes ». Ce plafond
 * s'ajoute à celui des dossiers par boîte (lot S2) : au pic, au plus
 * ACCOUNT_CONCURRENCY × (dossiers en parallèle) connexions IMAP ouvertes.
 * ponytail: mesuré le 20/09/2026 sur le compte de test (7 boîtes, 185 dossiers) —
 * le balayage boîte par boîte EN SÉRIE coûte 50,7 s, la boîte la plus lente 22,0 s
 * à elle seule. 3 suffit à ramener le total sous la boîte la plus lente + marge,
 * sans ouvrir 7 sessions IMAP de front chez le même hébergeur. Monter ce nombre
 * demande de re-mesurer le pic de connexions, pas seulement le temps total.
 */
export const ACCOUNT_CONCURRENCY = 3

/**
 * Temps qu'une recherche « toutes les boîtes » SANS flux s'accorde avant de rendre
 * ce qu'elle a. Le flux n'en a pas besoin : il montre ses résultats au fur et à
 * mesure et l'appelant coupe quand il veut. Une réponse d'un seul tenant, elle,
 * ne montre rien avant la fin — sans plafond, un appelant machine attendrait des
 * minutes sur une boîte de 1 226 dossiers.
 *
 * Le plafond ne fait pas MENTIR la réponse : ce qui est trouvé est rendu, et
 * `sweepCompleteness` dit qu'on s'est arrêté avant la fin et pourquoi.
 *
 * ponytail: 45 s. Calibré sur les mesures du lot S4b (compte de test, 7 boîtes,
 * 185 dossiers : premier résultat 1,8-3,6 s, balayage complet 50,7 s EN SÉRIE,
 * boîte la plus lente 22,0 s) et sur le constat de production du lot S11 (26,7 s
 * pour la seule réception d'une boîte de 163 000 messages) : assez pour couvrir
 * les deux dossiers utiles de chaque boîte et bien au-delà, moins que le délai
 * d'un mandataire inverse. Le faire varier demande de re-mesurer la COUVERTURE
 * atteinte (`searched` sur `folders`), pas seulement le temps rendu.
 */
export const ACCOUNTS_SWEEP_BUDGET_MS = 45000

/** Le balayage s'est arrêté au bout de son temps imparti. */
export const SWEEP_STOP_BUDGET = 'budget'
/** Au moins une boîte n'a pas pu être ouverte : sa part n'a pas été cherchée. */
export const SWEEP_STOP_UNREACHABLE = 'unreachable'
/**
 * Les raisons pour lesquelles un balayage peut s'arrêter avant d'avoir tout
 * couvert. Source unique : la route les rend, la doc de l'API les nomme, le banc
 * les relit — aucune des trois n'invente sa propre chaîne.
 */
export const SWEEP_STOP_REASONS = [SWEEP_STOP_BUDGET, SWEEP_STOP_UNREACHABLE] as const
export type SweepStopReason = typeof SWEEP_STOP_REASONS[number]

/** Ce qu'un balayage multi-boîtes sait de lui-même quand il rend la main. */
export type SweepProgress = {
  /** Dossiers couverts / dossiers connus des boîtes qui ont pu être ouvertes. */
  searched: number
  folders: number
  /** Boîtes ayant rapporté / boîtes accessibles à balayer. */
  sweptAccounts: number
  accounts: number
  /** Boîtes injoignables, par adresse — jamais une panne silencieuse. */
  unreachable: readonly string[]
  /** Le temps imparti a expiré avant la fin du balayage. */
  budgetExhausted: boolean
}

/**
 * Dit si un balayage a TOUT couvert, et sinon POURQUOI il s'est arrêté. C'est la
 * réponse au défaut du lot S11 : une portée « toutes les boîtes » rendait 200 avec
 * 0 résultat sans jamais dire qu'elle n'avait cherché que dans un dossier.
 *
 * Les raisons sont CUMULABLES (temps imparti ET boîte injoignable) : aucune
 * précédence n'est inventée, les deux sont rendues. Les chiffres qui les détaillent
 * (`searched`, `folders`, `accounts`, `unreachable`) voyagent déjà dans la réponse :
 * ils ne sont pas recopiés ici.
 *
 * Fonction PURE : auto-contrôle `scripts/check-search-accounts.mjs`.
 */
export function sweepCompleteness(progress: SweepProgress): { complete: boolean; reasons: SweepStopReason[] } {
  const reasons: SweepStopReason[] = []
  if (progress.budgetExhausted || progress.searched < progress.folders) reasons.push(SWEEP_STOP_BUDGET)
  // Une boîte injoignable n'a AUCUN dossier dans `folders` : sauter une boîte
  // entière se lirait sinon comme une couverture complète. C'est sa seule preuve —
  // `sweptAccounts < accounts` ne vaut pas : une boîte dont tous les dossiers sont
  // vides ne rapporte rien tout en étant entièrement couverte, et une boîte que le
  // temps imparti n'a pas atteinte est déjà dite par la raison ci-dessus.
  if (progress.unreachable.length > 0) reasons.push(SWEEP_STOP_UNREACHABLE)
  return { complete: reasons.length === 0, reasons }
}

/** En deçà, IMAP renverrait la boîte entière : la recherche reste inactive. */
export const MIN_QUERY_LENGTH = 2
/** Frappe → requête : même délai que celui de l'ancien champ de la liste. */
export const SEARCH_DEBOUNCE_MS = 400
/**
 * Nombre maximal de résultats renvoyés PAR DOSSIER interrogé. Au-delà, la réponse
 * porte le nombre total de correspondances (`total`) et l'interface le dit.
 * ponytail: 50 → 200 parce qu'une recherche d'adresse sur une vraie boîte dépasse
 * couramment 50 sans le dire ; passer au-delà demanderait une pagination de la
 * recherche (curseur sur les UID), pas un plafond plus haut.
 */
export const SEARCH_RESULT_LIMIT = 200

/**
 * Les champs interrogés par une recherche, dans l'ordre où l'interface les nomme.
 * Source unique : le serveur construit sa requête IMAP avec, l'interface dit
 * laquelle avec les mêmes clés de traduction (`searchField.<champ>`).
 *
 * Le CORPS des messages n'y est PAS, et ce n'est pas un oubli : mesuré le
 * 19/09/2026 sur IONOS (nicolas@3d-expert.fr), `BODY` comme `TEXT` renvoient 0
 * résultat en 2,5 s — et les ajouter au `OR` fait tomber le `OR` ENTIER à 0.
 * Ne rien y remettre sans l'avoir mesuré sur le serveur visé.
 */
export const SEARCH_FIELDS = ['from', 'to', 'cc', 'subject'] as const
export type SearchField = typeof SEARCH_FIELDS[number]

/** Le raccourci « / » de la boîte donne le focus au champ de la barre. */
export const SEARCH_FOCUS_EVENT = 'synapmail:focus-search'

export function focusSearch() {
  window.dispatchEvent(new CustomEvent(SEARCH_FOCUS_EVENT))
}

export function isSearchQuery(q: string | null | undefined): boolean {
  return (q?.trim().length ?? 0) >= MIN_QUERY_LENGTH
}

export function readScope(raw: string | null | undefined): SearchScope {
  return (SEARCH_SCOPES as readonly string[]).includes(raw ?? '') ? raw as SearchScope : SCOPE_FOLDER
}

/** Une portée qui sort du dossier affiché : la liste mêle alors des origines. */
export function isWideScope(scope: SearchScope): boolean {
  return scope === SCOPE_ALL || scope === SCOPE_ACCOUNTS
}

/**
 * Construit l'URL de la boîte portant la recherche, en conservant les autres
 * paramètres déjà présents (le dossier courant, notamment).
 */
export function buildSearchHref(current: string | URLSearchParams, q: string, scope: SearchScope): string {
  const params = new URLSearchParams(current)
  const trimmed = q.trim()
  if (trimmed) params.set(SEARCH_PARAM, trimmed)
  else params.delete(SEARCH_PARAM)
  if (trimmed && scope !== SCOPE_FOLDER) params.set(SCOPE_PARAM, scope)
  else params.delete(SCOPE_PARAM)
  const qs = params.toString()
  return qs ? `${MAIL_PATH}?${qs}` : MAIL_PATH
}

/**
 * Découpe une requête en TERMES, tous exigés (ET) : « 3d cpi » trouve les messages
 * où « 3d » ET « cpi » apparaissent chacun dans au moins un champ, dans n'importe
 * quel ordre — là où la version précédente cherchait la sous-chaîne « 3d cpi ».
 *
 * - une expression entre guillemets reste UNE sous-chaîne exacte : « "3d cpi" » ;
 * - espaces multiples et casse sont sans effet ;
 * - un terme de moins de MIN_QUERY_LENGTH caractères est ignoré (IMAP renverrait
 *   la boîte entière) ; entre guillemets, il est gardé tel quel s'il est non vide ;
 * - un guillemet non refermé ferme en fin de chaîne.
 *
 * Fonction PURE : aucun accès réseau, aucun état — son auto-contrôle exécutable
 * est `scripts/check-search-parse.mjs`.
 */
export function parseQuery(q: string | null | undefined): string[] {
  const terms: string[] = []
  const seen = new Set<string>()
  const add = (raw: string, quoted: boolean) => {
    const term = raw.trim()
    if (!term) return
    if (!quoted && term.length < MIN_QUERY_LENGTH) return
    const key = term.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    terms.push(term)
  }
  // Un seul balayage : on bascule à chaque guillemet entre « mots séparés par des
  // espaces » et « une seule expression ». Pas d'expression régulière à retenir.
  let buffer = ''
  let quoted = false
  for (const ch of q ?? '') {
    if (ch === '"') { add(buffer, quoted); buffer = ''; quoted = !quoted; continue }
    if (!quoted && /\s/.test(ch)) { add(buffer, false); buffer = ''; continue }
    buffer += ch
  }
  add(buffer, quoted)
  return terms
}

/**
 * Ce qu'une recherche « tous les dossiers » sait d'un dossier avant de l'ouvrir :
 * son chemin, son rôle éventuel (`\Inbox`, `\Sent`… via SPECIAL-USE), son nombre
 * de messages (LIST-STATUS, un seul aller-retour) et la date du message le plus
 * récent que le cache local en connaisse.
 */
export type FolderRank = {
  path: string
  specialUse?: string | null
  messages?: number | null
  lastKnownDate?: string | null
}

/**
 * Rôles privilégiés, dans l'ordre : ce sont les dossiers où l'on trouve ce qu'on
 * cherche neuf fois sur dix, donc ceux qu'une recherche progressive doit rendre
 * EN PREMIER pour être utile avant d'avoir tout couvert.
 */
const PRIORITY_SPECIAL_USE = ['\\Inbox', '\\Sent'] as const

/**
 * Ordonne les dossiers par UTILITÉ pour une recherche progressive : rôles
 * privilégiés d'abord (réception puis envoyés), ensuite les dossiers dont le cache
 * local connaît le message le plus récent (un dossier vivant vaut mieux qu'une
 * archive de 2019), le reste ensuite par nombre de messages décroissant, et les
 * dossiers VIDES écartés — les ouvrir coûte un aller-retour pour zéro résultat
 * possible.
 *
 * Fonction PURE : elle ne touche ni au réseau ni à la base, son auto-contrôle est
 * `scripts/check-search-order.mjs`.
 *
 * ponytail: un tri, pas un index. Tant que l'ouverture d'un dossier coûte ~300 ms
 * (mesuré sur IONOS), l'ordre suffit à rendre les premiers résultats utiles ;
 * seul un besoin mesuré de « tout, tout de suite » justifierait un index local.
 */
export function orderFoldersForSearch(folders: FolderRank[]): string[] {
  const rank = (f: FolderRank): number => {
    const special = PRIORITY_SPECIAL_USE.indexOf(f.specialUse as typeof PRIORITY_SPECIAL_USE[number])
    if (special >= 0) return special
    return PRIORITY_SPECIAL_USE.length
  }
  const freshness = (f: FolderRank): number => {
    const t = f.lastKnownDate ? Date.parse(f.lastKnownDate) : NaN
    return Number.isNaN(t) ? -Infinity : t
  }
  return folders
    // `messages` absent = inconnu, donc gardé : seul un ZÉRO mesuré écarte un dossier.
    .filter(f => f.messages !== 0)
    .slice()
    .sort((a, b) =>
      rank(a) - rank(b) ||
      freshness(b) - freshness(a) ||
      (b.messages ?? 0) - (a.messages ?? 0) ||
      a.path.localeCompare(b.path))
    .map(f => f.path)
}

/** Un dossier PRIVILÉGIÉ : réception ou envoyés, les deux de la première passe. */
function isPriorityFolder(f: FolderRank): boolean {
  return PRIORITY_SPECIAL_USE.includes(f.specialUse as typeof PRIORITY_SPECIAL_USE[number])
}

/**
 * Découpe les dossiers d'une boîte en DEUX passes, chacune déjà ordonnée par
 * `orderFoldersForSearch` : la PREMIÈRE ne contient que la réception et les
 * envoyés, la SECONDE tout le reste.
 *
 * Pourquoi deux passes : avec plusieurs boîtes, balayer une boîte ENTIÈRE avant
 * d'attaquer la suivante fait attendre la réception de la 7ᵉ boîte derrière les
 * 97 dossiers de la 4ᵉ. Mesuré le 20/09/2026 sur le compte de test (7 boîtes,
 * 185 dossiers) : le balayage complet d'une boîte va de 2,0 s à 22,0 s, alors que
 * son PREMIER résultat arrive en 1,6-2,7 s. Faire d'abord les deux dossiers
 * utiles de CHAQUE boîte rend les résultats utiles en quelques secondes même
 * avec 50 boîtes.
 *
 * Fonction PURE : auto-contrôle `scripts/check-search-accounts.mjs`.
 */
export function splitFolderPasses(folders: FolderRank[]): { first: string[]; rest: string[] } {
  const priority = new Set(folders.filter(isPriorityFolder).map(f => f.path))
  const ordered = orderFoldersForSearch(folders)
  return {
    first: ordered.filter(p => priority.has(p)),
    rest: ordered.filter(p => !priority.has(p)),
  }
}

/** Ce qu'une recherche « toutes les boîtes » sait d'une boîte avant de l'ouvrir. */
export type AccountRank = { id: string; email?: string | null }

/**
 * Ordonne les boîtes d'une recherche « toutes les boîtes » : la boîte ACTIVE
 * d'abord (celle que l'utilisateur regarde, donc celle dont il attend les
 * résultats), puis l'ordre de la liste, inchangé. Les entrées sans identifiant
 * sont écartées, les doublons aussi — une boîte balayée deux fois coûterait deux
 * sessions IMAP pour les mêmes résultats.
 *
 * Fonction PURE : auto-contrôle `scripts/check-search-accounts.mjs`.
 */
export function orderAccountsForSearch(accounts: readonly AccountRank[], activeId?: string | null): string[] {
  const ids: string[] = []
  const seen = new Set<string>()
  const push = (id: string | null | undefined) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    ids.push(id)
  }
  push(accounts.find(a => a.id === activeId)?.id)
  for (const a of accounts) push(a.id)
  return ids
}

/**
 * Entrelace plusieurs générateurs en n'en laissant que `limit` OUVERTS à la fois,
 * et rend chaque élément dès qu'il arrive — pas dans l'ordre des sources. Une
 * source n'est CRÉÉE qu'au moment où une place se libère : une boîte dont le tour
 * n'est pas venu n'ouvre aucune connexion IMAP.
 *
 * Une source qui échoue s'arrête SEULE, les autres continuent : c'est le filet de
 * sécurité, pas le chemin normal — une boîte injoignable est censée rendre son
 * propre élément d'erreur pour que le flux puisse la signaler.
 *
 * Fonction PURE au sens du banc : elle n'ouvre rien elle-même, elle ORDONNANCE ce
 * qu'on lui donne. Auto-contrôle `scripts/check-search-accounts.mjs`.
 */
export async function* mergeGenerators<T>(
  sources: readonly (() => AsyncGenerator<T>)[],
  limit: number,
): AsyncGenerator<T> {
  // Sur une liste VIDE, un plancher à 1 démarrerait `sources[0]`, qui n'existe pas.
  const width = sources.length === 0 ? 0 : Math.max(1, Math.min(limit, sources.length))
  type Slot = { gen: AsyncGenerator<T>; pending: Promise<{ index: number; done: boolean; value?: T }> }
  const active = new Map<number, Slot>()
  let next = 0
  const advance = (index: number, gen: AsyncGenerator<T>) => gen.next()
    .then(r => ({ index, done: !!r.done, value: r.value as T | undefined }))
    .catch(() => ({ index, done: true, value: undefined }))
  const start = () => {
    const index = next++
    let gen: AsyncGenerator<T>
    try { gen = sources[index]() } catch { return }
    active.set(index, { gen, pending: advance(index, gen) })
  }
  while (next < width) start()
  try {
    while (active.size) {
      // Course sur les sources OUVERTES : la première arrivée est rendue, puis sa
      // promesse est remplacée. Sans ce remplacement, une source déjà rendue
      // gagnerait toutes les courses suivantes.
      const done = await Promise.race(Array.from(active.values(), slot => slot.pending))
      const slot = active.get(done.index)
      if (!slot) continue
      if (done.done) {
        active.delete(done.index)
        if (next < sources.length) start()
        continue
      }
      slot.pending = advance(done.index, slot.gen)
      yield done.value as T
    }
  } finally {
    // Abandon (`break`, `return`, erreur du consommateur) : chaque source encore
    // ouverte est close, donc son `finally` — celui qui ferme la connexion IMAP —
    // s'exécute. Sans attendre : une source peut être au milieu d'un `SEARCH` de
    // plusieurs dizaines de secondes, et la réponse n'a pas à l'attendre pour se
    // fermer (l'abandon est déjà signalé par ailleurs).
    for (const slot of Array.from(active.values())) void slot.gen.return(undefined as never).catch(() => {})
    active.clear()
  }
}

/**
 * Paramètre par lequel le client demande la restitution PROGRESSIVE : la réponse
 * est alors une suite de lignes JSON (NDJSON), une par dossier couvert, au lieu
 * d'un seul objet livré à la fin. C'est un choix de l'appelant, clé Bearer
 * comprise : sans lui, et sous la portée « ce dossier », la réponse reste l'objet
 * JSON unique. Le contrat (`docs/openapi.json`) nomme le paramètre et le type de
 * la réponse en flux, pour qu'un client généré ne le découvre pas en plantant sur
 * `res.json()`.
 */
export const STREAM_PARAM = 'stream'
/** Ce que le flux annonce dans `Content-Type` — une seule orthographe, route et contrat. */
export const STREAM_CONTENT_TYPE = 'application/x-ndjson; charset=utf-8'

/** Une ligne de la réponse progressive : un dossier couvert, ce qu'il rapporte. */
export type SearchStreamChunk<TMessage> = {
  messages: TMessage[]
  total: number
  folder: string
  /** Dossiers couverts jusqu'ici / dossiers à couvrir — « 312 sur 1 226 ». */
  searched: number
  folders: number
  /**
   * Portée « toutes les boîtes » : la boîte d'où vient ce morceau, et le nombre
   * total de boîtes à balayer. Le bandeau en tire « 3 boîtes sur 8 ». Absents sur
   * les portées à une seule boîte, qui n'ont rien à compter.
   */
  accountId?: string
  accounts?: number
}

/**
 * Découpe un flux NDJSON en objets, en gardant la ligne incomplète d'un morceau
 * pour le suivant. Fonction PURE (elle ne lit aucun flux) : on lui passe le texte
 * reçu et le reste précédent, elle rend les objets complets et le nouveau reste.
 * Auto-contrôle : `scripts/check-search-order.mjs`.
 */
export function parseNdjsonChunk<T>(pending: string, received: string): { items: T[]; pending: string } {
  const lines = (pending + received).split('\n')
  // La dernière tranche n'est suivie d'aucun saut de ligne : elle peut être coupée.
  const rest = lines.pop() ?? ''
  const items: T[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try { items.push(JSON.parse(trimmed) as T) } catch { /* ligne tronquée par une coupure : ignorée */ }
  }
  return { items, pending: rest }
}

/** L'état accumulé d'une recherche progressive côté client. */
export type SearchStreamState<TMessage> = {
  messages: TMessage[]
  total: number
  searched: number
  folders: number
  /**
   * Boîtes ayant déjà rapporté (leurs identifiants, donc jamais deux fois la même)
   * et boîtes à balayer : « 3 boîtes sur 8 ». Vides hors portée « toutes les boîtes ».
   */
  sweptIds: string[]
  accounts: number
  /** Boîtes injoignables signalées en fin de flux — jamais une panne silencieuse. */
  unreachable: string[]
}

/**
 * Un message rendu par la recherche, réduit à ce dont l'accumulation a besoin :
 * son ORIGINE complète (sans la boîte, deux messages sans rapport se confondent)
 * et sa date, qui donne l'ordre.
 */
type StreamedMessage = { accountId?: string; folder: string; uid: number | string; date: string }

/**
 * La clé de dédoublonnage d'un résultat — l'ORIGINE, pas l'uid.
 *
 * `originKey` est la source unique de cette identité (`lib/mailOrigin.ts`) : un
 * uid n'est unique que dans un dossier d'une boîte, et la portée « toutes les
 * boîtes » mêle des boîtes qui ont toutes un « INBOX ». Sans la boîte dans la
 * clé, deux messages sans rapport se confondaient et l'un des deux disparaissait
 * de la liste sans rien dire. Une portée à une seule boîte n'annonce pas de
 * `accountId` : la clé retombe alors sur dossier+uid, ce qu'elle valait avant.
 */
function streamKey(m: StreamedMessage): string {
  return originKey({ accountId: m.accountId ?? '', folder: m.folder, uid: String(m.uid) })
}

export const EMPTY_SEARCH_STREAM: SearchStreamState<never> = {
  messages: [], total: 0, searched: 0, folders: 0, sweptIds: [], accounts: 0, unreachable: [],
}

/**
 * Ajoute à l'état courant les lignes NDJSON reçues : dédoublonne par dossier+uid
 * (un même message peut revenir si un dossier est couvert deux fois), trie du plus
 * récent au plus ancien, et PLAFONNE à `SEARCH_RESULT_LIMIT` — le même plafond que
 * les deux chemins non diffusés de la route. Sans ce plafond, une requête large
 * rendrait des milliers de lignes dans une liste non virtualisée, et `total >
 * messages.length` ne serait jamais vrai : le bandeau ne dirait jamais
 * « X premiers sur N ».
 *
 * Fonction PURE : elle ne lit aucun flux et ne mute pas l'état reçu. Auto-contrôle :
 * `scripts/check-search-order.mjs`.
 */
export function accumulateSearchStream<TMessage extends StreamedMessage>(
  prev: SearchStreamState<TMessage>,
  items: (Partial<SearchStreamChunk<TMessage>> & { error?: string; unreachable?: string[] })[]
): SearchStreamState<TMessage> {
  const seen = new Set(prev.messages.map(streamKey))
  const next = [...prev.messages]
  // Une boîte est comptée à son PREMIER morceau, jamais à chaque dossier : le
  // compteur dit combien de boîtes ont rapporté, pas combien de lignes sont arrivées.
  const swept = new Set(prev.sweptIds)
  const unreachable = [...prev.unreachable]
  let { total, searched, folders, accounts } = prev
  for (const item of items) {
    for (const email of item.unreachable ?? []) {
      if (!unreachable.includes(email)) unreachable.push(email)
    }
    if (item.error) continue
    for (const m of item.messages ?? []) {
      const key = streamKey(m)
      if (seen.has(key)) continue
      seen.add(key)
      next.push(m)
    }
    total += item.total ?? 0
    searched = Math.max(searched, item.searched ?? 0)
    folders = Math.max(folders, item.folders ?? 0)
    accounts = Math.max(accounts, item.accounts ?? 0)
    if (item.accountId) swept.add(item.accountId)
  }
  next.sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
  return {
    messages: next.slice(0, SEARCH_RESULT_LIMIT),
    total, searched, folders, accounts, unreachable,
    sweptIds: Array.from(swept),
  }
}
