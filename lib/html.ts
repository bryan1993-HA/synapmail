/**
 * Shared HTML utilities — strip HTML to plain text, wrap in full document.
 * Used by: lib/smtp.ts (text/plain fallback), app/api/ai/action/route.ts (prompt cleaning).
 */

/**
 * Strip HTML tags and decode common entities, returning readable plain text.
 * Removes <style>, <script>, <head> blocks entirely before stripping tags,
 * so their contents don't pollute the output.
 */
export function htmlToText(html: string): string {
  return html
    // Remove invisible block content first
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, '')
    // Preserve link text + URL
    .replace(/<a[^>]+href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '$2 ($1)')
    // Block elements → newlines
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div|h[1-6]|li|tr|blockquote)[^>]*>/gi, '\n')
    // Strip remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode named entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    // Decode numeric entities (decimal + hex)
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    // Normalize whitespace
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Wrap an HTML snippet in a full HTML document if it doesn't already have one.
 * Prevents SpamAssassin's HTML_MIME_NO_HTML_TAG flag on outgoing emails.
 */
export function wrapHtmlDocument(html: string): string {
  if (/<html[\s>]/i.test(html)) return html
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`
}
