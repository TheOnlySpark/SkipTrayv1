import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTenant } from '../contexts/TenantContext';
import {
  Utensils,
  ChefHat,
  Store,
  Building2,
  ShieldCheck,
  X,
  Building,
  PanelLeftClose,
  PanelLeft,
  Coffee,
  Users,
  BarChart3,
  MessageSquare,
  ClipboardList,
  History,
  LogOut,
  LayoutDashboard,
  KeyRound,
  Home
} from 'lucide-react';

export interface SideBarProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  className?: string;
}

interface NavItem {
  name: string;
  href: string;
  icon: React.ComponentType<{ className?: string; size?: number }>;
  badge?: string;
  badgeColor?: string;
  description?: string;
  roles?: string[];
  requiresAuth?: boolean;
}

export default function SideBar({
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
  className = ''
}: SideBarProps) {
  const { user, profile } = useAuth();
  const { tenantName, settings } = useTenant();
  const location = useLocation();

  // Role detection
  const role = profile?.role;

  // Build role-tailored navigation items
  const navItems: NavItem[] = [
    // Student / Teacher
    {
      name: 'Dashboard',
      href: '/student',
      icon: LayoutDashboard,
      description: 'Dashboard & food booking',
      roles: ['STUDENT', 'TEACHER', 'SUPER_ADMIN']
    },
    {
      name: 'Order History',
      href: '/student?tab=history',
      icon: History,
      description: 'View past orders & reviews',
      roles: ['STUDENT', 'TEACHER', 'SUPER_ADMIN']
    },
    // Staff (Kitchen)
    {
      name: 'Dashboard',
      href: '/staff',
      icon: LayoutDashboard,
      roles: ['STAFF', 'SUPER_ADMIN']
    },
    {
      name: 'Menu',
      href: '/staff/menu',
      icon: Utensils,
      description: 'View all dishes & toggle availability',
      roles: ['STAFF', 'SUPER_ADMIN']
    },
    {
      name: 'Order Collection',
      href: '/staff/collect',
      icon: KeyRound,
      description: 'Live orders & counter collection',
      roles: ['STAFF', 'SUPER_ADMIN']
    },
    // Canteen Admin
    {
      name: 'Dashboard',
      href: '/canteen-admin',
      icon: LayoutDashboard,
      roles: ['CANTEEN_ADMIN', 'SUPER_ADMIN']
    },
    {
      name: 'Orders',
      href: '/canteen-admin/orders',
      icon: ClipboardList,
      description: 'Filter, search & inspect orders',
      roles: ['CANTEEN_ADMIN', 'SUPER_ADMIN']
    },
    {
      name: 'Menu Management',
      href: '/canteen-admin/menu',
      icon: Utensils,
      description: 'Menu items, stock & prices',
      roles: ['CANTEEN_ADMIN', 'SUPER_ADMIN']
    },
    {
      name: 'Kitchen Staff',
      href: '/canteen-admin/staff',
      icon: Users,
      description: 'Staff credentials & student penalties',
      roles: ['CANTEEN_ADMIN', 'SUPER_ADMIN']
    },
    {
      name: 'Reviews',
      href: '/canteen-admin/reviews',
      icon: MessageSquare,
      description: 'Student ratings & admin replies',
      roles: ['CANTEEN_ADMIN', 'SUPER_ADMIN']
    },
    {
      name: 'Reports',
      href: '/canteen-admin/analytics',
      icon: BarChart3,
      description: 'Sales volume & top sold items',
      roles: ['CANTEEN_ADMIN', 'SUPER_ADMIN']
    },

    // University Admin
    {
      name: 'Home',
      href: '/uni-admin',
      icon: Home,
      description: 'Campus home',
      roles: ['UNI_ADMIN', 'ADMIN', 'SUPER_ADMIN']
    },
    {
      name: 'Manage Canteens',
      href: '/uni-admin/canteens',
      icon: Coffee,
      description: 'Add & manage campus canteens',
      roles: ['UNI_ADMIN', 'ADMIN', 'SUPER_ADMIN']
    },
    {
      name: 'Canteen Admins',
      href: '/uni-admin/admins',
      icon: Users,
      description: 'Create & assign cafeteria admins',
      roles: ['UNI_ADMIN', 'ADMIN', 'SUPER_ADMIN']
    },
    {
      name: 'Weekly Analytics',
      href: '/uni-admin/analytics',
      icon: BarChart3,
      description: 'Sales volume & top selling items',
      roles: ['UNI_ADMIN', 'ADMIN', 'SUPER_ADMIN']
    },
    {
      name: 'Feedback & Reviews',
      href: '/uni-admin/reviews',
      icon: MessageSquare,
      description: 'Student ratings & admin replies',
      roles: ['UNI_ADMIN', 'ADMIN', 'SUPER_ADMIN']
    },
    // Super Admin
    {
      name: 'Tenants Hub',
      href: '/super-admin',
      icon: ShieldCheck,
      description: 'Multi-tenant platform control',
      roles: ['SUPER_ADMIN']
    }
  ];

  // Filter items based on authentication and roles
  const filteredNavItems = navItems.filter(item => {
    if (item.requiresAuth && !user) return false;
    if (item.roles) {
      if (!user) return false;
      if (!role) return false;
      return item.roles.includes(role);
    }
    return true;
  });



  const { signOut } = useAuth();

  // Render navigation list
  const renderNavList = (items: NavItem[], isMobile = false) => {
    return (
      <ul className="space-y-1.5">
        {items.map((item) => {
          const currentFullUrl = location.pathname + (location.search || '');
          const isActive = item.href.includes('?')
            ? currentFullUrl === item.href
            : location.pathname === item.href && !location.search;
          const Icon = item.icon;

          return (
            <li key={item.href} className="relative group">
              <Link
                to={item.href}
                onClick={() => {
                  if (isMobile) onCloseMobile();
                }}
                className={`flex items-center gap-3.5 px-3.5 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 relative ${
                  isActive
                    ? 'bg-[#1d68f2] text-white shadow-md shadow-blue-500/25'
                    : 'text-[#94a9c9] hover:text-white hover:bg-[#133267]'
                } ${collapsed && !isMobile ? 'justify-center px-0' : ''}`}
                title={collapsed && !isMobile ? item.name : undefined}
              >
                <div className={`flex items-center justify-center shrink-0 ${
                  isActive ? 'text-white' : 'text-[#8ba3c7] group-hover:text-white transition-colors'
                }`}>
                  <Icon size={19} />
                </div>

                {(!collapsed || isMobile) && (
                  <div className="flex items-center justify-between flex-1 min-w-0">
                    <span className="truncate tracking-tight">{item.name}</span>
                    {item.badge && (
                      <span className={`text-[10px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded-full border ${
                        isActive
                          ? 'bg-white/20 text-white border-white/30'
                          : 'bg-[#153468] text-[#93c5fd] border-[#1e4585]'
                      }`}>
                        {item.badge}
                      </span>
                    )}
                  </div>
                )}
              </Link>

              {/* Tooltip for desktop collapsed rail mode */}
              {collapsed && !isMobile && (
                <div className="hidden md:block absolute left-full top-1/2 -translate-y-1/2 ml-3 px-3 py-1.5 bg-[#071733] text-white text-xs font-semibold rounded-lg shadow-xl whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-50 border border-[#1b3b72]">
                  <div className="flex items-center gap-1.5">
                    <span>{item.name}</span>
                    {item.badge && (
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-blue-500/30 text-blue-200">
                        {item.badge}
                      </span>
                    )}
                  </div>
                  {item.description && (
                    <div className="text-[10px] text-slate-300 font-normal mt-0.5">
                      {item.description}
                    </div>
                  )}
                  {/* Tooltip Arrow */}
                  <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-[#071733]" />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  const userInitials = profile?.name
    ? profile.name.slice(0, 2).toUpperCase()
    : user?.email
    ? user.email.slice(0, 2).toUpperCase()
    : 'U';

  // Sidebar inner content structure
  const sidebarBody = (isMobile = false) => (
    <div className="flex flex-col h-full bg-[#0b2149] text-white select-none">
      {/* Brand Header */}
      <div className={`flex items-center border-b border-[#14356e] px-4 h-20 shrink-0 ${
        collapsed && !isMobile ? 'justify-center' : 'justify-between'
      }`}>
        <div className="flex items-center gap-2.5 select-none pointer-events-none">
          {/* Collapsed rail mode: App Icon Squircle */}
          {collapsed && !isMobile ? (
            <div className="w-10 h-10 rounded-xl overflow-hidden shadow-md shadow-blue-900/40 shrink-0 border border-blue-400/30">
              <img
                src="/assets/skiptray-icon.png"
                alt="SkipTray"
                className="w-full h-full object-cover"
              />
            </div>
          ) : (
            /* Expanded mode: Clean SkipTray Brand Logo with Chef Hat & Pre Order Food */
            <div className="flex items-center">
              <img
                src="/assets/skiptray-logo-dark-transparent.png"
                alt="SkipTray - Pre Order Food"
                className="h-10 w-auto object-contain object-left"
              />
            </div>
          )}
        </div>

        {/* Mobile close button */}
        {isMobile && (
          <button
            onClick={onCloseMobile}
            className="p-2 text-slate-400 hover:text-white hover:bg-[#14356e] rounded-xl transition-colors"
            aria-label="Close Sidebar"
          >
            <X size={20} />
          </button>
        )}
      </div>


      {/* Navigation Scroll Area */}
      <div className="flex-1 overflow-y-auto px-3 py-4 dark-scrollbar space-y-6">
        <div>
          {renderNavList(filteredNavItems, isMobile)}
        </div>
      </div>

      {/* Decorative Brand Badge: "Good Food Good Mood" matching exact screenshot */}
      {(!collapsed || isMobile) && (
        <div className="px-3 pb-3 mt-auto">
          <div className="relative overflow-hidden rounded-[2rem] bg-[#0d1f42]/90 p-5 shadow-2xl border border-blue-500/10 min-h-[145px] flex flex-col justify-center">
            {/* Organic wavy background layers */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
              <svg
                viewBox="0 0 200 150"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="w-full h-full object-cover opacity-60"
                preserveAspectRatio="none"
              >
                <path
                  d="M0 60 C 50 20, 80 80, 140 40 C 180 10, 200 50, 200 90 L 200 150 L 0 150 Z"
                  fill="#15336c"
                  opacity="0.8"
                />
                <path
                  d="M0 100 C 60 70, 110 130, 200 80 L 200 150 L 0 150 Z"
                  fill="#102754"
                />
              </svg>
            </div>

            {/* Glowing neon-blue Chef Hat Doodle top-right */}
            <div className="absolute top-4 right-4 text-[#38bdf8] drop-shadow-[0_0_8px_rgba(56,189,248,0.5)] transform rotate-6">
              <ChefHat size={34} strokeWidth={2.2} />
            </div>

            {/* Quote content tilted slightly matching design screenshot */}
            <div className="relative z-10 max-w-[155px] transform -rotate-3 select-none">
              <p className="text-white font-extrabold text-[15px] leading-tight tracking-wide drop-shadow-sm font-sans">
                "Better Food<br />
                <span className="inline-block mt-0.5 text-[#38bdf8]">Better Campus"</span>
              </p>
              <div className="text-white font-bold text-sm mt-1 ml-1 tracking-wider opacity-90">
                🍽️
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer Area: Collapse Control merged seamlessly without dividing border */}
      <div className="p-2 bg-[#0b2149] shrink-0">
        {/* Desktop Collapse Control */}
        {!isMobile && (
          <button
            onClick={onToggleCollapse}
            className={`w-full flex items-center gap-2 py-1.5 px-2 rounded-xl text-xs font-medium text-[#7a96bf] hover:text-white hover:bg-[#133267]/60 transition-colors cursor-pointer ${
              collapsed ? 'justify-center' : 'justify-between'
            }`}
            title={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            aria-label={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          >
            {!collapsed && <span className="text-[11px] font-semibold">Collapse Sidebar</span>}
            {collapsed ? <PanelLeft size={16} /> : <PanelLeftClose size={16} />}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* 1. Desktop Sidebar (Hidden on mobile) */}
      <aside
        className={`hidden md:flex flex-col fixed top-0 left-0 bottom-0 z-40 bg-[#0b2149] border-r border-[#14356e] transition-all duration-300 ease-in-out shadow-xl ${
          collapsed ? 'w-20' : 'w-64'
        } ${className}`}
      >
        {sidebarBody(false)}
      </aside>

      {/* 2. Mobile Drawer Backdrop & Container */}
      <div
        className={`md:hidden fixed inset-0 z-50 transition-visibility duration-300 ${
          mobileOpen ? 'visible' : 'invisible pointer-events-none'
        }`}
      >
        {/* Backdrop */}
        <div
          onClick={onCloseMobile}
          className={`fixed inset-0 bg-slate-950/70 backdrop-blur-xs transition-opacity duration-300 ${
            mobileOpen ? 'opacity-100' : 'opacity-0'
          }`}
          aria-hidden="true"
        />

        {/* Sliding Drawer */}
        <div
          className={`fixed top-0 bottom-0 left-0 w-72 max-w-[85vw] bg-[#0b2149] shadow-2xl transition-transform duration-300 ease-out transform ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {sidebarBody(true)}
        </div>
      </div>
    </>
  );
}
