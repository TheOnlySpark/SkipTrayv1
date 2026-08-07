import React from "react";
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

/**
 * Derives a unique per-user password from their phone number and an app secret.
 * This ensures each user has a distinct password rather than a shared hardcoded one.
 */
async function derivePassword(phone: string): Promise<string> {
  const secret = import.meta.env.VITE_AUTH_SECRET || '';
  if (!secret) {
    console.warn('VITE_AUTH_SECRET is not set. Authentication security is degraded.');
  }
  const data = new TextEncoder().encode(phone + secret);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  // Append special chars to meet Supabase password policy (uppercase, lowercase, digit, symbol)
  return hashHex.slice(0, 24) + 'Aa1!';
}

export default function Login() {
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<'PHONE' | 'PROFILE'>('PHONE');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Profile completion state
  const [idNumber, setIdNumber] = useState('');
  const [name, setName] = useState('');

  const { user, profile, refreshProfile } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user && profile) {
      if (profile.id_number || ['STAFF', 'ADMIN'].includes(profile.role)) {
        navigate('/dashboard');
      } else if (!profile.id_number && !['STAFF', 'ADMIN'].includes(profile.role)) {
        setStep('PROFILE');
      }
    }
  }, [user, profile, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    try {
      const formattedPhone = phone.replace(/[^0-9+]/g, '');
      const email = `user${formattedPhone.replace('+', '')}@skiptray.local`;
      const password = await derivePassword(formattedPhone);
      
      const { data: { user }, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (signInError) {
        if (signInError.message.includes('Invalid login credentials')) {
          // User doesn't exist, go to profile step to collect details for signup
          setStep('PROFILE');
        } else if (signInError.message.toLowerCase().includes('email not confirmed')) {
          console.error('Auth config issue: email confirmation is enabled.', signInError);
          setError('Account setup incomplete. Please contact the administrator.');
        } else {
          console.error('Sign in error:', signInError);
          setError('Unable to sign in. Please check your details and try again.');
        }
        return;
      }

      if (user) {
        await refreshProfile();
        
        // Double check if the database profile was actually created by the trigger
        const { data: checkProfile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
        if (!checkProfile) {
          console.error('Profile missing for authenticated user:', user.id);
          setError('Account setup incomplete. Please contact support.');
        }
      }
    } catch (err: any) {
      console.error('Login error:', err);
      setError('An unexpected error occurred. Please check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    let currentUserId = user?.id;

    if (!currentUserId) {
      const formattedPhone = phone.replace(/[^0-9+]/g, '');
      const email = `user${formattedPhone.replace('+', '')}@skiptray.local`;
      const password = await derivePassword(formattedPhone);

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (signUpError) {
        console.error('Sign up error:', signUpError);
        if (signUpError.message.toLowerCase().includes('rate limit')) {
          setError('Too many attempts. Please wait a moment and try again.');
        } else {
          setError('Unable to create account. Please try again later.');
        }
        setLoading(false);
        return;
      }
      currentUserId = signUpData.user?.id;
    }

    if (currentUserId) {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          name,
          id_number: idNumber
        })
        .eq('id', currentUserId);
        
      if (updateError) {
        console.error('Profile update error:', updateError);
        setError('Unable to save profile. Please try again.');
        setLoading(false);
      } else {
        // Manually trigger a hard navigation or wait for context
        await refreshProfile();
        // Since refreshProfile uses state 'user' which might be null for brand new signups, 
        // we can force a session refresh or just redirect and let the ProtectedRoute re-evaluate when session arrives.
        // Actually, if we just reload the page, AuthContext handles it perfectly.
        window.location.href = '/dashboard';
      }
    } else {
      setError("Failed to get user ID.");
      setLoading(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-[2rem] p-8 flex flex-col justify-between shadow-sm relative overflow-hidden w-full max-w-md mx-auto">
      <div className="z-10 relative">
        <h2 className="text-2xl font-extrabold text-slate-900 leading-tight mb-2">Welcome to SkipTray</h2>
        <p className="text-slate-500 mb-6 text-sm">Sign in to pre-order from the canteen.</p>
        
        {error && (
          <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-xl text-sm font-medium border border-red-100">
            {error}
          </div>
        )}

        {step === 'PHONE' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-slate-800 mb-2">Phone Number</label>
              <input
                type="tel"
                placeholder="+1234567890"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                autoComplete="off"
                maxLength={15}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-slate-900"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-3 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50"
            >
              {loading ? 'Continuing...' : 'Continue'}
            </button>
          </form>
        )}

        {step === 'PROFILE' && (
          <form onSubmit={handleCompleteProfile} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-slate-800 mb-2">Full Name</label>
              <input
                type="text"
                placeholder="John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={100}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-slate-900"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-800 mb-2">ID Number</label>
              <input
                type="text"
                placeholder="Student / Staff ID"
                value={idNumber}
                onChange={(e) => setIdNumber(e.target.value)}
                maxLength={20}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-slate-900"
                required
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-3 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors shadow-sm disabled:opacity-50 mt-4"
            >
              {loading ? 'Saving...' : 'Complete Profile'}
            </button>
            <button
              type="button"
              onClick={() => setStep('PHONE')}
              className="w-full text-center text-xs font-bold text-slate-500 mt-4 hover:text-slate-800"
            >
              Back to Phone entry
            </button>
          </form>
        )}
      </div>
      
      {/* Decorative element from Bento Grid */}
      <div className="absolute -right-20 -bottom-20 w-80 h-80 bg-indigo-50 rounded-full opacity-50 pointer-events-none"></div>
    </div>
  );
}
