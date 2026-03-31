import { useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery } from '@apollo/client/react';
import { useAuth } from '@/contexts/AuthContext';
import { RESEND_VERIFICATION_EMAIL } from '@/lib/graphql/mutations';
import { GET_IS_WAITLIST_MODE } from '@/lib/graphql/queries';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Home, Loader2, Mail } from 'lucide-react';
import { PasswordRequirements, validatePassword } from '@/components/ui/password-requirements';
import { isCommunity } from '@/lib/config';

const Signup = () => {
  const { signup, isAuthenticated, isLoading: authLoading } = useAuth();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirect');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);
  const [resendMutation] = useMutation(RESEND_VERIFICATION_EMAIL);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const { data: waitlistData } = useQuery(GET_IS_WAITLIST_MODE);
  const isWaitlist = waitlistData?.isWaitlistMode === true;

  if (authLoading) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-background to-primary/10" />
        <Loader2 className="relative z-10 h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isAuthenticated) {
    const destination = redirectTo && redirectTo.startsWith('/') ? redirectTo : '/portal';
    return <Navigate to={destination} replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    const passwordError = validatePassword(password);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    setIsLoading(true);
    const result = await signup(email, password, name || undefined);
    if (result.success) {
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

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 overflow-hidden">
      {/* Animated gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-background to-primary/10" />
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-primary/30 to-transparent rounded-full blur-3xl animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-to-tl from-amber-500/20 to-transparent rounded-full blur-3xl animate-pulse" style={{ animationDuration: '10s', animationDelay: '2s' }} />
        <div className="absolute top-1/4 right-1/4 w-1/2 h-1/2 bg-gradient-to-bl from-primary/20 to-transparent rounded-full blur-3xl animate-pulse" style={{ animationDuration: '12s', animationDelay: '4s' }} />
      </div>

      {/* Content */}
      <div className="relative z-10 mb-8 flex flex-col items-center gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/25">
            <Home className="h-6 w-6 text-primary-foreground" />
          </div>
          <span className="text-2xl font-bold">Homecast</span>
        </div>
        {isWaitlist && (
          <Badge variant="secondary">Waitlist</Badge>
        )}
      </div>

      <Card className="relative z-10 w-full max-w-md border-white/20 bg-background/80 backdrop-blur-xl shadow-2xl">
        {verificationSent ? (
          <>
            <CardHeader className="text-center">
              <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
                <Mail className="h-6 w-6 text-primary" />
              </div>
              <CardTitle className="text-2xl">Check your email</CardTitle>
              <CardDescription>
                We sent a verification link to <strong>{email}</strong>. Click the link to verify your account. It may take a minute to arrive — check your spam or junk folder if you don't see it.
              </CardDescription>
            </CardHeader>
            <CardFooter className="flex flex-col gap-4">
              <Button
                variant="outline"
                className="w-full"
                onClick={handleResend}
                disabled={resending}
              >
                {resending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Resend verification email
              </Button>
              {resendMessage && (
                <p className="text-sm text-muted-foreground text-center">{resendMessage}</p>
              )}
              <p className="text-sm text-muted-foreground">
                Already verified?{' '}
                <Link to={redirectTo ? `/login?redirect=${encodeURIComponent(redirectTo)}` : '/login'} className="text-primary hover:underline">
                  Sign in
                </Link>
              </p>
            </CardFooter>
          </>
        ) : (
          <>
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">{isCommunity ? 'Set up Homecast' : 'Create your account'}</CardTitle>
              <CardDescription>{isCommunity ? 'Create your owner account to get started' : 'Get started with Homecast'}</CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4">
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
                      <Label htmlFor="name">Name (optional)</Label>
                      <Input
                        id="name"
                        type="text"
                        placeholder="John Doe"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email">Email</Label>
                      <Input
                        id="email"
                        type="email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                      />
                    </div>
                  </>
                )}
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <PasswordRequirements password={password} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
              </CardContent>
              <CardFooter className="flex flex-col gap-4">
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Create Account
                </Button>
                <p className="text-sm text-muted-foreground">
                  Already have an account?{' '}
                  <Link to={redirectTo ? `/login?redirect=${encodeURIComponent(redirectTo)}` : '/login'} className="text-primary hover:underline">
                    Sign in
                  </Link>
                </p>
              </CardFooter>
            </form>
          </>
        )}
      </Card>
    </div>
  );
};

export default Signup;
