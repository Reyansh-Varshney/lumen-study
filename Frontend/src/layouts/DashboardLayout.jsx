import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';

export default function DashboardLayout() {
  return (
    <div className="bg-background text-on-surface font-body selection:bg-primary/30 min-h-screen">
      <Sidebar />
      <Header />
      <main className="ml-64 pt-24 pb-12 px-8 min-h-screen">
        <Outlet />
      </main>
    </div>
  );
}
