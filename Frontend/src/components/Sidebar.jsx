import { Link, useLocation } from 'react-router-dom';
import { APP_NAME, APP_TAGLINE } from '../constants/branding';

export default function Sidebar() {
  const location = useLocation();

  const navItems = [
    { name: 'Dashboard', icon: 'dashboard', path: '/' },
    { name: 'Library', icon: 'inventory_2', path: '/library' },
    { name: 'Revision', icon: 'monitoring', path: '/revision' },
    { name: 'Quiz', icon: 'quiz', path: '/quiz' },
    { name: 'Arena', icon: 'sports_esports', path: '/arena' },
    { name: 'Mentor', icon: 'psychology', path: '/mentor' },
    { name: 'Practice Test', icon: 'security', path: '/practice' },
  ];

  return (
    <aside className="h-screen w-64 fixed left-0 top-0 z-40 bg-surface-container-low border-r border-primary/10 shadow-[4px_0_24px_rgba(var(--primary),0.05)] flex flex-col py-6">
      <div className="px-6 mb-10">
        <h1 className="text-2xl font-bold text-primary tracking-tighter font-headline">{APP_NAME}</h1>
        <p className="text-[10px] tracking-widest uppercase text-on-surface-variant font-label mt-1">{APP_TAGLINE}</p>
      </div>

      <nav className="flex-1 space-y-1">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
          return (
            <Link
              key={item.name}
              to={item.path}
              className={`flex items-center gap-3 px-4 py-3 transition-all duration-300 ease-in-out hover:translate-x-1 ${
                isActive 
                  ? 'bg-primary/10 text-primary border-r-2 border-primary font-bold' 
                  : 'text-outline hover:text-on-surface'
              }`}
            >
              <span className="material-symbols-outlined">{item.icon}</span>
              <span className="font-headline text-lg">{item.name}</span>
            </Link>
          );
        })}
      </nav>

      <div className="px-4 mt-auto">
        <button className="w-full py-3 px-4 bg-gradient-to-r from-primary to-primary-container text-on-primary font-bold rounded-xl shadow-lg shadow-primary/20 hover:scale-[1.02] transition-transform">
          Upgrade to Pro
        </button>
        <div className="mt-6 flex items-center gap-3 px-2">
          <img alt="User Profile Avatar" className="w-10 h-10 rounded-full bg-surface-container-high border border-cyan-500/30" src={location.pathname === '/mentor' ? "https://api.dicebear.com/7.x/avataaars/svg?seed=Aris" : "https://lh3.googleusercontent.com/aida-public/AB6AXuAdJ3dOcKznXez6bRdiVao2KA8G_wyIdA8zj3Wymmk4t1kU5XXNfftoSGTitTXavljB036NZXUTX8j9YIeMzsHaLsFh_CNDXtYSpWdFDzgeXud9Kvqt-dALN9t6SgDACdAskX2ErDStGDVFQHv7iAx5oiMwK_abWpPq5_Mj8-5ugmz7qKbNeO5LqOJII5CqPTGWZgv3T7KMyGV1cBoID3ntc_qNeGsmp2qROCvrVIMCN8bfjNhTtNmom-I_eadtJPhfwtRbJTW4J4c"} />
          <div className="overflow-hidden">
            <p className="text-sm font-bold truncate">{location.pathname === '/mentor' ? 'Dr. Aris Thorne' : 'Alex Chen'}</p>
            <p className="text-[10px] text-slate-500 uppercase tracking-tighter">{location.pathname === '/mentor' ? 'Senior Lead Mentor' : 'Active Learner'}</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
