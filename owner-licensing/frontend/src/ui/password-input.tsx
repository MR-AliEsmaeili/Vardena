import { Eye, EyeOff } from 'lucide-react';
import { useState, type ComponentProps } from 'react';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Input } from './input';

export function PasswordInput({
  className,
  disabled,
  dir = 'ltr',
  ...props
}: Omit<ComponentProps<'input'>, 'type'>) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative" dir={dir}>
      <Input
        {...props}
        type={visible ? 'text' : 'password'}
        dir={dir}
        disabled={disabled}
        className={cn('pe-9', className)}
      />
      <button
        type="button"
        disabled={disabled}
        aria-label={visible ? t.auth.hidePassword : t.auth.showPassword}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
        className={cn(
          'absolute inset-y-1 end-1 inline-flex w-7 items-center justify-center rounded-control text-subtle transition-colors',
          'hover:bg-muted hover:text-ink',
          'focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent',
          'disabled:pointer-events-none disabled:opacity-50',
        )}
      >
        {visible ? (
          <EyeOff className="h-4 w-4 shrink-0" aria-hidden />
        ) : (
          <Eye className="h-4 w-4 shrink-0" aria-hidden />
        )}
      </button>
    </div>
  );
}
