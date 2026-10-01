import { LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { useSession } from '@/features/auth/use-session';
import { t } from '@/lib/i18n';
import { Button } from '@/ui/button';
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
      className="mx-auto flex min-h-[calc(100vh-3.5rem)] w-full max-w-lg items-center px-4 py-10"
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
    >
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-indigo-600" />
      <p className="text-sm text-slate-600">{label}</p>
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
      onClick={() => {
        void session.logout();
      }}
    >
      <LogOut className="h-4 w-4" aria-hidden />
      {session.isLoggingOut ? t.auth.loggingOut : t.auth.logout}
    </Button>
  );
}

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
}: {
  title: string;
  description: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <LogoutButton />
      </CardContent>
    </Card>
  );
}
