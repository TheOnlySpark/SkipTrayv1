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
  ClipboardList
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
      name: 'Order Food',
      href: '/student',
      icon: Utensils,
      badge: 'Menu',
      badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      description: 'Browse canteens & pre-order',
      roles: ['STUDENT', 'TEACHER', 'SUPER_ADMIN']
    },
    // Staff (Kitchen)
    {
      name: 'Kitchen Live',
      href: '/staff',
      icon: ChefHat,
      badge: 'Live',
      badgeColor: 'bg-amber-50 text-amber-700 border-amber-200',
      description: 'Live orders & QR verification',
      roles: ['STAFF', 'SUPER_ADMIN']
    },
    {
      name: 'Menu Availability',
      href: '/staff/menu',
      icon: Utensils,
      badge: 'Items',
      badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      description: 'Quick toggle sold out items',
      roles: ['STAFF', 'SUPER_ADMIN']
    },
    // Canteen Admin
    {
      name: 'Canteen Hub',
      href: '/canteen-admin',
      icon: Store,
      badge: 'Hub',
      badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      description: 'Canteen operations overview',
      roles: ['CANTEEN_ADMIN', 'SUPER_ADMIN']
    },
    {
      name: 'Order List',
      href: '/canteen-admin/orders',
      icon: ClipboardList,
      badge: 'Orders',
      badgeColor: 'bg-blue-50 text-blue-700 border-blue-200',
      description: 'Filter, search & inspect orders',
      roles: ['CANTEEN_ADMIN', 'SUPER_ADMIN']
    },
    {
      name: 'Manage Menu',
      href: '/canteen-admin/menu',
      icon: Utensils,
      badge: 'Menu',
      badgeColor: 'bg-amber-50 text-amber-700 border-amber-200',
      description: 'Menu items, stock & prices',
      roles: ['CANTEEN_ADMIN', 'SUPER_ADMIN']
    },
    {
      name: 'Weekly Analytics',
      href: '/canteen-admin/analytics',
      icon: BarChart3,
      badge: 'Metrics',
      badgeColor: 'bg-purple-50 text-purple-700 border-purple-200',
      description: 'Sales volume & top sold items',
      roles: ['CANTEEN_ADMIN', 'SUPER_ADMIN']
    },
    {
      name: 'Manage Staff',
      href: '/canteen-admin/staff',
      icon: Users,
      badge: 'Staff',
      badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200',
      description: 'Staff credentials & student penalties',
      roles: ['CANTEEN_ADMIN', 'SUPER_ADMIN']
    },
    {
      name: 'Feedback & Reviews',
      href: '/canteen-admin/reviews',
      icon: MessageSquare,
      badge: 'Reviews',
      badgeColor: 'bg-rose-50 text-rose-700 border-rose-200',
      description: 'Student ratings & admin replies',
      roles: ['CANTEEN_ADMIN', 'SUPER_ADMIN']
    },
    // University Admin
    {
      name: 'Campus Admin',
      href: '/uni-admin',
      icon: Building2,
      badge: 'Campus',
      badgeColor: 'bg-blue-50 text-blue-700 border-blue-200',
      description: 'Campus overview & statistics',
      roles: ['UNI_ADMIN', 'ADMIN', 'SUPER_ADMIN']
    },
    {
      name: 'Manage Canteens',
      href: '/uni-admin/canteens',
      icon: Coffee,
      badge: 'Canteens',
      badgeColor: 'bg-amber-50 text-amber-700 border-amber-200',
      description: 'Add & manage campus canteens',
      roles: ['UNI_ADMIN', 'ADMIN', 'SUPER_ADMIN']
    },
    {
      name: 'Canteen Admins',
      href: '/uni-admin/admins',
      icon: Users,
      badge: 'Admins',
      badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200',
      description: 'Create & assign cafeteria admins',
      roles: ['UNI_ADMIN', 'ADMIN', 'SUPER_ADMIN']
    },
    {
      name: 'Weekly Analytics',
      href: '/uni-admin/analytics',
      icon: BarChart3,
      badge: 'Metrics',
      badgeColor: 'bg-purple-50 text-purple-700 border-purple-200',
      description: 'Sales volume & top selling items',
      roles: ['UNI_ADMIN', 'ADMIN', 'SUPER_ADMIN']
    },
    {
      name: 'Feedback & Reviews',
      href: '/uni-admin/reviews',
      icon: MessageSquare,
      badge: 'Reviews',
      badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
      description: 'Student ratings & admin replies',
      roles: ['UNI_ADMIN', 'ADMIN', 'SUPER_ADMIN']
    },
    // Super Admin
    {
      name: 'Tenants Hub',
      href: '/super-admin',
      icon: ShieldCheck,
      badge: 'Master',
      badgeColor: 'bg-purple-50 text-purple-700 border-purple-200',
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



  // Render navigation list
  const renderNavList = (items: NavItem[], isMobile = false) => {
    return (
      <ul className="space-y-1.5">
        {items.map((item) => {
          const isActive = location.pathname === item.href;
          const Icon = item.icon;

          return (
            <li key={item.href} className="relative group">
              <Link
                to={item.href}
                onClick={() => {
                  if (isMobile) onCloseMobile();
                }}
                className={`flex items-center gap-3.5 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 relative ${
                  isActive
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/90'
                } ${collapsed && !isMobile ? 'justify-center px-0' : ''}`}
                title={collapsed && !isMobile ? item.name : undefined}
              >
                <div className={`flex items-center justify-center shrink-0 ${
                  isActive ? 'text-white' : 'text-slate-500 group-hover:text-indigo-600 transition-colors'
                }`}>
                  <Icon size={20} />
                </div>

                {(!collapsed || isMobile) && (
                  <div className="flex items-center justify-between flex-1 min-w-0">
                    <span className="truncate">{item.name}</span>
                    {item.badge && (
                      <span className={`text-[10px] uppercase tracking-wider font-bold px-2 py-0.5 rounded-full border ${
                        isActive
                          ? 'bg-white/20 text-white border-white/30'
                          : item.badgeColor || 'bg-slate-100 text-slate-600 border-slate-200'
                      }`}>
                        {item.badge}
                      </span>
                    )}
                  </div>
                )}
              </Link>

              {/* Tooltip for desktop collapsed rail mode */}
              {collapsed && !isMobile && (
                <div className="hidden md:block absolute left-full top-1/2 -translate-y-1/2 ml-3 px-3 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-lg shadow-xl whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-50">
                  <div className="flex items-center gap-1.5">
                    <span>{item.name}</span>
                    {item.badge && (
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-500/40 text-indigo-200">
                        {item.badge}
                      </span>
                    )}
                  </div>
                  {item.description && (
                    <div className="text-[10px] text-slate-400 font-normal mt-0.5">
                      {item.description}
                    </div>
                  )}
                  {/* Tooltip Arrow */}
                  <div className="absolute right-full top-1/2 -translate-y-1/2 border-4 border-transparent border-r-slate-900" />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    );
  };

  // Sidebar inner content structure
  const sidebarBody = (isMobile = false) => (
    <div className="flex flex-col h-full bg-white text-slate-800">
      {/* Brand Header */}
      <div className={`flex items-center border-b border-slate-200/80 px-4 h-16 shrink-0 ${
        collapsed && !isMobile ? 'justify-center' : 'justify-between'
      }`}>
        <Link
          to="/"
          onClick={() => {
            if (isMobile) onCloseMobile();
          }}
          className="flex items-center gap-3 group focus:outline-hidden"
        >
          {/* Logo icon */}
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20 group-hover:scale-105 transition-transform shrink-0">
            <div className="w-4 h-4 border-2 border-white rounded-sm flex items-center justify-center">
              <div className="w-1.5 h-1.5 bg-white rounded-xs" />
            </div>
          </div>

          {/* Logo text & tenant */}
          {(!collapsed || isMobile) && (
            <div className="flex flex-col min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-lg tracking-tight bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">
                  SkipTray
                </span>
                <span className="text-[10px] font-semibold bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded border border-indigo-200/50">
                  Campus
                </span>
              </div>
              <span className="text-xs text-slate-500 truncate max-w-[130px]">
                {settings?.display_name || tenantName || 'Canteen System'}
              </span>
            </div>
          )}
        </Link>

        {/* Mobile close button */}
        {isMobile && (
          <button
            onClick={onCloseMobile}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
            aria-label="Close Sidebar"
          >
            <X size={20} />
          </button>
        )}

      </div>

      {/* Tenant Indicator Card (when expanded) */}
      {(!collapsed || isMobile) && tenantName && (
        <div className="mx-3 mt-3 p-2.5 rounded-xl bg-slate-50 border border-slate-200/70 flex items-center gap-2.5">
          {settings?.logo_url ? (
            <img
              src={settings.logo_url}
              alt={tenantName}
              className="w-7 h-7 object-contain rounded-md shrink-0 bg-white p-0.5 border border-slate-100"
            />
          ) : (
            <div className="w-7 h-7 rounded-md bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
              <Building size={15} />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-slate-800 truncate">
              {tenantName}
            </div>
            <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Active System
            </div>
          </div>
        </div>
      )}

      {/* Navigation Scroll Area */}
      <div className="flex-1 overflow-y-auto px-3 py-4 custom-scrollbar space-y-6">
        {/* Main Section */}
        <div>
          {(!collapsed || isMobile) && (
            <div className="px-3 mb-2 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
              Navigation
            </div>
          )}
          {renderNavList(filteredNavItems, isMobile)}
        </div>
      </div>

      {/* Footer Area: Collapse Control */}
      {!isMobile && (
        <div className="border-t border-slate-200/80 p-3 bg-slate-50/50 shrink-0">
          <button
            onClick={onToggleCollapse}
            className={`w-full flex items-center gap-2.5 py-2 px-2.5 rounded-xl text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition-colors cursor-pointer ${
              collapsed ? 'justify-center' : 'justify-between'
            }`}
            title={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            aria-label={collapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          >
            {!collapsed && <span>Collapse Sidebar</span>}
            {collapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* 1. Desktop Sidebar (Hidden on mobile) */}
      <aside
        className={`hidden md:flex flex-col fixed top-0 left-0 bottom-0 z-40 bg-white border-r border-slate-200/80 transition-all duration-300 ease-in-out shadow-xs ${
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
          className={`fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity duration-300 ${
            mobileOpen ? 'opacity-100' : 'opacity-0'
          }`}
          aria-hidden="true"
        />

        {/* Sliding Drawer */}
        <div
          className={`fixed top-0 bottom-0 left-0 w-72 max-w-[85vw] bg-white shadow-2xl transition-transform duration-300 ease-out transform ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          {sidebarBody(true)}
        </div>
      </div>
    </>
  );
}
