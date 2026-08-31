import RulesClient from '@/components/settings/RulesClient'

interface Props {
  searchParams: {
    prefill_from?: string
    prefill_from_name?: string
    prefill_subject?: string
    prefill_account?: string
  }
}

export default function RulesPage({ searchParams }: Props) {
  const prefill = (searchParams.prefill_from || searchParams.prefill_subject)
    ? {
        fromAddress: searchParams.prefill_from,
        fromName: searchParams.prefill_from_name,
        subject: searchParams.prefill_subject,
        accountId: searchParams.prefill_account,
      }
    : undefined

  return <RulesClient prefill={prefill} />
}
