import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@apollo/client/react';
import { useAuth } from '@/contexts/AuthContext';
import { RESEND_VERIFICATION_EMAIL } from '@/lib/graphql/mutations';
import { GET_IS_WAITLIST_MODE } from '@/lib/graphql/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Eye, EyeOff, Loader2, Mail } from 'lucide-react';
import { PasswordRequirements, validatePassword } from '@/components/ui/password-requirements';
import { isCommunity } from '@/lib/config';
import { getPricing, usePricing } from '@/lib/pricing';
import { parsePlan, rememberSignupPlan, subscribePath, type PaidPlan } from '@/lib/signup-plan';
import { AuthShell, AuthCard, AuthTitle, AuthDescription, AuthLoading, isWebsite } from '@/components/auth/AuthShell';

const PLAN_NAMES: Record<PaidPlan, string> = { standard: 'Standard', cloud: 'Cloud' };

/** The plan picked on the Pricing page, shown so nobody wonders what they're signing up for. */
function PlanSummary({ plan }: { plan: PaidPlan }) {
  const pricing = usePricing() ?? getPricing();
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border bg-muted/40 px-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium">{PLAN_NAMES[plan]} plan</p>
        <p className="text-xs text-muted-foreground">{pricing[plan].formatted}/month · checkout after you verify your email</p>
      </div>
      <Link to="/pricing" className="shrink-0 text-xs font-medium text-primary hover:underline">Change</Link>
    </div>
  );
}

const Signup = () => {
  const { signup, isAuthenticated, isLoading: authLoading } = useAuth();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirect');
  const plan = isCommunity ? null : parsePlan(searchParams.get('plan'));
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [resendMutation] = useMutation(RESEND_VERIFICATION_EMAIL);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const { data: waitlistData } = useQuery(GET_IS_WAITLIST_MODE);
  const isWaitlist = waitlistData?.isWaitlistMode === true;

  if (authLoading) return <AuthLoading />;

  if (isAuthenticated) {
    // Already signed in when they got here: a plan goes straight to checkout.
    // But if this tab sent the verification email, the sign-in came from the
    // link opening in another tab, and that tab is the one they are looking
    // at — it takes them to checkout. Two tabs racing there would leave the
    // one in front on the dashboard.
    const destination = redirectTo && redirectTo.startsWith('/')
      ? redirectTo
      : plan && !verificationSent ? subscribePath(plan) : '/portal';
    return <Navigate to={destination} replace />;
  }

  const loginLink = redirectTo ? `/login?redirect=${encodeURIComponent(redirectTo)}` : '/login';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setIsLoading(true);
    const result = await signup(email, password, name || undefined);
    if (result.success) {
      if (plan) rememberSignupPlan(plan);
      setVerificationSent(true);
    } else {
      setError(result.error || 'Signup failed');
    }
    setIsLoading(false);
  };

  const handleResend = async () => {
    setResending(true);
    setResendMessage('');
    try {
      await resendMutation({ variables: { email } });
      setResendMessage('Verification email sent! Check your inbox.');
    } catch {
      setResendMessage('Failed to resend. Please try again.');
    }
    setResending(false);
  };

  const aside = isWebsite() && !verificationSent
    ? <>Have an account? <Link to={loginLink} className="font-medium text-primary hover:underline">Sign in</Link></>
    : undefined;

  return (
    <AuthShell aside={aside}>
      <AuthCard>
        {verificationSent ? (
          <>
            <CardHeader className="space-y-2">
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Mail className="h-6 w-6 text-primary" />
              </div>
              <AuthTitle>Check your email</AuthTitle>
              <AuthDescription>
                We sent a verification link to <strong className="text-foreground">{email}</strong>.
                {plan
                  ? ` Open it on this device and we'll take you straight to checkout for the ${PLAN_NAMES[plan]} plan.`
                  : ' Click the link to verify your account.'}
                {' '}It may take a minute to arrive — check your spam or junk folder if you don't see it.
              </AuthDescription>
            </CardHeader>
            <CardFooter className="flex flex-col items-stretch gap-4">
              <Button variant="outline" className="w-full" onClick={handleResend} disabled={resending}>
                {resending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Resend verification email
              </Button>
              {resendMessage && (
                <p className="text-sm text-muted-foreground">{resendMessage}</p>
              )}
              <p className="text-sm text-muted-foreground">
                Already verified?{' '}
                <Link to={loginLink} className="text-primary hover:underline">Sign in</Link>
              </p>
            </CardFooter>
          </>
        ) : (
          <>
            <CardHeader className="space-y-2">
              {isWaitlist && <Badge variant="secondary" className="w-fit">Waitlist</Badge>}
              <AuthTitle>{isCommunity ? 'Set up Homecast' : 'Create your account'}</AuthTitle>
              <AuthDescription>
                {isCommunity ? 'Create your owner account to get started.' : "We'll email you a link to confirm your address."}
              </AuthDescription>
            </CardHeader>
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4">
                {plan && <PlanSummary plan={plan} />}
                {isWaitlist && (
                  <div className="rounded-lg border bg-muted/50 p-3 text-sm text-muted-foreground">
                    New accounts are currently waitlisted. We'll email you when your account is activated.
                  </div>
                )}
                {error && (
                  <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                    {error}
                  </div>
                )}
                {isCommunity ? (
                  <div className="space-y-2">
                    <Label htmlFor="email">Username</Label>
                    <Input
                      id="email"
                      type="text"
                      placeholder="admin"
                      value={email}
                      onChange={(e) => setEmail(e.target.value.replace(/\s/g, ''))}
                      autoCapitalize="none"
                      autoCorrect="off"
                      required
                    />
                  </div>
                ) : (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="name">Name <span className="font-normal text-muted-foreground">(optional)</span></Label>
                      <Input
                        id="name"
                        type="text"
                        autoComplete="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>
                  </>
                )}
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pr-11"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(v => !v)}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground hover:text-foreground"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  <PasswordRequirements password={password} />
                </div>
              </CardContent>
              <CardFooter className="flex flex-col items-stretch gap-4">
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  {plan ? `Create account and continue` : 'Create account'}
                </Button>
                {!aside && (
                  <p className="text-sm text-muted-foreground">
                    Already have an account?{' '}
                    <Link to={loginLink} className="text-primary hover:underline">Sign in</Link>
                  </p>
                )}
              </CardFooter>
            </form>
          </>
        )}
      </AuthCard>
    </AuthShell>
  );
};

export default Signup;
