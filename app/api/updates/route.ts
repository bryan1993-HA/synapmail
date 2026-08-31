import { NextResponse } from 'next/server'

const GITHUB_REPO = 'bryan1993-HA/synapmail'
const RELEASES_URL = `https://api.github.com/repos/${GITHUB_REPO}/releases`

export interface GitHubRelease {
  tag_name: string
  name: string
  body: string
  html_url: string
  published_at: string
  prerelease: boolean
  draft: boolean
}

// Cache côté serveur — 1 heure
let cache: { releases: GitHubRelease[]; fetchedAt: number } | null = null
const CACHE_TTL_MS = 60 * 60 * 1000

export async function GET() {
  try {
    const current = process.env.NEXT_PUBLIC_APP_VERSION ?? '0.0.0'

    // Vérifier le cache
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      return NextResponse.json({ data: { releases: cache.releases, current } })
    }

    const res = await fetch(`${RELEASES_URL}?per_page=10`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        // Le token est optionnel — sans lui la limite est 60 req/h par IP
        ...(process.env.GITHUB_TOKEN
          ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
          : {}),
      },
      // Pas de cache Next.js — on gère le nôtre
      cache: 'no-store',
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'GitHub API unavailable' }, { status: 502 })
    }

    const all: GitHubRelease[] = await res.json()
    // Exclure les drafts
    const releases = all.filter((r) => !r.draft)

    cache = { releases, fetchedAt: Date.now() }

    return NextResponse.json({ data: { releases, current } })
  } catch {
    return NextResponse.json({ error: 'Failed to fetch releases' }, { status: 500 })
  }
}
