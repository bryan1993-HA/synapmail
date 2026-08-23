'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { MessageList } from '@/components/layout/MessageList'
import { ReadingPane } from '@/components/layout/ReadingPane'

export function MailClient() {
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null)
  const searchParams = useSearchParams()
  const folder = searchParams.get('folder') ?? 'INBOX'

  return (
    <div className="flex h-full">
      {/* Message List — center column */}
      <div className="w-80 shrink-0 border-r border-border flex flex-col">
        <MessageList
          folder={folder}
          selectedUid={selectedUid}
          onSelect={(uid, accountId) => {
            setSelectedUid(uid)
            setSelectedAccount(accountId)
          }}
        />
      </div>

      {/* Reading Pane — right column */}
      <div className="flex-1 overflow-hidden">
        <ReadingPane uid={selectedUid} accountId={selectedAccount} folder={folder} />
      </div>
    </div>
  )
}
