import { useAuth } from '../contexts/AuthContext';
import { Navigate } from 'react-router-dom';

export default function Dashboard() {
  const { profile, loading } = useAuth();

  if (loading) return null;

  if (profile?.role === 'STUDENT' || profile?.role === 'TEACHER') {
    return <Navigate to="/student" replace />;
  } else if (profile?.role === 'STAFF') {
    return <Navigate to="/staff" replace />;
  } else if (profile?.role === 'ADMIN') {
    return <Navigate to="/admin" replace />;
  }

  return <div>Unknown role</div>;
}
