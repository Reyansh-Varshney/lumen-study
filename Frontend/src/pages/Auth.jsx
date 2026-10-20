import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { APP_NAME, APP_TAGLINE } from '../constants/branding';

const STUDY_LEVELS = [
  'Middle School',
  'High School',
  'Diploma',
  'Undergraduate',
  'Postgraduate',
  'Self-directed',
];

export default function Auth() {
  const [isLogin, setIsLogin] = useState(true);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    grade_level: 'Undergraduate',
    academic_goal: ''
  });
  const [activeSubjects, setActiveSubjects] = useState([]);
  const [subjectInput, setSubjectInput] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    if (localStorage.getItem('access_token')) {
      navigate('/dashboard', { replace: true });
    }
  }, [navigate]);

  const handleInputChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setError('');
  };

  const addSubject = () => {
    const value = subjectInput.trim();
    if (!value) return;
    setActiveSubjects((prev) => {
      const alreadyAdded = prev.some(
        (subject) => subject.toLowerCase() === value.toLowerCase()
      );
      return alreadyAdded ? prev : [...prev, value];
    });
    setSubjectInput('');
    setError('');
  };

  const removeSubject = (name) => {
    setActiveSubjects((prev) => prev.filter((subject) => subject !== name));
  };

  const handleSubjectKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addSubject();
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (isLogin) {
        // FastAPI OAuth2PasswordRequestForm expects email in 'username' field and application/x-www-form-urlencoded
        const params = new URLSearchParams();
        params.append('username', formData.email); // User's email goes into the username field for OAuth2
        params.append('password', formData.password);

        const response = await api.post('/auth/login', params, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        });

        localStorage.setItem('access_token', response.data.access_token);
        navigate('/dashboard');
      } else {
        // Registration expects JSON
        const payload = {
          username: formData.username,
          email: formData.email,
          password: formData.password,
          grade_level: formData.grade_level,
          academic_goal: formData.academic_goal.trim(),
          active_subjects: activeSubjects
        };

        await api.post('/auth/register', payload);

        // Auto switch to login with success message, or auto-login
        // We'll auto-login by calling the login endpoint immediately
        const loginParams = new URLSearchParams();
        loginParams.append('username', formData.email);
        loginParams.append('password', formData.password);

        const loginResponse = await api.post('/auth/login', loginParams, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        localStorage.setItem('access_token', loginResponse.data.access_token);
        navigate('/dashboard');
      }
    } catch (err) {
      if (err.response && err.response.data) {
        setError(err.response.data.detail || 'An error occurred during authentication');
      } else {
        setError('Could not connect to the server');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center items-center relative overflow-hidden selection:bg-primary/30">
      {/* Animated Background Elements */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary/20 rounded-full blur-[120px] mix-blend-screen pointer-events-none animate-pulse"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-secondary/20 rounded-full blur-[120px] mix-blend-screen pointer-events-none animate-pulse delay-1000"></div>

      <div className="z-10 w-full max-w-md">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-primary tracking-tighter font-headline mb-2">{APP_NAME}</h1>
          <p className="text-sm tracking-widest uppercase text-on-surface-variant font-label">{APP_TAGLINE}</p>
        </div>

        <div className="bg-surface-container-low/60 backdrop-blur-xl border border-outline-variant/30 shadow-[0_8px_32px_rgba(6,22,33,0.3)] rounded-2xl p-8 relative">

          {/* Tab Switcher */}
          <div className="flex bg-surface-container-highest p-1 rounded-xl mb-8 relative">
            <button
               onClick={() => { setIsLogin(true); setError(''); }}
               className={`flex-1 py-2 text-sm font-bold font-headline rounded-lg transition-all duration-300 z-10 ${isLogin ? 'text-on-primary shadow-lg' : 'text-on-surface hover:text-primary'}`}
            >
              Log In
            </button>
            <button
               onClick={() => { setIsLogin(false); setError(''); }}
               className={`flex-1 py-2 text-sm font-bold font-headline rounded-lg transition-all duration-300 z-10 ${!isLogin ? 'text-on-primary shadow-lg' : 'text-on-surface hover:text-primary'}`}
            >
              Sign Up
            </button>
            <div className={`absolute top-1 bottom-1 w-[calc(50%-4px)] bg-primary rounded-lg shadow-[0_0_15px_rgba(6,182,212,0.4)] transition-all duration-300 ease-in-out ${isLogin ? 'translate-x-0' : 'translate-x-full left-1'}`}></div>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            {!isLogin && (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold ml-1">Username</label>
                  <input
                    type="text"
                    name="username"
                    required={!isLogin}
                    value={formData.username}
                    onChange={handleInputChange}
                    className="bg-surface-container-highest border border-outline-variant/30 focus:border-primary focus:ring-1 focus:ring-primary text-on-surface px-4 py-3 rounded-xl outline-none transition-all placeholder:text-outline/40"
                    placeholder="e.g. aryabhata_23"
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold ml-1">Study Level</label>
                  <select
                    name="grade_level"
                    value={formData.grade_level}
                    onChange={handleInputChange}
                    className="bg-surface-container-highest border border-outline-variant/30 focus:border-primary focus:ring-1 focus:ring-primary text-on-surface px-4 py-3 rounded-xl outline-none transition-all appearance-none cursor-pointer"
                  >
                    {STUDY_LEVELS.map((level) => (
                      <option key={level} value={level}>{level}</option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold ml-1">Subjects &amp; Topics</label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={subjectInput}
                      onChange={(e) => { setSubjectInput(e.target.value); setError(''); }}
                      onKeyDown={handleSubjectKeyDown}
                      className="flex-1 bg-surface-container-highest border border-outline-variant/30 focus:border-primary focus:ring-1 focus:ring-primary text-on-surface px-4 py-3 rounded-xl outline-none transition-all placeholder:text-outline/40"
                      placeholder="e.g. Organic Chemistry"
                    />
                    <button
                      type="button"
                      onClick={addSubject}
                      className="px-4 py-3 rounded-xl bg-surface-container-highest border border-outline-variant/30 text-on-surface font-bold text-sm hover:text-primary hover:border-primary/50 transition-all"
                    >
                      Add
                    </button>
                  </div>
                  {activeSubjects.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {activeSubjects.map((subject) => (
                        <span
                          key={subject}
                          className="inline-flex items-center gap-1.5 bg-primary/10 text-primary border border-primary/30 rounded-full px-3 py-1 text-xs font-bold"
                        >
                          {subject}
                          <button
                            type="button"
                            onClick={() => removeSubject(subject)}
                            aria-label={`Remove ${subject}`}
                            className="hover:text-error transition-colors"
                          >
                            <span className="material-symbols-outlined text-[14px] leading-none">close</span>
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold ml-1">Study Goal</label>
                  <input
                    type="text"
                    name="academic_goal"
                    value={formData.academic_goal}
                    onChange={handleInputChange}
                    className="bg-surface-container-highest border border-outline-variant/30 focus:border-primary focus:ring-1 focus:ring-primary text-on-surface px-4 py-3 rounded-xl outline-none transition-all placeholder:text-outline/40"
                    placeholder="e.g. Understand calculus fundamentals"
                  />
                </div>
              </>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold ml-1">Email Address</label>
              <input
                type="email"
                name="email"
                required
                value={formData.email}
                onChange={handleInputChange}
                className="bg-surface-container-highest border border-outline-variant/30 focus:border-primary focus:ring-1 focus:ring-primary text-on-surface px-4 py-3 rounded-xl outline-none transition-all placeholder:text-outline/40"
                placeholder="student@school.edu"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold ml-1">Password</label>
              <input
                type="password"
                name="password"
                required
                value={formData.password}
                onChange={handleInputChange}
                className="bg-surface-container-highest border border-outline-variant/30 focus:border-primary focus:ring-1 focus:ring-primary text-on-surface px-4 py-3 rounded-xl outline-none transition-all placeholder:text-outline/40"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <div className="bg-error-container text-on-error-container text-xs p-3 rounded-xl border border-error/20 flex items-center gap-2">
                <span className="material-symbols-outlined text-sm">warning</span>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-4 bg-primary hover:bg-primary-fixed text-on-primary font-bold py-3.5 rounded-xl shadow-[0_0_15px_rgba(6,182,212,0.3)] hover:shadow-[0_0_25px_rgba(6,182,212,0.5)] transition-all flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed group"
            >
              {loading ? (
                <span className="material-symbols-outlined animate-spin">autorenew</span>
              ) : (
                <>
                  {isLogin ? 'Access Gateway' : 'Initialize Account'}
                  <span className="material-symbols-outlined transform group-hover:translate-x-1 transition-transform">arrow_forward</span>
                </>
              )}
            </button>
          </form>

        </div>

        {/* Footer info */}
        <p className="text-center text-xs text-on-surface-variant mt-8 max-w-xs mx-auto">
          By continuing, you agree to the {APP_NAME} terms of use and Privacy Policy.
        </p>
      </div>
    </div>
  );
}
