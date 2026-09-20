/**
 * Forwarding WHOLE messages as attachments — the trust boundary.
 *
 * The client announces an account, a folder and some uids: none of it is
 * trustworthy. This module holds, in ONE single place, what the route accepts,
 * what it rejects, and under which code — the same code shapes the error on the
 * server and picks the translated sentence in the compose window.
 */

/**
 * Maximum number of messages attached at once. Calibrated on the intended use
 * ("tick a few messages and pass them on"), not on a machine capacity: beyond
 * that, it is a mailbox export, not a forward.
 */
export const FORWARD_MAX_MESSAGES = 25

/**
 * Ceiling on the total size of the re-read sources, measured BEFORE loading a
 * single byte into memory. 25 MiB is the most widespread attachment limit among
 * consumer SMTP servers: beyond it the send would be refused anyway, after having
 * inflated the process.
 */
export const FORWARD_MAX_TOTAL_BYTES = 25 * 1024 * 1024

/** An IMAP uid is a decimal integer. `1:*` is a valid sequence SET, so it is rejected here. */
const UID_PATTERN = /^\d+$/

/** Error codes — the server returns them, the compose window translates them. */
export const FORWARD_ERROR = {
  invalid: 'forward_invalid',
  tooMany: 'forward_too_many',
  tooLarge: 'forward_too_large',
  missing: 'forward_missing',
  originDenied: 'forward_origin_denied',
} as const

export type ForwardErrorCode = (typeof FORWARD_ERROR)[keyof typeof FORWARD_ERROR]

/** What the client MUST supply: the selection's ORIGIN account, its folder, its uids. */
export interface ForwardedMessages {
  accountId: string
  folder: string
  uids: string[]
}

export type ForwardCheck<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; code: ForwardErrorCode; detail?: number }

/**
 * Validates the forward request exactly as it arrives from the network. The uids are
 * de-duplicated while preserving the selection order: that is the order the user
 * ticked, and therefore the order of the attachments.
 */
export function parseForwardedMessages(raw: unknown): ForwardCheck<ForwardedMessages> {
  const deny = (code: ForwardErrorCode, status = 400, detail?: number): ForwardCheck<ForwardedMessages> =>
    ({ ok: false, status, code, detail })

  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return deny(FORWARD_ERROR.invalid)
  const { accountId, folder, uids } = raw as Record<string, unknown>

  if (typeof accountId !== 'string' || !accountId.trim()) return deny(FORWARD_ERROR.invalid)
  if (typeof folder !== 'string' || !folder.trim()) return deny(FORWARD_ERROR.invalid)
  if (!Array.isArray(uids) || !uids.length) return deny(FORWARD_ERROR.invalid)
  if (!uids.every(uid => typeof uid === 'string' && UID_PATTERN.test(uid))) return deny(FORWARD_ERROR.invalid)

  const unique = Array.from(new Set(uids as string[]))
  if (unique.length > FORWARD_MAX_MESSAGES) {
    return deny(FORWARD_ERROR.tooMany, 400, FORWARD_MAX_MESSAGES)
  }

  return { ok: true, value: { accountId, folder: folder.trim(), uids: unique } }
}

/**
 * The account the sources are RE-READ from. The sender picked in "From" and the
 * selection's origin account are two different things: reading from the former
 * would attach the messages carrying the same uids in ANOTHER mailbox — inbox uids
 * are small integers, they exist on both sides. Access to the origin is therefore
 * checked separately.
 *
 * `loadAccount` is injected so the decision can be verified without a database
 * (see `scripts/check-forward-decision.mjs`).
 */
export async function resolveForwardOrigin<A extends { id: string }>(
  senderAccount: A,
  originAccountId: string,
  loadAccount: (accountId: string) => Promise<A | null>
): Promise<ForwardCheck<A>> {
  if (originAccountId === senderAccount.id) return { ok: true, value: senderAccount }
  const origin = await loadAccount(originAccountId)
  if (!origin) return { ok: false, status: 404, code: FORWARD_ERROR.originDenied }
  return { ok: true, value: origin }
}
