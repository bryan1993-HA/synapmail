'use client'

import * as React from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/**
 * The application's single password field: input + eye button to show/hide.
 * `type` is enforced by the component — do not pass it as a prop.
 */
type PasswordInputProps = Omit<React.ComponentProps<'input'>, 'type'> & {
  /** Layout classes applied to the container (width, margins) rather than to the input. */
  containerClassName?: string
}

const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ className, containerClassName, disabled, ...props }, ref) {
    const t = useTranslations('common')
    const [visible, setVisible] = React.useState(false)
    const label = visible ? t('hidePassword') : t('showPassword')
    const Icon = visible ? EyeOff : Eye

    return (
      <div className={cn('relative', containerClassName)}>
        <Input
          ref={ref}
          type={visible ? 'text' : 'password'}
          disabled={disabled}
          className={cn('pr-9', className)}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible(v => !v)}
          disabled={disabled}
          aria-label={label}
          aria-pressed={visible}
          title={label}
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-lg text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    )
  }
)

export { PasswordInput }
