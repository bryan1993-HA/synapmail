import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import os from 'os'

function getCandidateUrls(): string[] {
  const urls = new Set<string>([
    'http://localhost:11434',
    'http://host.docker.internal:11434',
    'http://ollama:11434',
    'http://172.17.0.1:11434',
  ])

  // Détecte dynamiquement les gateways à partir des interfaces réseau
  // En Docker, la gateway est généralement l'IP .1 du sous-réseau de l'interface
  const ifaces = os.networkInterfaces()
  for (const iface of Object.values(ifaces)) {
    if (!iface) continue
    for (const info of iface) {
      if (info.family !== 'IPv4' || info.internal) continue
      // Remplace le dernier octet par 1 pour obtenir la gateway probable
      const gateway = info.address.replace(/\.\d+$/, '.1')
      urls.add(`http://${gateway}:11434`)
      // Essaie aussi l'IP directe (Ollama sur le même host)
      urls.add(`http://${info.address}:11434`)
    }
  }

  return Array.from(urls)
}

interface OllamaTagsResponse {
  models?: { name: string }[]
}

async function tryOllama(url: string): Promise<{ url: string; models: string[] } | null> {
  try {
    const res = await fetch(`${url}/api/tags`, {
      signal: AbortSignal.timeout(2000),
    })
    if (!res.ok) return null
    const data = await res.json() as OllamaTagsResponse
    const models = (data.models ?? []).map(m => m.name.replace(/:latest$/, ''))
    return { url, models }
  } catch {
    return null
  }
}

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Teste toutes les URLs en parallèle
  const results = await Promise.all(getCandidateUrls().map(tryOllama))
  const found = results.find(r => r !== null)

  if (!found) {
    return NextResponse.json({
      data: { found: false, url: null, models: [] },
    })
  }

  return NextResponse.json({
    data: { found: true, url: found.url, models: found.models },
  })
}
