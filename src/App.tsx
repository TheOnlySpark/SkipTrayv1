/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route, Link, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import StudentDashboard from './pages/StudentDashboard';
import StaffDashboard from './pages/StaffDashboard';
import AdminDashboard from './pages/AdminDashboard';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';

function NavigationHeader() {
  const { user } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  return (
    <header className="flex flex-col w-full max-w-4xl mb-8 px-4 relative z-50">
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-white rounded-sm"></div>
          </div>
          <Link to="/" className="font-bold text-2xl tracking-tight text-slate-800">SkipTray</Link>
        </div>

        {/* Desktop Nav */}
        <div className="hidden md:flex gap-4 items-center">
          {!user && (
            <Link to="/login" className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition">
              Login
            </Link>
          )}
          {user && (
            <Link to="/dashboard" className="px-4 py-2 bg-slate-100 text-slate-700 text-sm font-semibold rounded-lg hover:bg-slate-200 transition">
              Dashboard
            </Link>
          )}
        </div>

        {/* Mobile Toggle */}
        <button 
          className="md:hidden p-2 text-slate-600"
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Nav Dropdown */}
      {isOpen && (
        <div className="md:hidden absolute top-full left-4 right-4 mt-2 p-4 bg-white rounded-2xl shadow-xl border border-slate-100 flex flex-col gap-2 z-50">
          <Link to="/" onClick={() => setIsOpen(false)} className="px-4 py-3 text-slate-700 font-medium hover:bg-slate-50 rounded-xl">Home</Link>
          {!user && (
            <Link to="/login" onClick={() => setIsOpen(false)} className="px-4 py-3 bg-indigo-50 text-indigo-700 font-semibold rounded-xl text-center mt-2">Login</Link>
          )}
          {user && (
            <Link to="/dashboard" onClick={() => setIsOpen(false)} className="px-4 py-3 bg-indigo-50 text-indigo-700 font-semibold rounded-xl text-center mt-2">Dashboard</Link>
          )}
        </div>
      )}
    </header>
  );
}

function Landing() {
  const { user } = useAuth();
  if (user) return <Navigate to="/dashboard" replace />;

  return (
    <div className="w-full max-w-4xl">
      <div className="bg-white border border-slate-200 rounded-[2rem] p-8 flex flex-col justify-between shadow-sm relative overflow-hidden">
        <div className="z-10">
          <h1 className="text-4xl font-extrabold text-slate-900 mt-4 mb-8 leading-tight">Skip the wait.<br />Pre-order your meal.</h1>

          <div className="flex gap-4">
            <Link to="/login" className="px-6 py-3 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition-colors shadow-sm">
              Get Started
            </Link>
          </div>
        </div>
        <div className="absolute -right-20 -bottom-20 w-80 h-80 bg-indigo-50 rounded-full opacity-50"></div>
      </div>
    </div>
  );
}

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ModalDialogProvider } from './contexts/ModalDialogContext';

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ModalDialogProvider>
          <Router>
            <div className="min-h-screen bg-[#f8fafc] flex flex-col items-center font-sans text-slate-900 p-4 pt-6 md:p-6 md:pt-12">
              <NavigationHeader />

              <main className="w-full flex-grow flex flex-col items-center justify-center">
                <Routes>
                  <Route path="/" element={<Landing />} />
                  <Route path="/privacy" element={<PrivacyPolicy />} />
                  <Route path="/terms" element={<TermsOfService />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/dashboard" element={
                    <ProtectedRoute>
                      <Dashboard />
                    </ProtectedRoute>
                  } />
                  <Route path="/student" element={
                    <ProtectedRoute allowedRoles={['STUDENT', 'TEACHER']}>
                      <StudentDashboard />
                    </ProtectedRoute>
                  } />
                  <Route path="/staff" element={
                    <ProtectedRoute allowedRoles={['STAFF', 'ADMIN']}>
                      <StaffDashboard />
                    </ProtectedRoute>
                  } />
                  <Route path="/admin" element={
                    <ProtectedRoute allowedRoles={['ADMIN']}>
                      <AdminDashboard />
                    </ProtectedRoute>
                  } />
                </Routes>
              </main>

              <footer className="w-full max-w-4xl mt-12 py-4 border-t border-slate-200 flex justify-between items-center text-[10px] text-slate-400 uppercase tracking-widest">
                <span>&copy; 2026 SkipTray</span>
                <div className="flex gap-4">
                  <Link to="/privacy" className="hover:text-slate-600 transition-colors">Privacy</Link>
                  <Link to="/terms" className="hover:text-slate-600 transition-colors">Terms</Link>
                </div>
              </footer>
            </div>
          </Router>
        </ModalDialogProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
