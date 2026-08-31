import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { AISettingsClient } from './AISettingsClient'

export default async function AISettingsPage() {
  const session = await auth()
  if (!session) redirect('/login')
  return <AISettingsClient />
}
