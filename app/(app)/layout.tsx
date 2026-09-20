import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { PgpSessionProvider } from '@/components/pgp/PgpSessionProvider'
import { MailSelectionProvider } from '@/lib/mailSelection'

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
    <PgpSessionProvider>
      <MailSelectionProvider>
        <AppShell>
          {children}
          {modal}
        </AppShell>
      </MailSelectionProvider>
    </PgpSessionProvider>
  )
}
