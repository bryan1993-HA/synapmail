import { type NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Transparent 1×1 GIF
const GIF_1x1 = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
)

export async function GET(
  req: NextRequest,
  { params }: { params: { token: string } }
) {
  const { token } = params

  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  const userAgent = req.headers.get('user-agent') ?? ''

  // Non-blocking: record first open + increment counter
  query(
    `UPDATE sent_tracking
     SET opened_at    = COALESCE(opened_at, NOW()),
         open_count   = open_count + 1,
         ip_address   = COALESCE(ip_address, $1),
         user_agent   = COALESCE(user_agent, $2)
     WHERE token = $3`,
    [ip.slice(0, 45), userAgent.slice(0, 512), token]
  ).catch(() => {})

  return new NextResponse(GIF_1x1, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(GIF_1x1.length),
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    },
  })
}
