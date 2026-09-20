#!/usr/bin/env node
/**
 * Guard on `listMessages` (lib/imap.ts): the size of the VIEW and the size of the FOLDER
 * must never be the same variable.
 *
 * `total` is the size of the paged view — for a filtered view (unread / flagged) it is the
 * number of MATCHES. The page-1 block below it reconciles the cache and records the unread
 * count, and both reason about the FOLDER. When they read `total`, opening a filter that
 * matches nothing means "empty folder": the folder's whole `messages_cache` is deleted and
 * its unread badge is written to 0 — silently, from a read-only list request.
 *
 * Exit 0 when the two are kept apart, 1 otherwise. Node built-ins only.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'imap.ts')
const src = readFileSync(SOURCE, 'utf8')

const body = src.slice(src.indexOf('export async function listMessages'))
const fn = body.slice(0, body.indexOf('\nexport '))
assert.ok(fn.includes('const mailboxSize = mailbox.exists'), 'the folder size must have its own name')

/** Everything from the cache reconcile onwards reasons about the FOLDER, never about the view. */
const reconcile = fn.slice(fn.indexOf('let liveUids'), fn.lastIndexOf('return { messages, total }'))
assert.ok(reconcile.length > 0, 'the page-1 reconcile block was not found — this guard is stale')
const leaks = reconcile.split('\n').filter(line => /\btotal\b/.test(line) && !line.trimStart().startsWith('//'))
assert.deepEqual(leaks, [], 'the reconcile block must not read the view size `total`')

/** The "all" page range walks sequence numbers 1..N of the FOLDER, not of the view. */
const range = fn.slice(fn.indexOf("if (filter === 'all')"), fn.indexOf('const pageUids'))
assert.ok(range.includes('mailboxSize - (page - 1) * perPage'), 'the page range must walk the folder')

/** A filtered view still reports its own size, otherwise the list pages into the void. */
assert.ok(/total = allSeqs\.length/.test(fn), 'a filtered view must report its number of matches')

console.log('check-list-total: OK')
