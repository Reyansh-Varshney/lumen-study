import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import DashboardLayout from './layouts/DashboardLayout';
import Dashboard from './pages/Dashboard';
import Library from './pages/Library';
import Auth from './pages/Auth';
import QuizArena from './pages/QuizArena';
import Arena from './pages/Arena';
import Mentor from './pages/Mentor';
import PracticeTest from './components/PracticeTest';
import Revision from './pages/Revision';

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem('access_token');
  if (!token) {
    return <Navigate to="/auth" replace />;
  }
  return children;
};

function App() {
  return (
    <>
      <Toaster position="top-right" toastOptions={{ duration: 4000, style: { background: '#1e293b', color: '#fff', border: '1px solid #334155' } }} />
      <Router>
      <Routes>
        <Route path="/auth" element={<Auth />} />

        <Route path="/" element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }>
          <Route index element={<Dashboard />} />
          <Route path="dashboard" element={<Navigate to="/" replace />} />
          <Route path="library" element={<Library />} />
          <Route path="vault" element={<Navigate to="/library" replace />} />
          <Route path="quiz" element={<QuizArena />} />
          <Route path="arena" element={<Arena />} />
          <Route path="mentor" element={<Mentor />} />
          <Route path="revision" element={<Revision />} />
        </Route>

        {/* Practice Test (No Sidebar/Header) */}
        <Route path="/practice" element={
          <ProtectedRoute>
            <PracticeTest />
          </ProtectedRoute>
        } />

        {/* Legacy link support */}
        <Route path="/proctored" element={<Navigate to="/practice" replace />} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Router>
    </>
  );
}

export default App;
