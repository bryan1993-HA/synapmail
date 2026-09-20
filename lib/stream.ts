/**
 * Contract of the `/api/stream` SSE feed, shared by the server and the browser.
 * Kept apart from `lib/idle.ts`: IMAP watching is server code (`tls`), so a client
 * component cannot import it just to read a plain constant.
 */

/** Event type pushed when the watched mailbox has changed. */
export const MAILBOX_CHANGED = 'mailbox_changed'

/** `/api/stream` parameter naming the account to watch. */
export const STREAM_ACCOUNT_PARAM = 'account'

/** Folder watched in real time: the one that receives incoming mail. */
export const IDLE_FOLDER = 'INBOX'
