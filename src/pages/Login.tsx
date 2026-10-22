import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Mail, Lock, User, Hash, AlertCircle, CheckCircle, Building, ArrowRight, ArrowLeft, Search, UtensilsCrossed, Sparkles, ShieldCheck, Heart, Coffee, ShoppingBag, Zap, Clock, Smartphone, QrCode } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';
import { isValidEmail, validateRegistration, formatErrorMessage } from '../utils/validation';

type Step = 'LOGIN' | 'REGISTER' | 'FORGOT_PASSWORD' | 'RESET_SENT';

interface TenantOption {
  id: string;
  slug: string;
  name: string;
}

export default function Login() {
  const [step, setStep] = useState<Step>('LOGIN');

  // Login fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);

  // Register fields
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirm, setRegConfirm] = useState('');
  const [regName, setRegName] = useState('');
  const [regIdNumber, setRegIdNumber] = useState('');
  const [showRegPw, setShowRegPw] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);

  // Forgot password
  const [forgotEmail, setForgotEmail] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ [key: string]: string }>({});
  const [success, setSuccess] = useState('');

  // Dynamic tenant discovery state
  const [availableTenants, setAvailableTenants] = useState<TenantOption[]>([]);
  const [fetchingTenants, setFetchingTenants] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const { user, profile, refreshProfile, signUp } = useAuth();
  const { tenantId, tenantSlug, tenantName, settings, error: tenantError, loading: tenantLoading, switchTenant } = useTenant();
  const navigate = useNavigate();

  useEffect(() => {
    if (tenantError === 'NOT_FOUND') {
      setFetchingTenants(true);
      supabase
        .from('tenants')
        .select('id, slug, name')
        .eq('is_active', true)
        .order('name')
        .then(({ data, error }) => {
          if (!error && data) {
            setAvailableTenants(data as TenantOption[]);
          }
          setFetchingTenants(false);
        });
    }
  }, [tenantError]);

  useEffect(() => {
    console.log("Login state:", { user, profile, tenantId });
    if (user && profile) {
      // Prevent navigation if cross-tenant login
      if (profile.role !== 'SUPER_ADMIN' && profile.tenant_id !== tenantId) {
        console.log("Cross tenant login prevented navigation");
        return;
      }

      if (profile.must_change_password) {
        navigate('/reset-password?first_login=true');
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
    setFieldErrors({});

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setFieldErrors({ email: 'Please enter your email address.' });
      setLoading(false);
      return;
    }
    if (!isValidEmail(trimmedEmail)) {
      setFieldErrors({ email: 'Please enter a valid email address (e.g., student@university.edu).' });
      setLoading(false);
      return;
    }
    if (!password) {
      setFieldErrors({ password: 'Please enter your password.' });
      setLoading(false);
      return;
    }

    // Authenticate credentials directly with Supabase Auth (eliminates pre-auth email enumeration)
    const { data: authData, error: signInError } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });

    if (signInError) {
      setError(formatErrorMessage(signInError, 'Invalid email or password. Please try again.'));
      setLoading(false);
      return;
    }

    // Once authenticated, verify that the user belongs to this tenant (or is Super Admin)
    if (authData?.user) {
      const { data: userProfile, error: profileErr } = await supabase
        .from('profiles')
        .select('role, tenant_id')
        .eq('id', authData.user.id)
        .single();

      if (profileErr || !userProfile) {
        await supabase.auth.signOut();
        setError('Unable to load user profile. Please try again or contact support.');
        setLoading(false);
        return;
      }

      if (userProfile.role !== 'SUPER_ADMIN' && tenantId && userProfile.tenant_id !== tenantId) {
        await supabase.auth.signOut();
        setError('This account is not registered with this institution. Please check your institution or register a new account.');
        setLoading(false);
        return;
      }
    }

    await refreshProfile();
    setLoading(false);
  };

  // ── REGISTER ───────────────────────────────────────────────────────────────
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!acceptTerms) {
      setError('Please accept the Terms of Service and Privacy Policy to create an account.');
      return;
    }
    setLoading(true);
    setError('');
    setFieldErrors({});

    const validationErrors = validateRegistration({
      email: regEmail,
      name: regName,
      idNumber: regIdNumber,
      password: regPassword,
      confirmPassword: regConfirm
    });

    if (Object.keys(validationErrors).length > 0) {
      setFieldErrors(validationErrors);
      const firstError = Object.values(validationErrors)[0];
      setError(firstError);
      setLoading(false);
      return;
    }

    if (!tenantId) {
      setError('Unable to determine your organization. Please refresh the page and try again.');
      setLoading(false);
      return;
    }

    const { error: signUpError, userId } = await signUp(regEmail.trim(), regPassword, tenantId);

    if (signUpError) {
      setError(formatErrorMessage(signUpError, 'Registration failed. Please check your details and try again.'));
      setLoading(false);
      return;
    }

    if (userId) {
      // Update profile with name + ID number
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ name: regName.trim(), id_number: regIdNumber.trim() })
        .eq('id', userId);

      if (updateError) {
        setError('Account created, but setting up profile details failed. Please sign in or contact support.');
        setLoading(false);
        return;
      }
    }

    // If email confirmation is required, session might be null
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setSuccess('Account created successfully! Please check your email to verify your account before logging in.');
      setStep('LOGIN');
      setLoading(false);
      return;
    }

    // Navigate via client-side routing
    navigate('/dashboard');
  };

  // ── FORGOT PASSWORD ────────────────────────────────────────────────────────
  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setFieldErrors({});

    const trimmedForgotEmail = forgotEmail.trim();
    if (!trimmedForgotEmail) {
      setFieldErrors({ forgotEmail: 'Please enter your registered email address.' });
      setError('Please enter your registered email address.');
      setLoading(false);
      return;
    }
    if (!isValidEmail(trimmedForgotEmail)) {
      setFieldErrors({ forgotEmail: 'Please enter a valid email address.' });
      setError('Please enter a valid email address.');
      setLoading(false);
      return;
    }

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmedForgotEmail, {
      redirectTo: `${window.location.origin}/reset-password`,
    });

    if (resetError) {
      setError(formatErrorMessage(resetError, 'Failed to send password reset link. Please check your email and try again.'));
    } else {
      setStep('RESET_SENT');
    }
    setLoading(false);
  };

  // ── INACTIVE TENANT GUARD ──────────────────────────────────────────────────
  if (!tenantLoading && tenantError === 'INACTIVE') {
    return (
      <div className="bg-white border border-slate-200 rounded-[2rem] p-8 flex flex-col gap-4 shadow-sm w-full max-w-md mx-auto my-auto">
        <div className="flex flex-col items-center gap-3 text-center py-4">
          <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center">
            <AlertCircle className="w-6 h-6 text-amber-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Organization Inactive</h2>
          <p className="text-slate-500 text-sm leading-relaxed">
            <strong>{tenantName}</strong> is currently inactive on SkipTray.
            Please contact your organization administrator.
          </p>
          <button
            onClick={() => {
              localStorage.removeItem('skiptray_tenant_slug');
              const url = new URL(window.location.href);
              url.searchParams.delete('tenant');
              url.searchParams.delete('slug');
              window.location.href = url.pathname;
            }}
            className="mt-2 px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-xl hover:bg-slate-800 transition"
          >
            Switch Organization
          </button>
        </div>
      </div>
    );
  }

  if (!tenantLoading && tenantError === 'NOT_FOUND') {
    const filteredTenants = availableTenants.filter(t =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.slug.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
      <div className="bg-white border border-slate-200 rounded-[2rem] p-6 md:p-8 flex flex-col gap-5 shadow-sm w-full max-w-md mx-auto my-auto">
        <div className="flex flex-col items-center gap-2 text-center">
          <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-full flex items-center justify-center">
            <Building className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Select Your Organization</h2>
          <p className="text-slate-500 text-sm leading-relaxed">
            {tenantSlug && tenantSlug !== 'system'
              ? `The organization "${tenantSlug}" is not registered on SkipTray.`
              : 'Select your registered institution to sign in:'}
          </p>
        </div>

        {availableTenants.length > 4 && (
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search organizations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
          </div>
        )}

        {fetchingTenants ? (
          <div className="py-8 text-center text-sm text-slate-400">Loading organizations...</div>
        ) : filteredTenants.length > 0 ? (
          <div className="space-y-2 max-h-64 overflow-y-auto pr-0.5">
            {filteredTenants.map((t) => (
              <button
                key={t.id}
                onClick={() => switchTenant(t.slug)}
                className="w-full text-left p-3.5 rounded-xl border border-slate-200 hover:border-indigo-500 hover:bg-indigo-50/50 transition flex items-center justify-between group cursor-pointer"
              >
                <div>
                  <div className="font-semibold text-slate-800 text-sm group-hover:text-indigo-600 transition">
                    {t.name}
                  </div>
                  <div className="text-xs text-slate-400 font-mono">
                    {t.slug}
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition" />
              </button>
            ))}
          </div>
        ) : (
          <div className="py-6 text-center text-sm text-slate-400">
            No active organizations found.
          </div>
        )}
      </div>
    );
  }

  // ── RENDER ─────────────────────────────────────────────────────────────────
  return (
    <div className="w-full max-w-5xl mx-auto my-auto p-2 sm:p-4">
      {/* Canteen OS Container */}
      <div className="bg-[#f8fafc] border border-slate-200/80 rounded-2xl sm:rounded-[2.5rem] shadow-xl sm:shadow-2xl overflow-hidden grid grid-cols-1 lg:grid-cols-12 min-h-0 lg:min-h-[600px]">

        {/* Left Side: Canteen OS Hero Brand & Food Showcase */}
        <div className="hidden lg:flex lg:col-span-6 bg-[#002b66] text-white p-7 sm:p-9 flex-col justify-between relative overflow-hidden">
          {/* Subtle glow / light flare accents */}
          <div className="absolute top-0 right-0 w-80 h-80 bg-blue-500/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -left-20 w-80 h-80 bg-sky-400/20 rounded-full blur-3xl pointer-events-none" />

          {/* Top Branding */}
          <div className="relative z-10 flex items-center">
            <img
              src="/assets/skiptray-logo-dark-transparent.png"
              alt="SkipTray - Pre Order Food"
              className="h-14 w-auto object-contain object-left drop-shadow-md"
            />
          </div>

          {/* Middle: Food Spotlight Banner */}
          <div className="relative z-10 my-8">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/15 text-[11px] font-bold text-sky-200 mb-3.5 tracking-wider uppercase">
              <Sparkles className="w-3.5 h-3.5 text-amber-300" />
              <span>FRESH • TASTY • HYGIENIC</span>
            </div>

            <h2 className="text-3xl sm:text-4xl font-black text-white leading-[1.15] tracking-tight">
              Order Your<br />
              <span className="text-[#38bdf8]">Favourite Food</span>
            </h2>
            <p className="text-xs sm:text-sm text-blue-100/90 mt-2.5 font-medium leading-relaxed max-w-sm">
              Pre-order meals, skip the long counter queues, and pick up hot fresh food right on time!
            </p>

            {/* App Feature Spotlight Card */}
            <div className="mt-6 relative rounded-2xl overflow-hidden border border-white/20 bg-white/10 backdrop-blur-md p-4 shadow-xl flex items-center gap-3.5">
              <div className="w-12 h-12 rounded-xl overflow-hidden shadow-md shrink-0 border border-white/25">
                <img
                  src="/assets/skiptray-icon.png"
                  alt="SkipTray"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="min-w-0 flex-1">
                <span className="text-[10px] uppercase font-extrabold tracking-wider px-2 py-0.5 rounded-md bg-sky-400/20 text-sky-200 border border-sky-400/30 inline-block">
                  About SkipTray
                </span>
                <div className="text-sm font-black text-white truncate mt-1">
                  Smart Campus Dining
                </div>
                <div className="text-xs font-semibold text-blue-100/90 leading-tight mt-0.5">
                  Pre-order, live status & zero queue pickup
                </div>
              </div>
            </div>
          </div>

          {/* Bottom Badges */}
          <div className="relative z-10 pt-4 border-t border-white/10 flex items-center justify-between text-[11px] font-semibold text-blue-100/80">
            <div className="flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Hygienic Kitchen</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Heart className="w-4 h-4 text-pink-400 shrink-0" />
              <span>Happy Diners</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Coffee className="w-4 h-4 text-amber-300 shrink-0" />
              <span>Fast Pickup</span>
            </div>
          </div>
        </div>

        {/* Right Side: Authentication Forms */}
        <div className="lg:col-span-6 bg-white p-5 sm:p-8 lg:p-10 flex flex-col justify-between">
          <div>
            {/* Header / Tenant Context */}
            <div className="flex items-center justify-between mb-5 sm:mb-6 pb-3.5 sm:pb-4 border-b border-slate-100">
              <div>
                <div className="flex items-center gap-2 mb-2 lg:hidden">
                  <img
                    src="/assets/skiptray-logo-transparent.png"
                    alt="SkipTray"
                    className="h-8 w-auto object-contain"
                  />
                </div>
                <span className="text-[10px] sm:text-[11px] font-bold text-blue-600 uppercase tracking-wider block mb-0.5">
                  {tenantName || 'Campus Cafeteria'}
                </span>
                <h1 className="text-xl sm:text-2xl lg:text-3xl font-black text-slate-900 tracking-tight">
                  {step === 'LOGIN' && 'Sign in to SkipTray'}
                  {step === 'REGISTER' && 'Create Your Account'}
                  {step === 'FORGOT_PASSWORD' && 'Reset Password'}
                  {step === 'RESET_SENT' && 'Check Your Inbox'}
                </h1>
                <p className="text-xs sm:text-sm text-slate-500 mt-1">
                  {step === 'LOGIN' && 'Enter your credentials to browse menu and order.'}
                  {step === 'REGISTER' && 'Fill in your details to start ordering food.'}
                  {step === 'FORGOT_PASSWORD' && "We'll send you a password recovery link."}
                  {step === 'RESET_SENT' && `A reset link has been dispatched to ${forgotEmail}.`}
                </p>
              </div>

              {settings?.logo_url && (
                <img
                  src={settings.logo_url}
                  alt={tenantName}
                  className="h-9 max-w-[100px] object-contain hidden sm:block"
                />
              )}
            </div>

            {/* Error Banner */}
            {error && (
              <div className="mb-5 p-3.5 bg-rose-50 text-rose-700 rounded-2xl text-xs sm:text-sm font-semibold border border-rose-200 flex items-center gap-2.5 shadow-xs">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                <span>{error}</span>
              </div>
            )}

            {/* Success Banner */}
            {success && (
              <div className="mb-5 p-3.5 bg-emerald-50 text-emerald-800 rounded-2xl text-xs sm:text-sm font-semibold border border-emerald-200 flex items-center gap-2.5 shadow-xs">
                <CheckCircle className="w-4 h-4 shrink-0 text-emerald-600" />
                <span>{success}</span>
              </div>
            )}

            {/* ── LOGIN FORM ── */}
            {step === 'LOGIN' && (
              <form onSubmit={handleLogin} className="space-y-4" noValidate>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      id="login-email"
                      type="email"
                      placeholder="e.g. madesh@university.edu"
                      value={email}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        if (fieldErrors.email) setFieldErrors(prev => ({ ...prev, email: '' }));
                      }}
                      autoComplete="email"
                      required
                      className={`w-full pl-10 pr-4 py-3 bg-slate-50 border ${fieldErrors.email ? 'border-rose-400 ring-2 ring-rose-400/20 bg-rose-50/20' : 'border-slate-200 hover:border-slate-300'
                        } rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#1d68f2] focus:bg-white transition-all text-sm font-medium text-slate-900 shadow-xs`}
                    />
                  </div>
                  {fieldErrors.email && (
                    <p className="mt-1.5 text-xs font-medium text-rose-600 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {fieldErrors.email}
                    </p>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="block text-xs font-bold text-slate-700 uppercase tracking-wide">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => { setStep('FORGOT_PASSWORD'); setError(''); setFieldErrors({}); }}
                      className="text-xs text-blue-600 hover:text-blue-800 font-bold hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      id="login-password"
                      type={showPw ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => {
                        setPassword(e.target.value);
                        if (fieldErrors.password) setFieldErrors(prev => ({ ...prev, password: '' }));
                      }}
                      autoComplete="current-password"
                      required
                      className={`w-full pl-10 pr-11 py-3 bg-slate-50 border ${fieldErrors.password ? 'border-rose-400 ring-2 ring-rose-400/20 bg-rose-50/20' : 'border-slate-200 hover:border-slate-300'
                        } rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#1d68f2] focus:bg-white transition-all text-sm font-medium text-slate-900 shadow-xs`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPw(!showPw)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                      tabIndex={-1}
                    >
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {fieldErrors.password && (
                    <p className="mt-1.5 text-xs font-medium text-rose-600 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {fieldErrors.password}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  id="login-submit"
                  className="w-full mt-2 px-5 py-3.5 bg-gradient-to-r from-[#1d68f2] to-[#0052cc] hover:from-[#1755c9] hover:to-[#0042a4] text-white text-sm font-extrabold rounded-2xl shadow-lg shadow-blue-600/30 active:scale-98 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {loading ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      <span>Signing in…</span>
                    </>
                  ) : (
                    <>
                      <span>Sign In to SkipTray</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>

                {/* Compact, non-scrolling subtle trust line */}
                <div className="pt-4 flex items-center justify-center gap-4 text-[11px] font-semibold text-slate-400">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-blue-500" />
                    <span>Instant Pickup</span>
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1.5">
                    <QrCode className="w-3.5 h-3.5 text-emerald-500" />
                    <span>Digital Token</span>
                  </span>
                  <span>•</span>
                  <span className="flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Encrypted</span>
                  </span>
                </div>
              </form>
            )}

            {/* ── REGISTER FORM ── */}
            {step === 'REGISTER' && (
              <form onSubmit={handleRegister} className="space-y-3.5" noValidate>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wide">
                    Email Address
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      id="reg-email"
                      type="email"
                      placeholder="you@example.com"
                      value={regEmail}
                      onChange={(e) => {
                        setRegEmail(e.target.value);
                        if (fieldErrors.email) setFieldErrors(prev => ({ ...prev, email: '' }));
                      }}
                      autoComplete="email"
                      required
                      className={`w-full pl-10 pr-4 py-2.5 bg-slate-50 border ${fieldErrors.email ? 'border-rose-400 ring-2 ring-rose-400/20' : 'border-slate-200'
                        } rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1d68f2] text-sm text-slate-900`}
                    />
                  </div>
                  {fieldErrors.email && (
                    <p className="mt-1 text-xs text-rose-600 flex items-center gap-1 font-medium">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {fieldErrors.email}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wide">
                      Full Name
                    </label>
                    <div className="relative">
                      <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        id="reg-name"
                        type="text"
                        placeholder="spark"
                        value={regName}
                        onChange={(e) => {
                          setRegName(e.target.value);
                          if (fieldErrors.name) setFieldErrors(prev => ({ ...prev, name: '' }));
                        }}
                        maxLength={100}
                        required
                        className={`w-full pl-10 pr-4 py-2.5 bg-slate-50 border ${fieldErrors.name ? 'border-rose-400 ring-2 ring-rose-400/20' : 'border-slate-200'
                          } rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1d68f2] text-sm text-slate-900`}
                      />
                    </div>
                    {fieldErrors.name && (
                      <p className="mt-1 text-xs text-rose-600 flex items-center gap-1 font-medium">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {fieldErrors.name}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wide">
                      ID Number
                    </label>
                    <div className="relative">
                      <Hash className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        id="reg-id-number"
                        type="text"
                        placeholder="Student / Staff ID"
                        value={regIdNumber}
                        onChange={(e) => {
                          setRegIdNumber(e.target.value);
                          if (fieldErrors.idNumber) setFieldErrors(prev => ({ ...prev, idNumber: '' }));
                        }}
                        maxLength={20}
                        required
                        className={`w-full pl-10 pr-4 py-2.5 bg-slate-50 border ${fieldErrors.idNumber ? 'border-rose-400 ring-2 ring-rose-400/20' : 'border-slate-200'
                          } rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1d68f2] text-sm text-slate-900`}
                      />
                    </div>
                    {fieldErrors.idNumber && (
                      <p className="mt-1 text-xs text-rose-600 flex items-center gap-1 font-medium">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {fieldErrors.idNumber}
                      </p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wide">
                      Password
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        id="reg-password"
                        type={showRegPw ? 'text' : 'password'}
                        placeholder="Min 8 chars"
                        value={regPassword}
                        onChange={(e) => {
                          setRegPassword(e.target.value);
                          if (fieldErrors.password) setFieldErrors(prev => ({ ...prev, password: '' }));
                        }}
                        autoComplete="new-password"
                        minLength={8}
                        required
                        className={`w-full pl-10 pr-10 py-2.5 bg-slate-50 border ${fieldErrors.password ? 'border-rose-400 ring-2 ring-rose-400/20' : 'border-slate-200'
                          } rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1d68f2] text-sm text-slate-900`}
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
                    {fieldErrors.password && (
                      <p className="mt-1 text-xs text-rose-600 flex items-center gap-1 font-medium">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {fieldErrors.password}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1 uppercase tracking-wide">
                      Confirm
                    </label>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        id="reg-confirm-password"
                        type={showRegPw ? 'text' : 'password'}
                        placeholder="Repeat password"
                        value={regConfirm}
                        onChange={(e) => {
                          setRegConfirm(e.target.value);
                          if (fieldErrors.confirmPassword) setFieldErrors(prev => ({ ...prev, confirmPassword: '' }));
                        }}
                        autoComplete="new-password"
                        required
                        className={`w-full pl-10 pr-4 py-2.5 bg-slate-50 border ${fieldErrors.confirmPassword ? 'border-rose-400 ring-2 ring-rose-400/20' : 'border-slate-200'
                          } rounded-xl focus:outline-none focus:ring-2 focus:ring-[#1d68f2] text-sm text-slate-900`}
                      />
                    </div>
                    {fieldErrors.confirmPassword && (
                      <p className="mt-1 text-xs text-rose-600 flex items-center gap-1 font-medium">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        {fieldErrors.confirmPassword}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex items-start gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="accept-terms"
                    checked={acceptTerms}
                    onChange={(e) => setAcceptTerms(e.target.checked)}
                    required
                    className="mt-0.5 accent-[#1d68f2] w-4 h-4 cursor-pointer shrink-0"
                  />
                  <label htmlFor="accept-terms" className="text-xs text-slate-600 leading-relaxed cursor-pointer select-none">
                    I agree to the <a href="/terms" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-bold">Terms</a> and <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline font-bold">Privacy Policy</a>.
                  </label>
                </div>

                <button
                  type="submit"
                  disabled={loading || !acceptTerms}
                  id="register-submit"
                  className="w-full px-5 py-3 bg-gradient-to-r from-[#1d68f2] to-[#0052cc] hover:from-[#1755c9] hover:to-[#0042a4] text-white text-sm font-extrabold rounded-2xl shadow-lg shadow-blue-600/30 active:scale-98 transition-all cursor-pointer disabled:opacity-50"
                >
                  {loading ? 'Creating Account…' : 'Create Account'}
                </button>

                <button
                  type="button"
                  onClick={() => { setStep('LOGIN'); setError(''); setFieldErrors({}); }}
                  className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition py-1"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Already have an account? Sign In</span>
                </button>
              </form>
            )}

            {/* ── FORGOT PASSWORD FORM ── */}
            {step === 'FORGOT_PASSWORD' && (
              <form onSubmit={handleForgotPassword} className="space-y-4" noValidate>
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wide">
                    Your Registered Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      id="forgot-email"
                      type="email"
                      placeholder="you@example.com"
                      value={forgotEmail}
                      onChange={(e) => {
                        setForgotEmail(e.target.value);
                        if (fieldErrors.forgotEmail) setFieldErrors(prev => ({ ...prev, forgotEmail: '' }));
                      }}
                      required
                      className={`w-full pl-10 pr-4 py-3 bg-slate-50 border ${fieldErrors.forgotEmail ? 'border-rose-400 ring-2 ring-rose-400/20' : 'border-slate-200'
                        } rounded-2xl focus:outline-none focus:ring-2 focus:ring-[#1d68f2] text-sm text-slate-900`}
                    />
                  </div>
                  {fieldErrors.forgotEmail && (
                    <p className="mt-1.5 text-xs font-medium text-rose-600 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      {fieldErrors.forgotEmail}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  id="forgot-submit"
                  className="w-full px-5 py-3.5 bg-gradient-to-r from-[#1d68f2] to-[#0052cc] text-white text-sm font-extrabold rounded-2xl shadow-lg shadow-blue-600/30 hover:opacity-95 transition cursor-pointer disabled:opacity-50"
                >
                  {loading ? 'Sending link…' : 'Send Password Reset Link'}
                </button>

                <button
                  type="button"
                  onClick={() => { setStep('LOGIN'); setError(''); setFieldErrors({}); }}
                  className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 transition"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Return to Sign In</span>
                </button>
              </form>
            )}

            {/* ── RESET SENT CONFIRMATION ── */}
            {step === 'RESET_SENT' && (
              <div className="flex flex-col items-center gap-4 text-center py-6">
                <div className="w-14 h-14 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600 shadow-sm">
                  <CheckCircle className="w-8 h-8" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">Check Your Email</h3>
                <p className="text-slate-600 text-sm max-w-sm leading-relaxed">
                  If that email is registered, we've dispatched a password reset link. Please check your inbox and spam folder.
                </p>
                <button
                  type="button"
                  onClick={() => { setStep('LOGIN'); setError(''); }}
                  className="mt-2 text-sm font-bold text-blue-600 hover:underline"
                >
                  Return to Sign In
                </button>
              </div>
            )}
          </div>

          {/* Footer inside login card */}
          {step === 'LOGIN' && (
            <div className="pt-6 mt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
              <span className="text-slate-500 font-medium">
                Don't have an account yet?
              </span>
              <button
                type="button"
                onClick={() => { setStep('REGISTER'); setError(''); setFieldErrors({}); }}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold rounded-xl transition inline-flex items-center gap-1.5 cursor-pointer"
              >
                <span>Register Here</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-600" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
