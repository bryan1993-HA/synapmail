/**
 * Utilities for rendering email HTML inside an iframe safely.
 * Shared between ReadingPane and ThreadPane.
 */

/**
 * Inject our scoped styles and a <base target="_blank"> into the email HTML,
 * so all links open in a new tab and the email body is styled consistently.
 * The <base> tag is injected only if one doesn't already exist.
 */
export function buildIframeHtml(bodyHtml: string): string {
  const styles = `<style>
    * { box-sizing: border-box; }
    body { font-family: sans-serif; font-size: 14px; line-height: 1.6; color: #333; padding: 16px; margin: 0; }
    img { max-width: 100%; height: auto; }
  </style>`

  // <base target="_blank"> forces every link to open in a new tab.
  // We only inject it when the email doesn't already have its own <base> tag,
  // to avoid overriding a <base href="..."> that would break relative URLs.
  const baseTag = `<base target="_blank" rel="noopener noreferrer">`

  // Case 1 — email already has a full <html> structure
  if (/<html[\s>]/i.test(bodyHtml)) {
    // Inject styles + base into existing <head> (only if no <base> yet)
    if (!/<base[\s>]/i.test(bodyHtml)) {
      return bodyHtml.replace(/<head([^>]*)>/i, `<head$1>${baseTag}${styles}`)
    }
    return bodyHtml.replace(/<head([^>]*)>/i, `<head$1>${styles}`)
  }

  // Case 2 — email has <head> but no <html>
  if (/<head[\s>]/i.test(bodyHtml)) {
    const withStyles = bodyHtml.replace(/<head([^>]*)>/i, `<head$1>${styles}`)
    if (!/<base[\s>]/i.test(bodyHtml)) {
      return withStyles.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`)
    }
    return withStyles
  }

  // Case 3 — plain HTML snippet, wrap it
  return `<html><head>${baseTag}${styles}</head><body>${bodyHtml}</body></html>`
}

/**
 * Add rel="noopener noreferrer" to all <a> tags in the iframe that don't have it.
 * Called after the iframe has loaded to cover dynamically written content.
 */
export function hardenIframeLinks(iframe: HTMLIFrameElement): void {
  try {
    const doc = iframe.contentDocument
    if (!doc) return
    doc.querySelectorAll('a[href]').forEach(a => {
      const existing = a.getAttribute('rel') ?? ''
      const parts = new Set(existing.split(/\s+/).filter(Boolean))
      parts.add('noopener')
      parts.add('noreferrer')
      a.setAttribute('rel', Array.from(parts).join(' '))
      // Ensure target is also set in case <base> didn't apply
      if (!a.getAttribute('target')) a.setAttribute('target', '_blank')
    })
  } catch {
    // Cross-origin sandbox may block access — ignore
  }
}
