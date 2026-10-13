/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route, Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import { useState, useEffect } from 'react';
import { Menu, X, LayoutDashboard, LogOut, History, ShoppingCart, User } from 'lucide-react';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import StudentDashboard from './pages/StudentDashboard';
import StaffDashboard from './pages/StaffDashboard';
import UniAdminDashboard from './pages/UniAdminDashboard';
import CanteenAdminDashboard from './pages/CanteenAdminDashboard';
import SuperAdminDashboard from './pages/SuperAdminDashboard';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import { TenantProvider, useTenant } from './contexts/TenantContext';

function NavigationHeader() {
  const { user, signOut } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [cartCount, setCartCount] = useState(0);
  const location = useLocation();
  const navigate = useNavigate();
  const isLoginPage = location.pathname === '/login';

  const isHistoryRoute =
    location.pathname === '/orders' ||
    location.pathname === '/history' ||
    new URLSearchParams(location.search).get('tab') === 'history' ||
    new URLSearchParams(location.search).get('view') === 'history';

  useEffect(() => {
    const handleCartCount = (e: any) => setCartCount(Number(e.detail) || 0);
    window.addEventListener('skiptray:cart-count', handleCartCount);
    return () => window.removeEventListener('skiptray:cart-count', handleCartCount);
  }, []);

  const handleCartClick = () => {
    if (location.pathname === '/student') {
      window.dispatchEvent(new CustomEvent('skiptray:toggle-cart'));
    } else {
      navigate('/student');
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('skiptray:open-cart'));
      }, 150);
    }
  };

  return (
    <header className="flex flex-col w-full max-w-4xl mb-8 px-4 relative z-40">
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
            <div className="w-4 h-4 border-2 border-white rounded-sm"></div>
          </div>
          <Link to="/" className="font-bold text-2xl tracking-tight text-slate-800">SkipTray</Link>
        </div>

        {/* Desktop Nav */}
        <div className="hidden md:flex gap-4 items-center">
          {!user && !isLoginPage && (
            <Link to="/login" className="px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition">
              Login
            </Link>
          )}
        </div>

        {/* Mobile Toggle */}
        <button
          type="button"
          aria-label={isOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={isOpen}
          aria-controls="mobile-navigation"
          className="md:hidden p-2 text-slate-600 rounded-lg focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          onClick={() => setIsOpen(!isOpen)}
        >
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Nav Dropdown */}
      {isOpen && (
        <div id="mobile-navigation" className="md:hidden absolute top-full left-4 right-4 mt-2 p-4 bg-white rounded-2xl shadow-xl border border-slate-100 flex flex-col gap-2 z-50">
          <Link to="/" onClick={() => setIsOpen(false)} className="px-4 py-3 text-slate-700 font-medium hover:bg-slate-50 rounded-xl">Home</Link>
          {!user && !isLoginPage && (
            <Link to="/login" onClick={() => setIsOpen(false)} className="px-4 py-3 bg-indigo-50 text-indigo-700 font-semibold rounded-xl text-center mt-2">Login</Link>
          )}
          {user && (
            <>
              <Link to="/dashboard" onClick={() => setIsOpen(false)} className="px-4 py-3 text-slate-700 font-medium hover:bg-slate-50 rounded-xl flex items-center gap-2">
                <LayoutDashboard size={18} className="text-slate-500" />
                <span>Dashboard</span>
              </Link>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  handleCartClick();
                }}
                className="px-4 py-3 text-slate-700 font-medium hover:bg-slate-50 rounded-xl flex items-center gap-2 text-left w-full"
              >
                <ShoppingCart size={18} className="text-slate-500" />
                <span>Cart</span>
                {cartCount > 0 && (
                  <span className="ml-auto px-2 py-0.5 bg-indigo-600 text-white text-xs font-bold rounded-full">
                    {cartCount}
                  </span>
                )}
              </button>
              <Link
                to="/orders"
                onClick={() => setIsOpen(false)}
                className={`px-4 py-3 font-semibold rounded-xl flex items-center gap-2 ${
                  isHistoryRoute ? 'bg-indigo-600 text-white' : 'text-indigo-600 bg-indigo-50 hover:bg-indigo-100'
                }`}
              >
                <History size={18} />
                <span>Order History</span>
              </Link>
              <button
                type="button"
                onClick={() => {
                  setIsOpen(false);
                  signOut();
                }}
                className="px-4 py-3 text-red-600 font-medium hover:bg-red-50 rounded-xl flex items-center gap-2 text-left w-full mt-1 border-t border-slate-100"
              >
                <LogOut size={18} />
                <span>Sign out</span>
              </button>
            </>
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
import { NotificationProvider } from './contexts/NotificationContext';
import { NotificationToast } from './components/NotificationToast';
import { NotificationBell } from './components/NotificationBell';

const queryClient = new QueryClient();

function TopStickyHeader() {
  const { user, profile, signOut } = useAuth();
  const { tenantName, settings, error } = useTenant();
  const location = useLocation();
  const navigate = useNavigate();
  const isLoginPage = location.pathname === '/login';

  const [cartCount, setCartCount] = useState(0);

  useEffect(() => {
    const handleCartCount = (e: any) => setCartCount(Number(e.detail) || 0);
    window.addEventListener('skiptray:cart-count', handleCartCount);
    return () => window.removeEventListener('skiptray:cart-count', handleCartCount);
  }, []);

  const isHistoryRoute =
    location.pathname === '/orders' ||
    location.pathname === '/history' ||
    new URLSearchParams(location.search).get('tab') === 'history' ||
    new URLSearchParams(location.search).get('view') === 'history';

  const handleCartClick = () => {
    if (location.pathname === '/student') {
      window.dispatchEvent(new CustomEvent('skiptray:toggle-cart'));
    } else {
      navigate('/student');
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('skiptray:open-cart'));
      }, 150);
    }
  };

  return (
    <header className={`fixed top-0 left-0 w-full z-[100] bg-white border-b border-slate-200 shadow-sm py-2 px-3 md:py-2.5 md:px-6 flex items-center ${isLoginPage ? 'justify-center' : 'justify-between'}`}>
      {/* 1. Logo / Brand on the far left */}
      <div className="flex items-center gap-2 md:gap-4 shrink-0">
        <Link to="/" className="flex items-center gap-2 md:gap-3 group focus:outline-none">
          {error ? (
            <span className="font-bold text-base md:text-xl text-slate-400 tracking-tight">System / No Tenant</span>
          ) : settings?.logo_url ? (
            <img src={settings.logo_url} alt={tenantName || 'SkipTray'} className="h-7 md:h-9 object-contain" />
          ) : (
            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white shadow-sm group-hover:bg-indigo-700 transition">
              <div className="w-4 h-4 border-2 border-white rounded-sm"></div>
            </div>
          )}
          <span className="font-bold text-base md:text-xl text-slate-800 tracking-tight group-hover:text-indigo-600 transition-colors">
            {tenantName || 'SkipTray'}
          </span>
        </Link>
      </div>

      {/* Top-Right Header Elements: [Existing Navigation] [Cart] [Order History] [Profile] */}
      {!isLoginPage && user && (
        <div className="flex items-center gap-1 sm:gap-1.5 md:gap-2.5">
          {/* [Existing Navigation]: NotificationBell + Dashboard */}
          <NotificationBell />
          <Link
            to="/dashboard"
            className={`px-2.5 py-1.5 md:px-3 md:py-2 text-xs md:text-sm font-semibold rounded-lg transition flex items-center gap-1.5 ${
              location.pathname === '/dashboard' || (location.pathname === '/student' && !isHistoryRoute)
                ? 'bg-indigo-50 text-indigo-700'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
            title="Dashboard"
          >
            <LayoutDashboard size={16} className="shrink-0" />
            <span className="hidden sm:inline">Dashboard</span>
          </Link>

          {/* [Cart] (immediately before Order History) */}
          <button
            type="button"
            onClick={handleCartClick}
            className="px-2.5 py-1.5 md:px-3 md:py-2 text-xs md:text-sm font-semibold rounded-lg text-slate-600 hover:text-indigo-600 hover:bg-indigo-50/70 transition flex items-center gap-1.5 relative"
            title="Cart"
            aria-label="Shopping Cart"
          >
            <ShoppingCart size={16} className="shrink-0" />
            <span className="hidden sm:inline">Cart</span>
            {cartCount > 0 && (
              <span className="min-w-[1.125rem] h-4.5 px-1 bg-indigo-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {cartCount}
              </span>
            )}
          </button>

          {/* [Order History] (immediately after Cart and before Profile) */}
          <Link
            to="/orders"
            className={`px-2.5 py-1.5 md:px-3 md:py-2 text-xs md:text-sm font-semibold rounded-lg transition flex items-center gap-1.5 ${
              isHistoryRoute
                ? 'bg-indigo-600 text-white shadow-sm ring-1 ring-indigo-500'
                : 'text-slate-600 hover:text-indigo-600 hover:bg-indigo-50/70'
            }`}
            title="Order History"
          >
            <History size={16} className="shrink-0" />
            <span className="hidden sm:inline">Order History</span>
          </Link>

          {/* [Profile] (immediately after Order History) */}
          <div className="flex items-center gap-1 sm:gap-1.5">
            <div
              className="px-2 py-1.5 text-xs md:text-sm font-medium text-slate-700 bg-slate-50 border border-slate-200/80 rounded-lg flex items-center gap-1.5"
              title={`Account: ${profile?.name || user?.email}`}
            >
              <User size={15} className="text-slate-500 shrink-0" />
              <span className="hidden md:inline max-w-[110px] truncate">
                {profile?.name || user?.email?.split('@')[0] || 'Profile'}
              </span>
            </div>
            <button
              onClick={signOut}
              className="px-2.5 py-1.5 md:px-3 md:py-2 bg-slate-100 text-slate-700 text-xs md:text-sm font-semibold rounded-lg hover:bg-red-50 hover:text-red-600 transition flex items-center gap-1.5"
              title="Sign out"
            >
              <LogOut size={16} className="shrink-0" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
      )}
    </header>
  );
}

export default function App() {
  return (
    <TenantProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <NotificationProvider>
            <ModalDialogProvider>
              <Router basename={import.meta.env.BASE_URL}>
                <NotificationToast />
                <div className="min-h-screen bg-[#f8fafc] flex flex-col items-center font-sans text-slate-900 p-4 pt-20 md:p-6 md:pt-24">
                <TopStickyHeader />
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
                  <Route path="/orders" element={
                    <ProtectedRoute allowedRoles={['STUDENT', 'TEACHER', 'STAFF', 'CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN']}>
                      <StudentDashboard defaultView="history" />
                    </ProtectedRoute>
                  } />
                  <Route path="/history" element={
                    <ProtectedRoute allowedRoles={['STUDENT', 'TEACHER', 'STAFF', 'CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN']}>
                      <StudentDashboard defaultView="history" />
                    </ProtectedRoute>
                  } />
                  <Route path="/staff" element={
                    <ProtectedRoute allowedRoles={['STAFF', 'CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN']}>
                      <StaffDashboard />
                    </ProtectedRoute>
                  } />
                  <Route path="/canteen-admin" element={
                    <ProtectedRoute allowedRoles={['CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN']}>
                      <CanteenAdminDashboard />
                    </ProtectedRoute>
                  } />
                  <Route path="/uni-admin" element={
                    <ProtectedRoute allowedRoles={['UNI_ADMIN', 'SUPER_ADMIN', 'ADMIN']}>
                      <UniAdminDashboard />
                    </ProtectedRoute>
                  } />
                  <Route path="/super-admin" element={
                    <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                      <SuperAdminDashboard />
                    </ProtectedRoute>
                  } />
                </Routes>
              </main>

              <footer className="w-full max-w-4xl mt-12 py-6 border-t border-slate-200 flex flex-col md:flex-row justify-between items-center gap-4 text-[10px] text-slate-400 uppercase tracking-widest">
                <div className="flex items-center gap-4">
                  <span>&copy; 2026 SkipTray</span>
                </div>
                <div className="flex gap-4">
                  <Link to="/privacy" className="hover:text-slate-600 transition-colors">Privacy</Link>
                  <Link to="/terms" className="hover:text-slate-600 transition-colors">Terms</Link>
                </div>
              </footer>
            </div>
            <Analytics />
            <SpeedInsights />
          </Router>
        </ModalDialogProvider>
        </NotificationProvider>
      </AuthProvider>
    </QueryClientProvider>
    </TenantProvider>
  );
}
