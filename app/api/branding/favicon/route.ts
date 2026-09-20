import { NextResponse } from 'next/server'
import { readFavicon } from '@/lib/brandingStore'

export const dynamic = 'force-dynamic'

/**
 * The instance icon, served PUBLICLY: the sign-in page needs it before any session
 * exists (see `lib/publicPaths.ts`).
 *
 * The served type is the one DETECTED at save time, never the one declared by the
 * browser; `nosniff` forbids the client from reinterpreting it, so a dual-reading file
 * (valid PNG bytes, HTML in the payload) cannot execute from our origin. The URL
 * carries its version, hence the long immutable cache: a new icon changes the URL.
 */
export async function GET() {
  const favicon = await readFavicon()
  if (!favicon) return new NextResponse(null, { status: 404 })

  return new NextResponse(new Uint8Array(favicon.bytes), {
    headers: {
      'Content-Type': favicon.type,
      'Content-Length': String(favicon.bytes.length),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  })
}
