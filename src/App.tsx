/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { BrowserRouter as Router, Routes, Route, Link, Navigate } from 'react-router-dom';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import StudentDashboard from './pages/StudentDashboard';
import StaffDashboard from './pages/StaffDashboard';
import UniAdminDashboard from './pages/UniAdminDashboard';
import CanteenAdminDashboard from './pages/CanteenAdminDashboard';
import SuperAdminDashboard from './pages/SuperAdminDashboard';
import ResetPassword from './pages/ResetPassword';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import { TenantProvider } from './contexts/TenantContext';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ModalDialogProvider } from './contexts/ModalDialogContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { NotificationToast } from './components/NotificationToast';
import BaseLayout from './partials/BaseLayout';

const queryClient = new QueryClient();

function Landing() {
  const { user } = useAuth();
  if (user) return <Navigate to="/dashboard" replace />;

  return (
    <div className="w-full max-w-4xl py-6">
      <div className="bg-white border border-slate-200 rounded-[2rem] p-8 md:p-12 flex flex-col justify-between shadow-sm relative overflow-hidden">
        <div className="z-10 max-w-xl">
          <span className="px-3 py-1 bg-indigo-50 text-indigo-700 text-xs font-bold uppercase tracking-wider rounded-full border border-indigo-200">
            Smart Campus Dining
          </span>
          <h1 className="text-4xl md:text-5xl font-extrabold text-slate-900 mt-4 mb-6 leading-tight tracking-tight">
            Skip the wait.<br />
            <span className="text-indigo-600">Pre-order</span> your meal.
          </h1>
          <p className="text-slate-600 text-base md:text-lg mb-8 leading-relaxed">
            Order fresh meals in advance from your campus canteens, monitor real-time kitchen queues, and collect your food seamlessly using instant QR verification.
          </p>

          <div className="flex flex-wrap gap-4">
            <Link
              to="/login"
              className="px-6 py-3.5 bg-indigo-600 text-white text-sm font-semibold rounded-xl hover:bg-indigo-700 transition shadow-md shadow-indigo-600/20"
            >
              Get Started
            </Link>
            <Link
              to="/terms"
              className="px-6 py-3.5 bg-slate-100 text-slate-700 text-sm font-semibold rounded-xl hover:bg-slate-200 transition"
            >
              Learn More
            </Link>
          </div>
        </div>
        <div className="absolute -right-20 -bottom-20 w-80 h-80 bg-indigo-50 rounded-full opacity-60 pointer-events-none" />
      </div>
    </div>
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
                <BaseLayout>
                  <Routes>
                    <Route path="/" element={<Landing />} />
                    <Route path="/privacy" element={<PrivacyPolicy />} />
                    <Route path="/terms" element={<TermsOfService />} />
                    <Route path="/login" element={<Login />} />
                    <Route path="/reset-password" element={<ResetPassword />} />
                    <Route
                      path="/dashboard"
                      element={
                        <ProtectedRoute>
                          <Dashboard />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/student"
                      element={
                        <ProtectedRoute allowedRoles={['STUDENT', 'TEACHER']}>
                          <StudentDashboard />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/staff"
                      element={
                        <ProtectedRoute allowedRoles={['STAFF', 'CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN']}>
                          <StaffDashboard />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/staff/menu"
                      element={
                        <ProtectedRoute allowedRoles={['STAFF', 'CANTEEN_ADMIN', 'UNI_ADMIN', 'SUPER_ADMIN']}>
                          <StaffDashboard />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/canteen-admin"
                      element={
                        <ProtectedRoute allowedRoles={['CANTEEN_ADMIN', 'SUPER_ADMIN']}>
                          <CanteenAdminDashboard />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/canteen-admin/orders"
                      element={
                        <ProtectedRoute allowedRoles={['CANTEEN_ADMIN', 'SUPER_ADMIN']}>
                          <CanteenAdminDashboard />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/canteen-admin/menu"
                      element={
                        <ProtectedRoute allowedRoles={['CANTEEN_ADMIN', 'SUPER_ADMIN']}>
                          <CanteenAdminDashboard />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/canteen-admin/analytics"
                      element={
                        <ProtectedRoute allowedRoles={['CANTEEN_ADMIN', 'SUPER_ADMIN']}>
                          <CanteenAdminDashboard />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/canteen-admin/staff"
                      element={
                        <ProtectedRoute allowedRoles={['CANTEEN_ADMIN', 'SUPER_ADMIN']}>
                          <CanteenAdminDashboard />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/canteen-admin/reviews"
                      element={
                        <ProtectedRoute allowedRoles={['CANTEEN_ADMIN', 'SUPER_ADMIN']}>
                          <CanteenAdminDashboard />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/uni-admin"
                      element={
                        <ProtectedRoute allowedRoles={['UNI_ADMIN', 'ADMIN', 'SUPER_ADMIN']}>
                          <UniAdminDashboard />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/uni-admin/canteens"
                      element={
                        <ProtectedRoute allowedRoles={['UNI_ADMIN', 'ADMIN', 'SUPER_ADMIN']}>
                          <UniAdminDashboard />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/uni-admin/admins"
                      element={
                        <ProtectedRoute allowedRoles={['UNI_ADMIN', 'ADMIN', 'SUPER_ADMIN']}>
                          <UniAdminDashboard />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/uni-admin/analytics"
                      element={
                        <ProtectedRoute allowedRoles={['UNI_ADMIN', 'ADMIN', 'SUPER_ADMIN']}>
                          <UniAdminDashboard />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/uni-admin/reviews"
                      element={
                        <ProtectedRoute allowedRoles={['UNI_ADMIN', 'ADMIN', 'SUPER_ADMIN']}>
                          <UniAdminDashboard />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/super-admin"
                      element={
                        <ProtectedRoute allowedRoles={['SUPER_ADMIN']}>
                          <SuperAdminDashboard />
                        </ProtectedRoute>
                      }
                    />
                  </Routes>
                </BaseLayout>
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
