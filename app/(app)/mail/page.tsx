import { Suspense } from 'react'
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { MailClient } from './MailClient'

export default async function MailPage() {
  const session = await auth()
  if (!session) redirect('/login')
  return (
    <Suspense fallback={null}>
      <MailClient />
    </Suspense>
  )
}
