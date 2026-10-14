import React, { useState, useEffect } from 'react';
import { Outlet, useLocation, Link } from 'react-router-dom';
import SideBar from './SideBar';
import Header from './Header';
import { useTenant } from '../contexts/TenantContext';
import { useAuth } from '../contexts/AuthContext';

export interface BaseLayoutProps {
  children?: React.ReactNode;
  title?: string;
  hideSidebar?: boolean;
  hideHeader?: boolean;
  hideFooter?: boolean;
  fullWidth?: boolean;
  className?: string;
}

export default function BaseLayout({
  children,
  title,
  hideSidebar = false,
  hideHeader = false,
  hideFooter = false,
  fullWidth = false,
  className = ''
}: BaseLayoutProps) {
  const location = useLocation();
  const { tenantName } = useTenant();
  const { user } = useAuth();

  // Load initial collapsed state from localStorage if available
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('skiptray_sidebar_collapsed') === 'true';
    }
    return false;
  });

  // Mobile drawer open state
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Synchronize collapsed state with localStorage
  const handleToggleCollapse = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('skiptray_sidebar_collapsed', String(next));
      }
      return next;
    });
  };

  // Close mobile sidebar whenever route changes
  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [location.pathname]);

  // Determine if on public pages or logged out - if so, hide sidebar for a clean full-width layout
  const isLoginPage = location.pathname === '/login';
  const publicRoutes = ['/', '/login', '/privacy', '/terms'];
  const isPublicPage = publicRoutes.includes(location.pathname);
  const shouldHideSidebar = hideSidebar || !user || isPublicPage;
  const isDedicatedAdminView =
    (location.pathname.startsWith('/uni-admin/') && location.pathname !== '/uni-admin') ||
    (location.pathname.startsWith('/canteen-admin/') && location.pathname !== '/canteen-admin');

  return (
    <div className={`min-h-screen bg-[#f8fafc] flex flex-col font-sans text-slate-900 selection:bg-indigo-500 selection:text-white ${className}`}>
      {/* 1. Sidebar (Desktop rail/expanded + Mobile Drawer) */}
      {!shouldHideSidebar && (
        <SideBar
          collapsed={sidebarCollapsed}
          onToggleCollapse={handleToggleCollapse}
          mobileOpen={mobileSidebarOpen}
          onCloseMobile={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* 2. Main Layout Area with responsive desktop padding for Sidebar */}
      <div
        className={`flex flex-col min-h-screen transition-[padding] duration-300 ease-in-out ${
          shouldHideSidebar
            ? 'pl-0'
            : sidebarCollapsed
            ? 'md:pl-20'
            : 'md:pl-64'
        }`}
      >
        {/* Header Bar */}
        {!hideHeader && (
          <Header
            onToggleMobileSidebar={() => setMobileSidebarOpen(prev => !prev)}
            isSidebarCollapsed={sidebarCollapsed}
            onToggleSidebarCollapse={!shouldHideSidebar ? handleToggleCollapse : undefined}
            hideSidebarToggle={shouldHideSidebar}
            title={title}
          />
        )}

        {/* Page Content Body */}
        <main
          className={`flex-1 w-full flex flex-col items-center ${
            isLoginPage || isDedicatedAdminView ? 'justify-center' : ''
          } ${
            fullWidth
              ? 'p-4 sm:p-6 lg:p-8'
              : isDedicatedAdminView
              ? 'max-w-7xl mx-auto p-2 sm:p-3'
              : 'max-w-7xl mx-auto p-4 sm:p-6 lg:p-8'
          }`}
        >
          {children || <Outlet />}
        </main>

        {/* Modern App Footer */}
        {!hideFooter && !isLoginPage && (
          <footer className="w-full border-t border-slate-200/80 bg-white/60 backdrop-blur-xs py-5 px-6 text-xs text-slate-500 flex flex-col sm:flex-row items-center justify-between gap-3 mt-auto">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-700">SkipTray</span>
              <span className="text-slate-300">•</span>
              <span>&copy; {new Date().getFullYear()} All rights reserved.</span>
              {tenantName && (
                <>
                  <span className="text-slate-300">•</span>
                  <span className="text-slate-400 font-medium truncate max-w-[200px]">
                    {tenantName}
                  </span>
                </>
              )}
            </div>

            <div className="flex items-center gap-4 text-xs font-medium">
              <Link to="/privacy" className="text-slate-500 hover:text-indigo-600 transition-colors">
                Privacy Policy
              </Link>
              <Link to="/terms" className="text-slate-500 hover:text-indigo-600 transition-colors">
                Terms of Service
              </Link>
              <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                v2.4
              </span>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
