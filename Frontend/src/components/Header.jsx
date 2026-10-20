import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';

export default function Header() {
  const [isDark, setIsDark] = useState(
    document.documentElement.classList.contains('dark')
  );
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDark]);

  useEffect(() => {
    api.get('/auth/me')
      .then(res => setUser(res.data))
      .catch(err => console.error("Could not fetch user info", err));
  }, []);

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    navigate('/auth');
  };

  const roleLabel = (role) =>
    role ? role.charAt(0).toUpperCase() + role.slice(1) : 'Learner';

  return (
    <header className="fixed top-0 right-0 left-64 h-16 z-30 bg-surface/80 backdrop-blur-xl flex justify-between items-center px-8">
      <div className="flex items-center gap-4 bg-surface-container-lowest px-4 py-1.5 rounded-full border border-outline-variant/20 w-96 relative group">
        <span className="material-symbols-outlined text-outline text-sm group-focus-within:text-primary transition-colors">search</span>
        <input className="bg-transparent border-none focus:ring-0 text-sm w-full placeholder:text-outline/50 outline-none text-on-surface" placeholder="Search topics, modules..." type="text" />
        {/* Animated background glow on focus */}
        <div className="absolute inset-0 rounded-full border border-primary/0 group-focus-within:border-primary/50 group-focus-within:shadow-[0_0_15px_rgba(var(--primary),0.3)] pointer-events-none transition-all duration-500"></div>
      </div>

      <div className="flex items-center gap-6">
        <div className="flex items-center gap-4">
          <button 
            onClick={() => setIsDark(!isDark)}
            className="relative flex items-center justify-center w-10 h-10 rounded-full bg-surface-container-high text-outline hover:text-primary hover:shadow-[0_0_15px_rgba(var(--primary),0.4)] transition-all duration-300 scale-95 active:scale-90"
            title="Toggle Theme"
          >
            <span className={`material-symbols-outlined transition-transform duration-500 ${isDark ? 'rotate-0' : 'rotate-180'}`}>
              {isDark ? 'light_mode' : 'dark_mode'}
            </span>
          </button>
          <button className="relative text-outline hover:text-primary transition-all scale-95 active:scale-90">
            <span className="material-symbols-outlined">military_tech</span>
          </button>
          <button className="relative text-outline hover:text-primary transition-all scale-95 active:scale-90">
            <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>bolt</span>
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-primary"></span>
            </span>
          </button>
          <button className="relative text-outline hover:text-primary transition-all scale-95 active:scale-90">
            <span className="material-symbols-outlined">show_chart</span>
          </button>
        </div>

        <div className="h-8 w-[1px] bg-outline-variant/20"></div>

        <div className="flex items-center gap-4 group cursor-pointer relative">
          <div className="text-right hidden sm:block">
            <p className="text-xs font-bold font-headline text-on-surface capitalize">{user ? user.username : 'Initializing...'}</p>
            <p className="text-[9px] tracking-widest text-primary uppercase">{user ? `${roleLabel(user.role)} | ELO ${user.elo_rating}` : 'Logging In'}</p>
          </div>
          <div className="relative w-10 h-10 rounded-full overflow-hidden border-2 border-primary/20 group-hover:border-primary/50 transition-all duration-300">
            <img alt="User Avatar" className="w-full h-full bg-surface-container-high object-cover group-hover:scale-110 transition-transform duration-500" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBq5vJkUsIxgvl0KfqNOpArkxpSUTRJWSUdGKsv_yEQcbKzK-MOtaGRxm4EZxbIUReM1A-d7Hgmo44VcCFubLjM-Z7f0Mi-waf8Rse0NWwuzesvyVc-5xCjF7DpM0crT7YgLp8WPIyqBq2a9PALCzPXJEPAhOACnP8RFwLMwMvIZEZxmERiL2fCsbkN_BDgzI4X4Z2mP3TSNy0FK7_AYHV0O6-p1AWjL1jJl6q4ibl3w7tM0ONdH1Npb5Y-5vk6mMtpgckCgjTIqyo" />
          </div>

          {/* Logout Dropdown (appear on hover) */}
          <div className="absolute top-full right-0 mt-2 w-48 bg-surface-container-lowest border border-outline-variant/20 rounded-xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 overflow-hidden transform origin-top-right scale-95 group-hover:scale-100">
             <button onClick={handleLogout} className="w-full text-left px-4 py-3 text-sm text-error hover:bg-error/10 hover:text-error transition-colors flex items-center gap-2 font-medium">
               <span className="material-symbols-outlined text-sm">logout</span>
               Sign Out Securely
             </button>
          </div>
        </div>
      </div>
    </header>
  );
}
