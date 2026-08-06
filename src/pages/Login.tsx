import React from "react";
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<'PHONE' | 'PROFILE'>('PHONE');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Profile completion state
  const [idNumber, setIdNumber] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'STUDENT' | 'TEACHER' | 'STAFF' | 'ADMIN'>('STUDENT');

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
      const password = 'SkipTrayUser123!';
      
      const { data: { user }, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (signInError) {
        if (signInError.message.includes('Invalid login credentials')) {
          // User doesn't exist, go to profile step to collect details for signup
          setStep('PROFILE');
        } else if (signInError.message.toLowerCase().includes('email not confirmed')) {
          setError('Error: "Confirm email" is enabled in Supabase. FIX: Go to Supabase Dashboard > Authentication > Providers > Email, turn OFF "Confirm email". You may need to delete the unconfirmed user from the dashboard and try again.');
        } else {
          setError(signInError.message);
        }
        return;
      }

      if (user) {
        await refreshProfile();
        
        // Double check if the database profile was actually created by the trigger
        const { data: checkProfile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
        if (!checkProfile) {
          setError("Your account exists but your profile is missing! This usually happens if you created the account before running the SQL migrations. Please delete your user from the Supabase Authentication dashboard and try again.");
        }
      }
    } catch (err: any) {
      setError(err.message || 'An unexpected error occurred during login. Check your internet or Supabase URL.');
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
      const password = 'SkipTrayUser123!';

      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
      });

      if (signUpError) {
        if (signUpError.message.toLowerCase().includes('rate limit')) {
          setError('Supabase Rate Limit! Go to Dashboard > Auth > Providers > Email, turn OFF "Confirm email".');
        } else {
          setError(signUpError.message);
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
          id_number: idNumber,
          role
        })
        .eq('id', currentUserId);
        
      if (updateError) {
        setError(updateError.message);
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
    <div className="bg-white border border-slate-200 rounded-[2rem] p-5 md:p-8 flex flex-col justify-between shadow-sm relative overflow-hidden w-full max-w-md mx-auto">
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
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition-all text-slate-900"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-slate-800 mb-2">Role</label>
              <div className="grid grid-cols-2 gap-3">
                <label>
                  <input type="radio" name="role" value="STUDENT" checked={role === 'STUDENT'} onChange={(e) => setRole(e.target.value as any)} className="sr-only peer" />
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center cursor-pointer peer-checked:bg-indigo-50 peer-checked:border-indigo-200 peer-checked:text-indigo-700 text-slate-600 font-semibold text-sm transition-all">Student</div>
                </label>
                <label>
                  <input type="radio" name="role" value="TEACHER" checked={role === 'TEACHER'} onChange={(e) => setRole(e.target.value as any)} className="sr-only peer" />
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center cursor-pointer peer-checked:bg-indigo-50 peer-checked:border-indigo-200 peer-checked:text-indigo-700 text-slate-600 font-semibold text-sm transition-all">Teacher</div>
                </label>
                <label>
                  <input type="radio" name="role" value="STAFF" checked={role === 'STAFF'} onChange={(e) => setRole(e.target.value as any)} className="sr-only peer" />
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center cursor-pointer peer-checked:bg-indigo-50 peer-checked:border-indigo-200 peer-checked:text-indigo-700 text-slate-600 font-semibold text-sm transition-all">Staff</div>
                </label>
                <label>
                  <input type="radio" name="role" value="ADMIN" checked={role === 'ADMIN'} onChange={(e) => setRole(e.target.value as any)} className="sr-only peer" />
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-center cursor-pointer peer-checked:bg-indigo-50 peer-checked:border-indigo-200 peer-checked:text-indigo-700 text-slate-600 font-semibold text-sm transition-all">Admin</div>
                </label>
              </div>
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
