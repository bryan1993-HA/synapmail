/**
 * Forwarding a WHOLE message as an attachment.
 *
 * The MIME type and the extension of an attached message are not restated
 * anywhere: the server reads them here to describe the part, the test harness
 * reads them back to check what was attached. One single definition, so no drift
 * is possible.
 */

/** MIME type of a complete message attached to another one (RFC 2046 §5.2.1). */
export const EML_CONTENT_TYPE = 'message/rfc822'

/** Extension of the file offered to the recipient. */
export const EML_EXTENSION = '.eml'

/** Fallback name when the forwarded message has no subject. */
export const EML_FALLBACK_NAME = 'message'

/**
 * File name of an attached message, derived from its subject.
 * Path separators and the characters Windows forbids are replaced, and the length
 * is bounded: a mail subject can run to hundreds of characters, and many clients
 * truncate the name beyond that.
 */
export const EML_MAX_NAME_LENGTH = 80

export function emlFilename(subject: string | null | undefined): string {
  const cleaned = (subject ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, EML_MAX_NAME_LENGTH)
    .trim()
  return `${cleaned || EML_FALLBACK_NAME}${EML_EXTENSION}`
}
