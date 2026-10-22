import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { ThinkingOrbIndicator } from './thinking-orb';

const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 rounded-control text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-brand text-white shadow-card hover:bg-brand-strong active:bg-brand-strong',
        outline:
          'border border-line-strong bg-surface text-ink hover:bg-sunken active:bg-sunken',
        ghost: 'text-ink-muted hover:bg-sunken hover:text-ink',
        subtle: 'bg-sunken text-ink hover:bg-line/70',
        danger:
          'bg-danger text-white shadow-card hover:bg-danger-strong active:bg-danger-strong',
      },
      size: {
        sm: 'h-8 px-3 text-xs',
        md: 'h-9 px-4',
        icon: 'h-9 w-9',
      },
    },
    defaultVariants: { variant: 'default', size: 'md' },
  },
);

export interface ButtonProps
  extends ComponentProps<'button'>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /**
   * The operation this button starts is in flight. The button is disabled for
   * the duration (no double submit) and shows the Thinking Orb next to its
   * existing, operation-specific Persian label. Callers keep ownership of
   * the label text; the primitive never invents a generic one.
   */
  loading?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : 'button';

  // Slot requires exactly one child. The orb is therefore only added to the
  // real <button> path, and as a fragment with the original label.
  const content =
    !asChild && loading ? (
      <>
        <ThinkingOrbIndicator size={20} decorative />
        {children}
      </>
    ) : (
      children
    );

  return (
    <Component
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={asChild ? disabled : disabled === true || loading}
      aria-busy={loading ? true : undefined}
      data-loading={loading ? 'true' : undefined}
      {...props}
    >
      {content}
    </Component>
  );
}

export { buttonVariants };
