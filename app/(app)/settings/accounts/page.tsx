import { ErrorBoundary } from './ErrorBoundary'
import { AccountsClient } from './AccountsClient'

export default function AccountsPage({
  searchParams,
}: {
  searchParams: { error?: string; success?: string }
}) {
  return (
    <ErrorBoundary>
      <AccountsClient
        initialError={searchParams.error}
        initialSuccess={searchParams.success}
      />
    </ErrorBoundary>
  )
}
