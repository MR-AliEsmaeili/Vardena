import { cva, type VariantProps } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Domain tones of the application menu.
 *
 * The sidebar is an ERP map, not a list of links: each domain (accounting,
 * inventory, organization, …) owns one tint so a user finds a section by
 * colour + glyph + label. Colours come only from `--color-tone-*` tokens in
 * `styles/index.css`; a raw palette value never appears in a component
 * (standards.md §6).
 */
export type NavTone =
  | 'workspace'
  | 'accounting'
  | 'inventory'
  | 'organization'
  | 'licensing'
  | 'admin';

/**
 * Static class strings are required (Tailwind only emits classes it can read
 * literally), so the tone → classes map is enumerated instead of templated.
 */
export interface NavToneStyles {
  /** Idle glyph tile: soft tint + hairline ring. */
  idle: string;
  /** Current-page glyph tile: saturated fill + white glyph. */
  active: string;
  /** Group-header glyph (text-only tone). */
  icon: string;
  /** Active-route marker bar on the row's inline-start edge. */
  marker: string;
}

export const NAV_TONE_TILE: Record<NavTone, NavToneStyles> = {
  workspace: {
    idle: 'bg-tone-workspace-soft text-tone-workspace-ink ring-tone-workspace-line/70',
    active: 'bg-tone-workspace-strong text-white ring-white/25',
    icon: 'text-tone-workspace-ink',
    marker: 'bg-tone-workspace-strong',
  },
  accounting: {
    idle: 'bg-tone-accounting-soft text-tone-accounting-ink ring-tone-accounting-line/70',
    active: 'bg-tone-accounting-strong text-white ring-white/25',
    icon: 'text-tone-accounting-ink',
    marker: 'bg-tone-accounting-strong',
  },
  inventory: {
    idle: 'bg-tone-inventory-soft text-tone-inventory-ink ring-tone-inventory-line/70',
    active: 'bg-tone-inventory-strong text-white ring-white/25',
    icon: 'text-tone-inventory-ink',
    marker: 'bg-tone-inventory-strong',
  },
  organization: {
    idle: 'bg-tone-organization-soft text-tone-organization-ink ring-tone-organization-line/70',
    active: 'bg-tone-organization-strong text-white ring-white/25',
    icon: 'text-tone-organization-ink',
    marker: 'bg-tone-organization-strong',
  },
  licensing: {
    idle: 'bg-tone-licensing-soft text-tone-licensing-ink ring-tone-licensing-line/70',
    active: 'bg-tone-licensing-strong text-white ring-white/25',
    icon: 'text-tone-licensing-ink',
    marker: 'bg-tone-licensing-strong',
  },
  admin: {
    idle: 'bg-tone-admin-soft text-tone-admin-ink ring-tone-admin-line/70',
    active: 'bg-tone-admin-strong text-white ring-white/25',
    icon: 'text-tone-admin-ink',
    marker: 'bg-tone-admin-strong',
  },
};

const glyphVariants = cva(
  'relative inline-flex shrink-0 items-center justify-center rounded-glyph ring-1 ring-inset transition-[background-color,color,box-shadow,transform] duration-200 ease-out motion-reduce:transition-none',
  {
    variants: {
      size: {
        sm: 'h-5 w-5',
        md: 'h-6 w-6',
        lg: 'h-8 w-8',
      },
    },
    defaultVariants: { size: 'md' },
  },
);

const iconSizes = {
  sm: 'h-3 w-3',
  md: 'h-3.5 w-3.5',
  lg: 'h-4 w-4',
} as const;

export interface NavGlyphProps extends VariantProps<typeof glyphVariants> {
  icon: LucideIcon;
  tone: NavTone;
  /** The route this glyph belongs to is the current page. */
  active?: boolean;
  className?: string;
}

/**
 * The tile that carries one navigation glyph.
 *
 * Idle: a soft domain tint with a hairline ring. Active: the saturated tone
 * with a white glyph, so the current section is unmistakable at a glance.
 * The parent row is expected to carry `group`, which powers the hover lift.
 */
export function NavGlyph({
  icon: Icon,
  tone,
  active = false,
  size = 'md',
  className,
}: NavGlyphProps) {
  const palette = NAV_TONE_TILE[tone];

  return (
    <span
      aria-hidden="true"
      data-tone={tone}
      data-active={active ? 'true' : 'false'}
      className={cn(
        glyphVariants({ size }),
        active ? palette.active : palette.idle,
        active ? 'shadow-card' : 'group-hover:scale-105 group-hover:-rotate-3',
        className,
      )}
    >
      <Icon
        className={iconSizes[size ?? 'md']}
        strokeWidth={active ? 2.4 : 2}
        aria-hidden
      />
    </span>
  );
}
