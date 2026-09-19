import { useCallback, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Alert, AlertDescription, AlertTitle } from 'renderer/shad/ui/alert';
import { Button } from 'renderer/shad/ui/button';
import { Input } from 'renderer/shad/ui/input';
import { Label } from 'renderer/shad/ui/label';
import {
  clearStashedJoinInvite,
  readStashedJoinInvite,
  type JoinInvite,
} from 'renderer/lib/joinLink';

/**
 * "Join existing sync" — the second-device counterpart to the BYOK Settings
 * connect wizard (SyncSettings.tsx), reachable ONLY from Login (see that
 * view's own entry-point link, gated on `window.electron.supportsSync` AND
 * this browser's local database having no business data yet — the same
 * "nothing worth losing" precondition Import/index.tsx's "download a backup
 * first" escape hatch checks, but here it gates whether the whole flow is
 * offered at all rather than just a warning link).
 *
 * Flow, driven by the single `sync:join` RPC
 * (`window.electron.syncJoin`, apps/web/src/worker/syncManager.ts's
 * `SyncManager.join`):
 *   1. `form` — paste the same Project URL + anon key a first device used
 *      to connect. Same validation/classification as the Settings connect
 *      form (`SyncErrorInfo.message`/`.guidance`), rendered the same way.
 *   2. `joining` — the RPC call is in flight: validates the project, then
 *      pulls the ENTIRE project history down before resolving (this
 *      device's own placeholder user/starter chart are cleared first on
 *      the worker side so they never leak onto the shared project — see
 *      `SyncManager.join`'s doc comment). This can take a while for a
 *      project with real history, unlike the Settings connect form's
 *      near-instant probe-only round trip.
 *   3. `done` — "Pulled N rows." The user's real account (and everyone
 *      else's) now exists locally, from the pulled `users` table, so the
 *      only thing left is signing in as one of them — "Continue to Login"
 *      carries a success note there via router state.
 *   4. `error` — the classified error + guidance, same shape/rendering as
 *      the Settings connect form, with a "Try again" back to `form`.
 */

type Step = 'form' | 'joining' | 'done' | 'error';

const JoinSyncPage: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const prefill =
    (location.state as { joinInvite?: JoinInvite } | null)?.joinInvite ??
    readStashedJoinInvite();

  const [step, setStep] = useState<Step>('form');
  const [url, setUrl] = useState(prefill?.url ?? '');
  const [anonKey, setAnonKey] = useState(prefill?.anonKey ?? '');
  const [pulled, setPulled] = useState(0);
  const [error, setError] = useState<{
    message: string;
    guidance: string;
  } | null>(null);

  const handleJoin = useCallback(async () => {
    if (!window.electron.syncJoin) {
      setError({
        message:
          'Joining an existing sync project is not available in this build.',
        guidance: '',
      });
      setStep('error');
      return;
    }

    setStep('joining');
    setError(null);
    try {
      const result = await window.electron.syncJoin({
        url: url.trim(),
        anonKey: anonKey.trim(),
      });
      if (!result.ok) {
        setError(
          result.error ?? {
            message: 'Joining failed for an unknown reason.',
            guidance:
              'Double-check the Project URL and anon key, then try again.',
          },
        );
        setStep('error');
        return;
      }
      clearStashedJoinInvite();
      setPulled(result.pulled ?? 0);
      setStep('done');
    } catch (err) {
      setError({
        message: err instanceof Error ? err.message : String(err),
        guidance: '',
      });
      setStep('error');
    }
  }, [url, anonKey]);

  const handleContinueToLogin = useCallback(() => {
    navigate('/login', { state: { syncJoined: true, pulled } });
  }, [navigate, pulled]);

  const resetToForm = useCallback(() => {
    setStep('form');
    setError(null);
  }, []);

  return (
    <div className="flex justify-center items-start min-h-screen py-16">
      <div className="w-full max-w-2xl p-6 rounded-xl shadow-md border-white border-dashed border-[1px] flex flex-col gap-4">
        <h1 className="title-new">Join existing sync</h1>

        {step === 'form' && (
          <>
            <p className="text-sm text-muted-foreground">
              {prefill
                ? 'This device was opened from an "Add a device" link. Confirm the project below and join — nothing is sent until you tap Join.'
                : "Setting up a second device? Paste the same Project URL and anon key another device already used to connect, and this device will pull down that business's accounts, charts, journals and invoices before you sign in."}
            </p>
            <div className="flex flex-col gap-2">
              <Label htmlFor="joinProjectUrl">Project URL</Label>
              <Input
                id="joinProjectUrl"
                placeholder="https://xxxxxxxxxxxx.supabase.co"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="joinAnonKey">Anon public API key</Label>
              <Input
                id="joinAnonKey"
                type="password"
                placeholder="eyJhbGciOi..."
                value={anonKey}
                onChange={(e) => setAnonKey(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
              <span className="text-xs text-muted-foreground">
                From Supabase → Project Settings → API. Use the &quot;anon&quot;
                / &quot;public&quot; key — never the service_role key.
              </span>
            </div>
            <div className="flex justify-end">
              <Button
                onClick={handleJoin}
                disabled={!url.trim() || !anonKey.trim()}
              >
                {prefill ? 'Join this project' : 'Join'}
              </Button>
            </div>
            <p className="text-sm">
              <Link to="/login" className="underline">
                Back to Login
              </Link>
            </p>
          </>
        )}

        {step === 'joining' && (
          <p className="text-sm text-muted-foreground" role="status">
            Joining&hellip; pulling this project&apos;s data down. This may take
            a moment for a business with a lot of history.
          </p>
        )}

        {step === 'done' && (
          <>
            <Alert variant="default">
              <AlertTitle>Joined</AlertTitle>
              <AlertDescription>
                Pulled {pulled} row{pulled === 1 ? '' : 's'}. Data synced — sign
                in with your existing account.
              </AlertDescription>
            </Alert>
            <div className="flex justify-end">
              <Button variant="default" onClick={handleContinueToLogin}>
                Continue to Login
              </Button>
            </div>
          </>
        )}

        {step === 'error' && error && (
          <>
            <Alert variant="destructive">
              <AlertTitle>Could not join</AlertTitle>
              <AlertDescription>
                {error.message} {error.guidance}
              </AlertDescription>
            </Alert>
            <div className="flex justify-end gap-2">
              <Button variant="outline" asChild>
                <Link to="/login">Back to Login</Link>
              </Button>
              <Button variant="outline" onClick={resetToForm}>
                Try again
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default JoinSyncPage;
