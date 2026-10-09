import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Mail, Lock, User, Hash, AlertCircle, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';

type Step = 'LOGIN' | 'REGISTER' | 'FORGOT_PASSWORD' | 'RESET_SENT';

export default function Login() {
  const [step, setStep] = useState<Step>('LOGIN');

  // Login fields
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);

  // Register fields
  const [regEmail, setRegEmail]       = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm]   = useState('');
  const [regName, setRegName]         = useState('');
  const [regIdNumber, setRegIdNumber] = useState('');
  const [showRegPw, setShowRegPw]     = useState(false);

  // Forgot password
  const [forgotEmail, setForgotEmail] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState('');

  const { user, profile, refreshProfile, signUp } = useAuth();
  const { tenantId, tenantName, settings, error: tenantError, loading: tenantLoading } = useTenant();
  const navigate = useNavigate();

  useEffect(() => {
    console.log("Login state:", { user, profile, tenantId });
    if (user && profile) {
      // Prevent navigation if cross-tenant login
      if (profile.role !== 'SUPER_ADMIN' && profile.tenant_id !== tenantId) {
        console.log("Cross tenant login prevented navigation");
        return;
      }

      if (profile.id_number || ['STAFF', 'ADMIN', 'SUPER_ADMIN', 'UNI_ADMIN', 'CANTEEN_ADMIN'].includes(profile.role)) {
        console.log("Navigating to /dashboard");
        navigate('/dashboard');
      } else {
        console.log("Not navigating because role/id_number condition not met.");
      }
    }
  }, [user, profile, navigate, tenantId]);

  // ── LOGIN ──────────────────────────────────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    // 1. Verify they belong to this tenant FIRST (to prevent cross-tenant password guessing)
    const { data: hasAccess, error: accessError } = await supabase.rpc('check_user_tenant_access', {
      p_email: email,
      p_tenant_id: tenantId
    });

    if (accessError) {
      console.error("Access error:", accessError);
      setError('Error verifying account access. Please try again.');
      setLoading(false);
      return;
    }

    if (hasAccess === false) {
      setError('This account is not registered with this institution.');
      setLoading(false);
      return;
    }

    // 2. Only if they belong to this tenant, check their password
    const { data, error: signInError } = await supabase.auth.signInWithPassword({ email, password });

    if (signInError) {
      const errMsg = signInError.message || JSON.stringify(signInError);
      if (errMsg === '{}' || errMsg.trim() === '') {
        setError('Invalid login credentials or account does not exist.');
      } else if (errMsg.toLowerCase().includes('invalid login credentials')) {
        setError('Invalid email or password. Please try again.');
      } else {
        setError(errMsg);
      }
      setLoading(false);
      return;
    }

    await refreshProfile();
    setLoading(false);
  };

  // ── REGISTER ───────────────────────────────────────────────────────────────
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (regPassword !== regConfirm) {
      setError('Passwords do not match.');
      setLoading(false);
      return;
    }

    if (regPassword.length < 8) {
      setError('Password must be at least 8 characters.');
      setLoading(false);
      return;
    }

    if (!tenantId) {
      setError('Unable to determine your organization. Please refresh and try again.');
      setLoading(false);
      return;
    }

    const { error: signUpError, userId } = await signUp(regEmail, regPassword, tenantId);

    if (signUpError) {
      if (signUpError.message?.toLowerCase().includes('already registered')) {
        setError('An account with this email already exists. Please log in instead.');
      } else {
        setError(signUpError.message || 'Registration failed. Please verify your details and try again.');
      }
      setLoading(false);
      return;
    }

    if (userId) {
      // Update profile with name + ID number
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ name: regName, id_number: regIdNumber })
        .eq('id', userId);

      if (updateError) {
        setError('Account created but profile setup failed. Please contact support.');
        setLoading(false);
        return;
      }
    }

    // Hard navigate to trigger a full session reload
    window.location.href = '/dashboard';
  };

  // ── FORGOT PASSWORD ────────────────────────────────────────────────────────
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (resetError) {
      setError(resetError.message);
    } else {
      setStep('RESET_SENT');
    }
    setLoading(false);
  };

  // ── INACTIVE TENANT GUARD ──────────────────────────────────────────────────
  if (!tenantLoading && tenantError === 'INACTIVE') {
    return (
      <div className="bg-white border border-slate-200 rounded-[2rem] p-8 flex flex-col gap-4 shadow-sm w-full max-w-md mx-auto">
        <div className="flex flex-col items-center gap-3 text-center py-4">
          <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-amber-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Organization Inactive</h2>
          <p className="text-slate-500 text-sm leading-relaxed">
            <strong>{tenantName}</strong> is currently inactive on SkipTray.
            Please contact your organization administrator.
          </p>
        </div>
      </div>
    );
  }

  if (!tenantLoading && tenantError === 'NOT_FOUND') {
    return (
      <div className="bg-white border border-slate-200 rounded-[2rem] p-8 flex flex-col gap-4 shadow-sm w-full max-w-md mx-auto">
        <div className="flex flex-col items-center gap-3 text-center py-4">
          <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-red-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Organization Not Found</h2>
          <p className="text-slate-500 text-sm leading-relaxed">
            This subdomain is not registered on SkipTray. Please check your link or contact support.
          </p>
        </div>
      </div>
    );
  }

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="bg-white border border-slate-200 rounded-[2rem] p-5 md:p-8 flex flex-col justify-between shadow-sm relative overflow-hidden w-full max-w-md mx-auto">
      <div className="z-10 relative">

        {/* Tenant branding header */}
        {settings?.logo_url && (
          <img
            src={settings.logo_url}
            alt={tenantName}
            className="h-10 object-contain mb-4"
          />
        )}
        <h2 className="text-2xl font-extrabold text-slate-900 leading-tight mb-1">
          {step === 'LOGIN'            && `Welcome to ${tenantName}`}
          {step === 'REGISTER'         && `Join ${tenantName}`}
          {step === 'FORGOT_PASSWORD'  && 'Reset your password'}
          {step === 'RESET_SENT'       && 'Check your email'}
        </h2>
        <p className="text-slate-500 mb-6 text-sm">
          {step === 'LOGIN'           && 'Sign in to pre-order from the canteen.'}
          {step === 'REGISTER'        && 'Create your account to get started.'}
          {step === 'FORGOT_PASSWORD' && "We'll send you a password reset link."}
          {step === 'RESET_SENT'      && `A reset link has been sent to ${forgotEmail}.`}
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-xl text-sm font-medium border border-red-100 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {success && (
          <div className="mb-4 p-3 bg-green-50 text-green-700 rounded-xl text-sm font-medium border border-green-100 flex items-center gap-2">
            <CheckCircle className="w-4 h-4 shrink-0" />
            {success}
          </div>
        )}

        {/* ── LOGIN FORM ── */}
        {step === 'LOGIN' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-slate-800 mb-2">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="login-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-slate-900"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-800 mb-2">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="login-password"
                  type={showPw ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  className="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-slate-900"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              id="login-submit"
              className="w-full px-4 py-3 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
            <div className="flex justify-between items-center pt-1">
              <button
                type="button"
                onClick={() => { setStep('FORGOT_PASSWORD'); setError(''); }}
                className="text-xs text-indigo-600 hover:underline font-semibold"
              >
                Forgot password?
              </button>
              <button
                type="button"
                onClick={() => { setStep('REGISTER'); setError(''); }}
                className="text-xs text-slate-500 hover:text-slate-800 font-semibold"
              >
                New here? Register →
              </button>
            </div>
          </form>
        )}

        {/* ── REGISTER FORM ── */}
        {step === 'REGISTER' && (
          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-slate-800 mb-2">Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="reg-email"
                  type="email"
                  placeholder="you@example.com"
                  value={regEmail}
                  onChange={(e) => setRegEmail(e.target.value)}
                  autoComplete="email"
                  required
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-slate-900"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-800 mb-2">Full Name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="reg-name"
                  type="text"
                  placeholder="John Doe"
                  value={regName}
                  onChange={(e) => setRegName(e.target.value)}
                  maxLength={100}
                  required
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-slate-900"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-800 mb-2">ID Number</label>
              <div className="relative">
                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="reg-id-number"
                  type="text"
                  placeholder="Employee / Student ID"
                  value={regIdNumber}
                  onChange={(e) => setRegIdNumber(e.target.value)}
                  maxLength={20}
                  required
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-slate-900"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-800 mb-2">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="reg-password"
                  type={showRegPw ? 'text' : 'password'}
                  placeholder="Min. 8 characters"
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={8}
                  required
                  className="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-slate-900"
                />
                <button
                  type="button"
                  onClick={() => setShowRegPw(!showRegPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  tabIndex={-1}
                >
                  {showRegPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-800 mb-2">Confirm Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="reg-confirm-password"
                  type={showRegPw ? 'text' : 'password'}
                  placeholder="Repeat your password"
                  value={regConfirm}
                  onChange={(e) => setRegConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-slate-900"
                />
              </div>
            </div>
            <div className="flex items-start gap-2 pt-1">
              <input
                type="checkbox"
                id="accept-terms"
                required
                className="mt-0.5 accent-indigo-600 w-4 h-4 cursor-pointer shrink-0"
              />
              <label htmlFor="accept-terms" className="text-xs text-slate-600 leading-relaxed cursor-pointer select-none">
                I agree to the <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline font-semibold">Terms of Service</a> and <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline font-semibold">Privacy Policy</a>.
              </label>
            </div>
            <button
              type="submit"
              disabled={loading}
              id="register-submit"
              className="w-full px-4 py-3 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50 mt-2"
            >
              {loading ? 'Creating account…' : 'Create Account'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('LOGIN'); setError(''); }}
              className="w-full text-center text-xs font-bold text-slate-500 mt-2 hover:text-slate-800"
            >
              ← Back to Sign in
            </button>
          </form>
        )}

        {/* ── FORGOT PASSWORD FORM ── */}
        {step === 'FORGOT_PASSWORD' && (
          <form onSubmit={handleForgotPassword} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-slate-800 mb-2">Your Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  id="forgot-email"
                  type="email"
                  placeholder="you@example.com"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  required
                  className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-slate-900"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              id="forgot-submit"
              className="w-full px-4 py-3 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50"
            >
              {loading ? 'Sending…' : 'Send Reset Link'}
            </button>
            <button
              type="button"
              onClick={() => { setStep('LOGIN'); setError(''); }}
              className="w-full text-center text-xs font-bold text-slate-500 mt-2 hover:text-slate-800"
            >
              ← Back to Sign in
            </button>
          </form>
        )}

        {/* ── RESET SENT CONFIRMATION ── */}
        {step === 'RESET_SENT' && (
          <div className="flex flex-col items-center gap-4 text-center py-4">
            <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
            <p className="text-slate-600 text-sm leading-relaxed">
              If that email is registered, you'll receive a reset link shortly.
              Check your spam folder if it doesn't arrive within a minute.
            </p>
            <button
              type="button"
              onClick={() => { setStep('LOGIN'); setError(''); }}
              className="text-sm font-semibold text-indigo-600 hover:underline"
            >
              Return to Sign in
            </button>
          </div>
        )}
      </div>

      {/* Decorative element */}
      <div className="absolute -right-20 -bottom-20 w-80 h-80 bg-indigo-50 rounded-full opacity-50 pointer-events-none" />
    </div>
  );
}
