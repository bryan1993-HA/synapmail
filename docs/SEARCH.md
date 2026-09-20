# How search works

What the search field looks for, how it splits a query, where it looks, and what it cannot do. The
contract lives in `lib/search.ts` — the values quoted here are extracted from it, never copied
elsewhere in the code.

## The fields searched

A term is looked for in **the sender, the recipients, the carbon copy and the subject**
(`SEARCH_FIELDS = ['from', 'to', 'cc', 'subject']`), server-side, through an IMAP `SEARCH`.

**Message bodies are NOT searched.** This is not an ergonomic choice, it is a measurement: on some
consumer-grade servers the `BODY` and `TEXT` criteria return **0 results** — and, worse, adding `body`
to the `OR` drops the whole `OR` to 0, meaning that searching "in more fields" returned nothing at
all. The banner says so when a search yields no result.

Before restoring body search on another server, it must be MEASURED on that server:
`scripts/check-search-capability.mjs` reads what the server advertises.

## How a query is split

`parseQuery(q)` (a pure function, self-checked by `scripts/check-search-parse.mjs`):

- **several words means AND** — each word must be found in at least one of the fields above, in any
  order: "3d cpi" and "cpi 3d" yield the same set;
- **quotes** keep an exact substring: `"3d cpi"` matches only that sequence;
- case and repeated spaces are ignored, duplicates are folded;
- a word **shorter than 2 characters** is ignored (it would bring back the whole mailbox).

## Where it looks: the scope

Two scopes, written in the URL (`scope=folder` by default, `scope=all`):

- **this folder** — a `SELECT` plus a `SEARCH` on the open folder;
- **all folders** — folders are walked **in order of usefulness** (inbox, sent, then the rest by the
  date of the latest message known to the cache), and results are **streamed as they come** (NDJSON):
  the first lines appear while the search is still running. The banner advances ("5 folders out of
  23") and a **Stop** button interrupts the stream; the list already received stays on screen.

Changing the query, or leaving the page, cancels the running stream cleanly (`AbortController` in the
browser, IMAP connections closed server-side).

## The ceilings, and why they are there

- **200 results displayed** (`SEARCH_RESULT_LIMIT`), most recent first. The banner does not hide it:
  "2,406 results · 200 displayed". `total` counts **every** match, not only those that fit on screen.
- **No local full-text index.** That would be the only way to search bodies on a server that refuses
  `BODY`, but it means storing the bodies of every message of every mailbox in PostgreSQL, keeping
  them in sync, and accepting what that represents in volume and in privacy. `ponytail:` known
  ceiling, upgrade path = a product decision to be taken explicitly, not an implementation detail.

## What search does not say

It does not search attachments, nor bodies (see above), and a folder the server refuses to open is
skipped without failing the search. The measurements on this page were taken on **a single
consumer-grade server**: another server may answer differently, and nothing here allows extrapolating
from it.
