import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'

export default async function AppLayout({
  children,
  modal,
}: {
  children: React.ReactNode
  modal: React.ReactNode
}) {
  const session = await auth()
  if (!session) redirect('/login')
  return (
    <AppShell>
      {children}
      {modal}
    </AppShell>
  )
}
