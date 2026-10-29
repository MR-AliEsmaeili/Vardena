import { AlertTriangle, Lock, LogOut, ShieldOff } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSession } from '@/features/auth/use-session';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Button } from '@/ui/button';
import { ThinkingOrbIndicator } from '@/ui/thinking-orb';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/card';

/**
 * The states the authenticated bootstrap stages share.
 *
 * Two stages run between the session and the workspace — the licensing stage
 * (`license-gate.tsx`) and the organization stage (`organization-gate.tsx`) —
 * and both resolve, block and offer logout in exactly the same shape. They
 * live here so the two gates stay visually and behaviorally identical
 * instead of drifting into two different "blocked" screens.
 */

/** The centered, single-column screen a bootstrap stage occupies. */
export function BootstrapScreen({ children }: { children: ReactNode }) {
  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-[calc(100vh_-_3.5rem)] w-full max-w-lg items-center px-4 py-10"
      dir="rtl"
    >
      <div className="w-full">{children}</div>
    </main>
  );
}

/** Centered resolving state while a bootstrap stage is being determined. */
export function ResolvingState({ label }: { label: string }) {
  return (
    <output
      className="flex flex-col items-center gap-3 py-16"
      aria-live="polite"
      aria-busy="true"
      data-testid="resolving-state"
    >
      <ThinkingOrbIndicator size={64} decorative />
      <p className="text-sm text-ink-muted">{label}</p>
    </output>
  );
}

/** The logout affordance every blocked bootstrap state shares. */
export function LogoutButton() {
  const session = useSession();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={session.isLoggingOut}
      loading={session.isLoggingOut}
      onClick={() => {
        void session.logout();
      }}
    >
      <LogOut className="h-4 w-4" aria-hidden />
      {session.isLoggingOut ? t.auth.loggingOut : t.auth.logout}
    </Button>
  );
}

export type BlockedStateTone = 'neutral' | 'warning' | 'critical';

const BLOCKED_TONE_STYLES: Record<
  BlockedStateTone,
  {
    card: string;
    iconBox: string;
    Icon: typeof Lock;
  }
> = {
  neutral: {
    card: 'border-line',
    iconBox: 'bg-sunken text-ink-muted',
    Icon: Lock,
  },
  warning: {
    card: 'border-warn-line',
    iconBox: 'bg-warn-soft text-warn-ink',
    Icon: AlertTriangle,
  },
  critical: {
    card: 'border-critical-line border-s-4 border-s-critical',
    iconBox: 'bg-critical-soft text-critical-ink',
    Icon: ShieldOff,
  },
};

/**
 * Terminal blocked state (inactive installation license, no organization, no
 * permission to read the organization list).
 *
 * The workspace is never entered behind it: no fake default scope is chosen
 * and no scoped request is sent. The only recovery paths the contract
 * actually offers are contacting an administrator and logging out.
 */
export function BlockedState({
  title,
  description,
  tone = 'neutral',
}: {
  title: string;
  description: string;
  tone?: BlockedStateTone;
}) {
  const { card, iconBox, Icon } = BLOCKED_TONE_STYLES[tone];
  return (
    <Card className={cn('shadow-raised', card)}>
      <CardHeader className="space-y-3">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className={cn(
              'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-glyph',
              iconBox,
            )}
          >
            <Icon className="h-4.5 w-4.5" />
          </span>
          <div className="min-w-0 space-y-1.5">
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <LogoutButton />
      </CardContent>
    </Card>
  );
}
