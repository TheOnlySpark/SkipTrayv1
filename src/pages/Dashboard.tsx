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
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-4">
      <div className="text-xl font-semibold text-slate-700">
        Unknown role: {profile === null ? 'null (Profile missing)' : String(profile.role)}
      </div>
      <button 
        onClick={signOut} 
        className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-colors"
      >
        Sign Out
      </button>
    </div>
  );
}
