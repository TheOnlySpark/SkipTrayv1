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
  Utensils,
  Clock,
  Calendar,
  Sparkles,
  Building2
} from 'lucide-react';
import { motion } from 'motion/react';

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
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Live Time state updated every 30s
  const [currentDateTime, setCurrentDateTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentDateTime(new Date()), 30000);
    return () => clearInterval(timer);
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
    <motion.header
      initial={{ opacity: 0, y: -16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className={`w-full h-15 bg-white/95 backdrop-blur-md border border-slate-200/90 rounded-2xl px-2.5 sm:px-4 flex items-center justify-between transition-colors shadow-xs ${className}`}
    >
      {/* Left Area: Mobile Drawer & Useful Context Badges */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        {/* Mobile Hamburger Drawer Button */}
        {Boolean(user && !hideSidebarToggle) && (
          <button
            type="button"
            onClick={onToggleMobileSidebar}
            className="md:hidden p-2 -ml-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            aria-label="Open Navigation Drawer"
          >
            <Menu size={20} />
          </button>
        )}

        {/* Useful Info Pill: Tenant / Campus Name */}
        {tenantName && (
          <div className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 text-xs font-semibold">
            <Building2 size={13} className="text-blue-600 shrink-0" />
            <span className="truncate max-w-[160px] sm:max-w-[220px]">{tenantName}</span>
          </div>
        )}

        {/* Live Service Status Indicator */}
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>Live Service</span>
        </div>
      </div>

      {/* Middle Area: Useful Live Date & Clock display */}
      <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-50/80 border border-slate-200/80 text-xs text-slate-600 font-medium">
        <Calendar size={13} className="text-slate-400" />
        <span>
          {currentDateTime.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
          })}
        </span>
        <span className="text-slate-300">•</span>
        <Clock size={13} className="text-blue-500" />
        <span className="font-bold text-slate-800">
          {currentDateTime.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
          })}
        </span>
      </div>



      {/* Right Area: Notification Bell + User Profile / Login */}
      <div className="flex items-center gap-2.5 sm:gap-3">

        {/* Order History Navigation Option in Header */}
        {user && (profile?.role === 'STUDENT' || profile?.role === 'TEACHER' || location.pathname === '/student') && (
          <div className="flex items-center p-1 bg-slate-50 border border-slate-200 rounded-xl gap-1">
            <Link
              to="/student"
              className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                location.pathname === '/student' && !location.search.includes('tab=history')
                  ? 'bg-[#1d68f2] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
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
                  ? 'bg-[#1d68f2] text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/70'
              }`}
              title="View Past Orders & Receipts"
            >
              <History size={14} className="shrink-0" />
              <span className="hidden sm:inline">Order History</span>
            </Link>
          </div>
        )}

        {/* Notification Bell */}
        {user && (
          <div className="relative text-slate-700">
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
              className="flex items-center gap-2 p-1 sm:px-2.5 sm:py-1.5 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-colors focus:outline-hidden focus:ring-2 focus:ring-blue-500"
            >
              <div className="w-8 h-8 rounded-full bg-[#1d68f2] text-white flex items-center justify-center font-bold text-xs shadow-xs">
                {userInitials}
              </div>

              <div className="hidden md:flex flex-col text-left min-w-0">
                <span className="text-xs font-bold text-slate-800 leading-tight truncate">
                  {profile?.name || user.email?.split('@')[0]}
                </span>
                <span className="text-[10px] text-slate-400 font-medium leading-tight truncate">
                  {roleBadge.label}
                </span>
              </div>

              <ChevronDown
                size={14}
                className={`text-slate-600 transition-transform duration-200 ${
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
    </motion.header>
  );
}
