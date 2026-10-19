import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { ThinkingOrbIndicator } from './thinking-orb';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600',
  {
    variants: {
      variant: {
        default: 'bg-indigo-600 text-white hover:bg-indigo-700',
        outline:
          'border border-slate-300 bg-white text-slate-800 hover:bg-slate-100',
        ghost: 'text-slate-700 hover:bg-slate-100',
        subtle: 'bg-slate-100 text-slate-800 hover:bg-slate-200',
        danger: 'bg-rose-600 text-white hover:bg-rose-700',
      },
      size: {
        sm: 'h-8 px-3',
        md: 'h-10 px-4',
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
