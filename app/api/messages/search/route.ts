import { NextResponse } from 'next/server'
import { authorize } from '@/lib/apiAuth'
import { query } from '@/lib/db'
import { getAccessibleAccount, listAccessibleAccounts } from '@/lib/accountAccess'
import type { DbEmailAccount } from '@/lib/accounts'
import type { Message } from '@/types/email'
import { listFolderPasses, listFoldersRanked, searchMessagesByFolder, searchMessagesIn } from '@/lib/imap'
import { guardApiPayload, isMachineRequest } from '@/lib/promptGuard'
import {
  ACCOUNT_CONCURRENCY, ACCOUNTS_SWEEP_BUDGET_MS, EMPTY_SEARCH_STREAM, MIN_QUERY_LENGTH,
  SCOPE_ACCOUNTS, SCOPE_ALL, SCOPE_PARAM, SEARCH_FIELDS, SEARCH_PARAM, SEARCH_RESULT_LIMIT,
  STREAM_CONTENT_TYPE, STREAM_PARAM, accumulateSearchStream, mergeGenerators, orderAccountsForSearch,
  parseQuery, readScope, sweepCompleteness,
} from '@/lib/search'
import type { SearchStreamState, SweepProgress } from '@/lib/search'
import { withApiLog } from '@/lib/apiLog'

export const dynamic = 'force-dynamic'

/** La configuration IMAP d'une boîte — même forme pour les trois portées. */
function imapConfig(row: DbEmailAccount) {
  return {
    id: row.id,
    imapHost: row.imap_host,
    imapPort: row.imap_port,
    imapSecure: row.imap_secure,
    username: row.username,
    passwordEncrypted: row.password_encrypted,
    oauthProvider: row.oauth_provider,
    oauthAccessToken: row.oauth_access_token,
    oauthRefreshToken: row.oauth_refresh_token,
    oauthExpiresAt: row.oauth_expires_at,
  }
}

/**
 * Les messages d'un morceau, prêts à partir : du plus récent au plus ancien,
 * plafonnés, et portant la boîte d'où ils viennent — sans elle, la liste ne
 * saurait pas dans QUELLE boîte ouvrir un résultat.
 */
function streamedMessages<T extends { date: string }>(messages: T[], accountId: string) {
  return messages
    .slice()
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, SEARCH_RESULT_LIMIT)
    .map(m => ({ ...m, accountId }))
}

/**
 * Ce qu'un balayage multi-boîtes apprend sur lui-même au fil de l'eau. La route le
 * lit APRÈS le balayage pour dire, dans les deux portées « toutes les boîtes »,
 * jusqu'où la couverture est allée — voir `sweepCompleteness`.
 */
type SweepState = {
  searched: number
  folders: number
  sweptIds: Set<string>
  unreachable: string[]
  /**
   * True as soon as ONE swept account asks for the prompt guard (`bool_or`) — for
   * the single-shot response, which blends every account. The stream never reads
   * this aggregate: each chunk carries its OWN account's guard (`guarded`).
   */
  guarded: boolean
}

const newSweepState = (): SweepState =>
  ({ searched: 0, folders: 0, sweptIds: new Set(), unreachable: [], guarded: false })

/**
 * Un morceau de balayage : les messages d'UN dossier, et la boîte d'où ils viennent.
 * `accountId` est porté par CHAQUE message, pas seulement par le morceau : c'est ce
 * qui fait l'identité d'un résultat quand la liste mêle plusieurs boîtes, et ce que
 * l'accumulation (`accumulateSearchStream`) dédoublonne.
 */
type SweptMessage = Message & { accountId: string }
type SweepChunk = {
  messages: SweptMessage[]
  total: number
  fields: typeof SEARCH_FIELDS
  folder: string
  accountId: string
  accountEmail: string
  searched: number
  folders: number
  accounts: number
  /** The prompt guard of THIS chunk's account — not of the accounts swept so far. */
  guarded: boolean
}

/**
 * Le balayage de TOUTES les boîtes accessibles, en deux passes et au plus
 * ACCOUNT_CONCURRENCY boîtes de front — le cœur de la portée « toutes les boîtes ».
 *
 * Il est ici, et non dans une des deux branches de la route, parce que les DEUX
 * portées « toutes les boîtes » s'en servent : celle qui diffuse (NDJSON, un
 * morceau par dossier) et celle d'un seul tenant (lot S11 — elle rendait 200 avec
 * 0 résultat en ne cherchant que dans la réception de la boîte courante, faute de
 * ce balayage). Un seul exemplaire, donc une seule chose à mesurer et à corriger.
 *
 * PREMIÈRE PASSE : réception + envoyés de CHAQUE boîte. Sans elle, la dernière
 * boîte attend derrière les 97 dossiers d'une autre (mesuré le 20/09/2026 : son
 * premier résultat arrivait à 21,2 s).
 * DEUXIÈME PASSE : tout le reste, dans le même ordre de boîtes, en réutilisant la
 * liste de dossiers de la première — pas de second LIST-STATUS.
 *
 * Une boîte injoignable n'arrête pas les autres : elle est inscrite dans
 * `state.unreachable` et son balayage est sauté.
 */
async function* sweepAccounts(
  accounts: DbEmailAccount[],
  terms: string[],
  signal: AbortSignal,
  state: SweepState,
): AsyncGenerator<SweepChunk> {
  const passes = new Map<string, { first: string[]; rest: string[] }>()
  const sweepFolders = (row: DbEmailAccount, list: string[]) => async function* (): AsyncGenerator<SweepChunk> {
    if (!list.length) return
    for await (const chunk of searchMessagesByFolder(imapConfig(row), list, terms, signal)) {
      if (signal.aborted) return
      state.searched += 1
      state.sweptIds.add(row.id)
      // La garde d'invite s'applique PAR BOÎTE : `prompt_guard` diffère d'une boîte
      // à l'autre, donc chaque morceau porte celle de la sienne, et la réponse d'un
      // seul tenant la porte dès qu'UNE boîte la demande.
      state.guarded = state.guarded || row.prompt_guard
      yield {
        messages: streamedMessages(chunk.messages, row.id),
        total: chunk.total,
        fields: SEARCH_FIELDS,
        folder: chunk.folder,
        accountId: row.id,
        accountEmail: row.email,
        guarded: row.prompt_guard,
        searched: state.searched,
        folders: state.folders,
        // Le nombre de boîtes est connu dès le départ (celles qui sont accessibles) :
        // le bandeau annonce « sur 8 » au premier morceau, sans attendre la fin.
        accounts: accounts.length,
      }
    }
  }

  const firstPass = accounts.map(row => async function* (): AsyncGenerator<SweepChunk> {
    let split: { first: string[]; rest: string[] }
    try {
      split = await listFolderPasses(imapConfig(row))
    } catch {
      state.unreachable.push(row.email)
      return
    }
    passes.set(row.id, split)
    state.folders += split.first.length + split.rest.length
    yield* sweepFolders(row, split.first)()
  })
  for await (const chunk of mergeGenerators(firstPass, ACCOUNT_CONCURRENCY)) {
    if (signal.aborted) return
    yield chunk
  }

  if (signal.aborted) return
  const secondPass = accounts
    .filter(row => passes.get(row.id)?.rest.length)
    .map(row => sweepFolders(row, passes.get(row.id)!.rest))
  for await (const chunk of mergeGenerators(secondPass, ACCOUNT_CONCURRENCY)) {
    if (signal.aborted) return
    yield chunk
  }
}

/**
 * Les boîtes à balayer, dans l'ordre d'utilité : la boîte active d'abord. La
 * boîte nommée par le client ne sert QU'À ordonner — elle n'ouvre rien par
 * elle-même, seules celles de `listAccessibleAccounts` sont balayées.
 */
async function accountsToSweep(userId: string, activeId: string): Promise<DbEmailAccount[]> {
  const accessible = await listAccessibleAccounts(userId)
  const byId = new Map(accessible.map(a => [a.id, a]))
  return orderAccountsForSearch(accessible, activeId)
    .map(id => byId.get(id))
    .filter((a): a is DbEmailAccount => !!a)
}

/** L'état d'avancement d'un balayage, sous la forme que `sweepCompleteness` lit. */
const sweepProgress = (state: SweepState, accounts: number, budgetExhausted: boolean): SweepProgress => ({
  searched: state.searched,
  folders: state.folders,
  sweptAccounts: state.sweptIds.size,
  accounts,
  unreachable: state.unreachable,
  budgetExhausted,
})

async function getHandler(req: Request) {
  const gate = await authorize(req)
  if ('denied' in gate) return gate.denied
  const authCtx = gate.ctx

  const { searchParams } = new URL(req.url)
  const q = searchParams.get(SEARCH_PARAM)?.trim()
  const folder = searchParams.get('folder') ?? 'INBOX'
  const accountParam = searchParams.get('account')
  const scope = readScope(searchParams.get(SCOPE_PARAM))

  // Une requête n'a de sens que par ses TERMES : « a b » n'en porte aucun d'assez
  // long, et chercher « a b » tel quel ramènerait la boîte entière.
  const terms = parseQuery(q)
  if (!q || q.length < MIN_QUERY_LENGTH || terms.length === 0) {
    return NextResponse.json({ messages: [], total: 0, fields: SEARCH_FIELDS })
  }

  try {
    let account: DbEmailAccount | null
    if (accountParam) {
      account = await getAccessibleAccount(accountParam, authCtx.id, [])
    } else {
      const rows = await query<DbEmailAccount>(
        `SELECT * FROM email_accounts WHERE user_id = $1 ORDER BY is_default DESC, created_at ASC LIMIT 1`,
        [authCtx.id]
      )
      account = rows[0] ?? null
    }
    if (!account) {
      return NextResponse.json({ messages: [], total: 0, fields: SEARCH_FIELDS, error: 'No account configured' })
    }
    const config = imapConfig(account)

    // Portée « toutes les boîtes » : le MÊME balayage dans les deux cas, seule la
    // façon de rendre change. En flux, un morceau par dossier part au fur et à
    // mesure ; d'un seul tenant, les morceaux sont accumulés par la fonction pure
    // `accumulateSearchStream` — celle que le client utilise déjà pour le flux, donc
    // le même dédoublonnage, le même tri et le même plafond.
    if (scope === SCOPE_ACCOUNTS) {
      const accounts = await accountsToSweep(authCtx.id, account.id)
      const machine = isMachineRequest(req)
      const state = newSweepState()
      const sweep = new AbortController()
      req.signal.addEventListener('abort', () => sweep.abort(), { once: true })
      // The prompt guard is that of the SWEPT accounts, never of the current one:
      // the sweep crosses several accounts with different settings.
      // In the stream, each chunk comes from ONE account and carries ITS guard
      // (`chunk.guarded`) — not the aggregate, which would stick at the first `true`
      // and then flag accounts that do not ask for it (upstream review defect #10).
      // The single-shot response blends every account: it carries the guard as soon
      // as ONE of them asks for it (`state.guarded`, `bool_or` like
      // `promptGuardApplies` with no named account), read AFTER the sweep.
      if (searchParams.get(STREAM_PARAM)) {
        const encoder = new TextEncoder()
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const send = (payload: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`))
            try {
              for await (const { guarded, ...chunk } of sweepAccounts(accounts, terms, sweep.signal, state)) {
                if (sweep.signal.aborted) break
                send(guardApiPayload(chunk, { enabled: machine && guarded }))
              }
              // Les boîtes injoignables sont signalées en FIN de flux : le client les
              // affiche quand il sait qu'il n'en viendra plus.
              if (!sweep.signal.aborted && state.unreachable.length) send({ unreachable: state.unreachable })
            } catch (err) {
              if (!sweep.signal.aborted) send({ error: String(err) })
            } finally {
              controller.close()
            }
          },
          cancel() { sweep.abort() },
        })
        return new Response(stream, {
          headers: {
            'Content-Type': STREAM_CONTENT_TYPE,
            'Cache-Control': 'no-store, no-transform',
          },
        })
      }

      // SANS flux (lot S11) : la portée est HONORÉE, pas ignorée. Une réponse d'un
      // seul tenant ne montre rien avant la fin, donc le balayage a un temps imparti
      // (`ACCOUNTS_SWEEP_BUDGET_MS`) — dépassé, il rend ce qu'il a ET le dit.
      const deadline = setTimeout(() => sweep.abort(), ACCOUNTS_SWEEP_BUDGET_MS)
      let accumulated: SearchStreamState<SweptMessage> = EMPTY_SEARCH_STREAM
      try {
        for await (const chunk of sweepAccounts(accounts, terms, sweep.signal, state)) {
          accumulated = accumulateSearchStream(accumulated, [chunk])
        }
      } finally {
        clearTimeout(deadline)
      }
      // `sweep.signal.aborted` couvre les DEUX abandons : le temps imparti et la
      // requête coupée par l'appelant. Seul le premier est un arrêt à signaler —
      // l'autre n'a plus de destinataire.
      const coverage = sweepCompleteness(
        sweepProgress(state, accounts.length, sweep.signal.aborted && !req.signal.aborted)
      )
      return NextResponse.json(guardApiPayload({
        messages: accumulated.messages,
        total: accumulated.total,
        fields: SEARCH_FIELDS,
        // La COUVERTURE, sans laquelle « 0 résultat » ne veut rien dire : combien de
        // dossiers et de boîtes ont été cherchés, lesquelles n'ont pas répondu, et
        // si le balayage s'est arrêté avant la fin — avec la raison.
        searched: state.searched,
        folders: state.folders,
        accounts: accounts.length,
        sweptAccounts: state.sweptIds.size,
        unreachable: state.unreachable,
        complete: coverage.complete,
        ...(coverage.complete ? {} : { stoppedBecause: coverage.reasons }),
      }, { enabled: machine && state.guarded }))
    }


    // `scope=all` + `stream=1` : la réponse part dossier par dossier (NDJSON), dans
    // l'ordre d'utilité rendu par listFoldersRanked — les premiers résultats
    // s'affichent en une seconde au lieu d'attendre la couverture complète (mesuré
    // sur la plus grosse boîte de test : 101 dossiers, ~300 ms l'un).
    if (scope === SCOPE_ALL && searchParams.get(STREAM_PARAM)) {
      const ranked = await listFoldersRanked(config)
      const guard = { enabled: isMachineRequest(req) && account.prompt_guard }
      const accountId = account.id
      const encoder = new TextEncoder()
      // Un seul signal d'abandon pour les DEUX façons dont une recherche s'arrête :
      // la requête coupée (`req.signal`) et le flux abandonné par le client, qui
      // n'est annoncé QUE par `cancel()`. Sans lui, quitter la recherche laissait
      // les ouvriers IMAP ouvrir les 1 226 dossiers restants pour personne.
      const sweep = new AbortController()
      req.signal.addEventListener('abort', () => sweep.abort(), { once: true })
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          try {
            for await (const chunk of searchMessagesByFolder(config, ranked, terms, sweep.signal)) {
              if (sweep.signal.aborted) break
              const payload = guardApiPayload({
                messages: streamedMessages(chunk.messages, accountId),
                total: chunk.total,
                fields: SEARCH_FIELDS,
                folder: chunk.folder,
                searched: chunk.searched,
                folders: chunk.folders,
              }, guard)
              controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`))
            }
          } catch (err) {
            // Un flux déjà abandonné n'a plus de destinataire : signaler l'erreur
            // sur un contrôleur fermé lèverait une seconde panne, sans lecteur.
            if (!sweep.signal.aborted) {
              controller.enqueue(encoder.encode(`${JSON.stringify({ error: String(err) })}\n`))
            }
          } finally {
            controller.close()
          }
        },
        // Le client s'est détourné (requête changée, page quittée, bouton Arrêter) :
        // les dossiers restants ne sont pas ouverts et les connexions IMAP se ferment.
        cancel() { sweep.abort() },
      })
      return new Response(stream, {
        headers: {
          'Content-Type': STREAM_CONTENT_TYPE,
          'Cache-Control': 'no-store, no-transform',
        },
      })
    }

    // Réponse d'un seul tenant : la portée « ce dossier » (un seul dossier, donc
    // rien à étaler) et tout appel qui n'a pas demandé le flux — le flux est un
    // opt-in de l'appelant, clé Bearer comprise, jamais un choix fait pour lui.
    // Same ranked list as the streamed branch: it already drops `\\Noselect` and
    // measured-empty folders, which `listFolders()` would have opened for nothing.
    const folders = scope === SCOPE_ALL ? await listFoldersRanked(config) : [folder]
    const { messages, total } = await searchMessagesIn(config, folders, terms)

    // `total` = correspondances RÉELLES (compte des identifiants), `messages` = ce
    // qui a été rendu. L'interface dit « les 200 premiers sur 1 340 » à partir des deux.
    return NextResponse.json(guardApiPayload({
      messages: streamedMessages(messages, account.id),
      total,
      fields: SEARCH_FIELDS,
    }, { enabled: isMachineRequest(req) && account.prompt_guard }))
  } catch (err) {
    return NextResponse.json({ error: String(err), messages: [], total: 0, fields: SEARCH_FIELDS }, { status: 500 })
  }
}

// Le journal se termine avec la réponse : statut et durée n'existent qu'ici. Voir lib/apiLog.ts.
export const GET = withApiLog(getHandler)
