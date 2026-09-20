/**
 * Names the self-check benches write into a real IMAP account or a real HTTP
 * origin. They live here, in ONE place, so a scratch folder left behind by a
 * crashed bench can be found and removed with a single grep, and so no bench
 * can drift onto a different name than the one the cleanup step deletes.
 */

/** Scratch IMAP folder (and folder-name prefix) every bench APPENDs into. */
export const SCRATCH_FOLDER = 'Synapmail-checks'

/**
 * Domain used in the Message-ID of messages a bench APPENDs. RFC 2606 reserves
 * `example.com`, so the identifier can never collide with a real message.
 */
export const SCRATCH_DOMAIN = 'example.com'

/** Public origin the benches use when one is needed but none is configured. */
export const SAMPLE_ORIGIN_HOST = 'mail.example.com'
