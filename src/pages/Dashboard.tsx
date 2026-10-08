import { useAuth } from '../contexts/AuthContext';
import { Navigate } from 'react-router-dom';

export default function Dashboard() {
  const { profile, loading, signOut } = useAuth();

  if (loading) return null;

  if (profile?.role === 'STUDENT' || profile?.role === 'TEACHER') {
    return <Navigate to="/student" replace />;
  } else if (profile?.role === 'STAFF') {
    return <Navigate to="/staff" replace />;
  } else if (profile?.role === 'ADMIN') {
    return <Navigate to="/admin" replace />;
  } else if (profile?.role === 'SUPER_ADMIN') {
    return <Navigate to="/super-admin" replace />;
  } else if (profile?.role === 'UNI_ADMIN') {
    return <Navigate to="/uni-admin" replace />;
  } else if (profile?.role === 'CANTEEN_ADMIN') {
    return <Navigate to="/canteen-admin" replace />;
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
      <div className="text-xl font-semibold text-slate-700">
        Account configuration error. Please contact an administrator.
      </div>
    </div>
  );
}
