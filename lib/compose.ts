/** Opening the "New message" window — single source for the bar, the dashboard and the list. */
export const COMPOSE_EVENT = 'synapmail:compose'
export const COMPOSE_QUERY = 'compose'
export const MAIL_PATH = '/mail'

/** Emits the event MailClient listens for (only has an effect on the mailbox page). */
export function dispatchCompose() {
  window.dispatchEvent(new CustomEvent(COMPOSE_EVENT))
}

/**
 * Opens the composer from anywhere: already on the mailbox → event; elsewhere
 * (dashboard, settings, ...) → navigation to the mailbox with `?compose=1`, which
 * MailClient consumes on mount. No timer involved.
 */
export function openCompose(pathname: string | null, push: (href: string) => void) {
  if (pathname === MAIL_PATH || pathname?.startsWith(`${MAIL_PATH}/`)) dispatchCompose()
  else push(`${MAIL_PATH}?${COMPOSE_QUERY}=1`)
}
