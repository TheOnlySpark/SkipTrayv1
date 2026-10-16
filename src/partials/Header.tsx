import React, { useState, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';
import { NotificationBell } from '../components/NotificationBell';
import {
  Menu,
  ChevronDown,
  LogOut,
  Building,
  History,
  Utensils
} from 'lucide-react';

export interface HeaderProps {
  onToggleMobileSidebar: () => void;
  isSidebarCollapsed?: boolean;
  onToggleSidebarCollapse?: () => void;
  title?: string;
  hideSidebarToggle?: boolean;
  className?: string;
}

export default function Header({
  onToggleMobileSidebar,
  hideSidebarToggle = false,
  className = ''
}: HeaderProps) {
  const { user, profile, signOut } = useAuth();
  const { tenantName, settings, error } = useTenant();
  const location = useLocation();
  const navigate = useNavigate();

  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close profile dropdown on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setProfileDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close profile dropdown on ESC key
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setProfileDropdownOpen(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);



  const userInitials = profile?.name
    ? profile.name.slice(0, 2).toUpperCase()
    : user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : 'U';

  const getRoleBadgeStyle = (userRole?: string) => {
    switch (userRole) {
      case 'SUPER_ADMIN':
        return { label: 'Super Admin', style: 'bg-purple-100 text-purple-700 border-purple-200' };
      case 'UNI_ADMIN':
      case 'ADMIN':
        return { label: 'Uni Admin', style: 'bg-indigo-100 text-indigo-700 border-indigo-200' };
      case 'CANTEEN_ADMIN':
        return { label: 'Canteen Admin', style: 'bg-amber-100 text-amber-700 border-amber-200' };
      case 'STAFF':
        return { label: 'Kitchen Staff', style: 'bg-emerald-100 text-emerald-700 border-emerald-200' };
      case 'TEACHER':
        return { label: 'Faculty', style: 'bg-teal-100 text-teal-700 border-teal-200' };
      case 'STUDENT':
        return { label: 'Student', style: 'bg-sky-100 text-sky-700 border-sky-200' };
      default:
        return { label: 'User', style: 'bg-slate-100 text-slate-700 border-slate-200' };
    }
  };

  const roleBadge = getRoleBadgeStyle(profile?.role);

  return (
    <header
      className={`sticky top-0 z-30 w-full h-16 bg-white/85 backdrop-blur-md border-b border-slate-200/80 px-4 sm:px-6 flex items-center justify-between transition-colors shadow-2xs ${className}`}
    >
      {/* Left Area: Mobile menu toggle */}
      <div className="flex items-center gap-3 md:gap-4 min-w-0">
        {/* Mobile Hamburger Drawer Button */}
        {Boolean(user && !hideSidebarToggle) && (
          <button
            type="button"
            onClick={onToggleMobileSidebar}
            className="md:hidden p-2 -ml-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
            aria-label="Open Navigation Drawer"
          >
            <Menu size={22} />
          </button>
        )}
      </div>

      {/* Center Area: Organization / Tenant branding pill (desktop) */}
      <div className="hidden lg:flex items-center gap-2.5 px-3 py-1.5 bg-slate-50 border border-slate-200/80 rounded-xl">
        {error ? (
          <span className="text-xs font-semibold text-rose-500 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-500" />
            No Tenant Assigned
          </span>
        ) : settings?.logo_url ? (
          <div className="flex items-center gap-2">
            <img src={settings.logo_url} alt={tenantName} className="h-6 object-contain" />
            <span className="text-xs font-semibold text-slate-700">{tenantName}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded-md bg-indigo-100 text-indigo-600 flex items-center justify-center">
              <Building size={13} />
            </div>
            <span className="text-xs font-semibold text-slate-700 truncate max-w-[160px]">
              {tenantName}
            </span>
          </div>
        )}

        <div className="w-px h-3.5 bg-slate-200" />

        <div className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <span className="hidden xl:inline">Operational</span>
        </div>
      </div>

      {/* Right Area: Status + Notification Bell + User Profile / Login */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Order History Navigation Option in Header */}
        {user && (profile?.role === 'STUDENT' || profile?.role === 'TEACHER' || location.pathname === '/student') && (
          <div className="flex items-center p-1 bg-slate-100/90 border border-slate-200/80 rounded-xl gap-1 shadow-2xs">
            <Link
              to="/student"
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                location.pathname === '/student' && !location.search.includes('tab=history')
                  ? 'bg-white text-indigo-700 shadow-2xs border border-slate-200/50'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/40'
              }`}
              title="Pre-Order Meals"
            >
              <Utensils size={14} className="shrink-0" />
              <span className="hidden sm:inline">Menu</span>
            </Link>
            <Link
              to="/student?tab=history"
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                location.pathname === '/student' && location.search.includes('tab=history')
                  ? 'bg-white text-indigo-700 shadow-2xs border border-slate-200/50'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/40'
              }`}
              title="View Past Orders & Receipts"
            >
              <History size={14} className="shrink-0" />
              <span className="hidden sm:inline">Order History</span>
            </Link>
          </div>
        )}

        {/* Notification Bell (if user is authenticated) */}
        {user && (
          <div className="relative">
            <NotificationBell />
          </div>
        )}

        {/* User Account / Profile Dropdown */}
        {user ? (
          <div className="relative" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setProfileDropdownOpen(prev => !prev)}
              aria-expanded={profileDropdownOpen}
              aria-haspopup="true"
              className="flex items-center gap-2 p-1 sm:px-2.5 sm:py-1.5 rounded-xl border border-slate-200/80 bg-slate-50/70 hover:bg-slate-100 transition-colors focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-indigo-600 to-violet-600 text-white flex items-center justify-center font-bold text-xs shadow-2xs">
                {userInitials}
              </div>

              <div className="hidden md:flex flex-col text-left min-w-0 max-w-[120px]">
                <span className="text-xs font-bold text-slate-800 truncate">
                  {profile?.name || user.email?.split('@')[0]}
                </span>
                <span className="text-[10px] text-slate-500 truncate">
                  {roleBadge.label}
                </span>
              </div>

              <ChevronDown
                size={14}
                className={`text-slate-400 transition-transform duration-200 ${
                  profileDropdownOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {/* Dropdown Menu Modal */}
            {profileDropdownOpen && (
              <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-xl border border-slate-200/90 py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
                {/* User Info Header */}
                <div className="px-4 py-3 border-b border-slate-100">
                  <div className="flex items-center gap-2.5">
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 text-white flex items-center justify-center font-bold text-sm shadow-xs">
                      {userInitials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-slate-800 truncate">
                        {profile?.name || 'User'}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {user.email}
                      </div>
                    </div>
                  </div>

                  <div className="mt-2.5 flex items-center justify-between">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md border ${roleBadge.style}`}>
                      {roleBadge.label}
                    </span>
                    {profile?.id_number && (
                      <span className="text-[11px] text-slate-400 font-mono">
                        #{profile.id_number}
                      </span>
                    )}
                  </div>
                </div>



                {/* User quick links */}
                {(profile?.role === 'STUDENT' || profile?.role === 'TEACHER' || location.pathname === '/student') && (
                  <div className="py-1 border-b border-slate-100 px-1.5">
                    <Link
                      to="/student?tab=history"
                      onClick={() => setProfileDropdownOpen(false)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 rounded-xl transition-colors text-left"
                    >
                      <History size={15} />
                      <span>Order History</span>
                    </Link>
                  </div>
                )}

                {/* Sign Out Action */}
                <div className="pt-1 border-t border-slate-100 px-1.5">
                  <button
                    type="button"
                    onClick={async () => {
                      setProfileDropdownOpen(false);
                      await signOut();
                      navigate('/login');
                    }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-xl transition-colors text-left"
                  >
                    <LogOut size={15} />
                    <span>Sign Out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* When logged out: Login CTA */
          location.pathname !== '/login' && (
            <Link
              to="/login"
              className="px-4 py-2 bg-indigo-600 text-white text-xs sm:text-sm font-semibold rounded-xl hover:bg-indigo-700 transition shadow-sm flex items-center gap-1.5"
            >
              <span>Login</span>
            </Link>
          )
        )}
      </div>
    </header>
  );
}
