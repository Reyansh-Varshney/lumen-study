import React, { useState, useEffect } from 'react';
import { 
  Users, 
  TrendingUp, 
  Zap, 
  AlertTriangle, 
  ArrowRight, 
  Search, 
  MoreVertical,
  BrainCircuit,
  Target,
  BarChart3,
  ChevronRight
} from 'lucide-react';

const Mentor = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [stats, setStats] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [statsRes, alertsRes, rosterRes] = await Promise.all([
          fetch('http://localhost:8000/mentor/stats'),
          fetch('http://localhost:8000/mentor/alerts'),
          fetch('http://localhost:8000/mentor/roster')
        ]);

        const statsData = await statsRes.json();
        const alertsData = await alertsRes.json();
        const rosterData = await rosterRes.json();

        setStats([
          { label: 'Active Students', value: statsData.active_students.toLocaleString(), trend: '+12%', icon: Users, color: 'text-cyan-400' },
          { label: 'Average Class Elo', value: statsData.avg_class_elo.toLocaleString(), trend: '+45', icon: Target, color: 'text-purple-400' },
          { label: 'Quiz Completion', value: `${statsData.quiz_completion}%`, trend: 'Excellent', icon: Zap, color: 'text-emerald-400' },
        ]);

        setAlerts(alertsData);
        setStudents(rosterData);
      } catch (error) {
        console.error("Failed to fetch mentor data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-cyan-500/20 border-t-cyan-500 rounded-full animate-spin"></div>
          <BrainCircuit className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-6 h-6 text-cyan-500 animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-4xl font-bold font-headline tracking-tight text-white flex items-center gap-3">
            <BrainCircuit className="w-10 h-10 text-cyan-500" />
            Mentor Command Center
          </h2>
          <p className="text-slate-400 mt-1 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            System Live: Monitoring 12 Batches Across 4 Domains
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button className="bg-surface-container-high hover:bg-surface-container-highest text-white px-4 py-2 rounded-xl transition-all font-bold border border-white/5 flex items-center gap-2">
            <BarChart3 className="w-4 h-4" />
            Export Analytics
          </button>
          <button className="bg-cyan-500 hover:bg-cyan-400 text-black px-6 py-2 rounded-xl font-bold transition-all shadow-[0_0_20px_rgba(6,182,212,0.3)]">
            AI Consultation
          </button>
        </div>
      </div>

      {/* Main Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {stats.map((stat, idx) => (
          <div key={idx} className="bg-surface-container-low group hover:bg-surface-container-high transition-all duration-300 p-6 rounded-3xl border border-white/5 relative overflow-hidden">
            <div className={`absolute top-0 right-0 w-32 h-32 -mr-16 -mt-16 rounded-full blur-3xl opacity-10 group-hover:opacity-20 transition-opacity ${stat.color === 'text-cyan-400' ? 'bg-cyan-500' : stat.color === 'text-purple-400' ? 'bg-purple-500' : 'bg-emerald-500'}`}></div>
            <div className="flex justify-between items-start mb-4">
              <div className={`p-3 rounded-2xl bg-surface-container-highest ${stat.color}`}>
                <stat.icon className="w-6 h-6" />
              </div>
              <span className={`text-xs font-bold px-2 py-1 rounded-lg ${stat.trend.startsWith('+') || stat.trend === 'Excellent' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
                {stat.trend}
              </span>
            </div>
            <h3 className="text-slate-500 font-label uppercase tracking-widest text-xs mb-1">{stat.label}</h3>
            <p className="text-3xl font-bold font-headline text-white">{stat.value}</p>
          </div>
        ))}
      </div>

      {/* Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left Column: Alerts & Suggestions */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-surface-container-low p-6 rounded-3xl border border-white/5 h-full">
            <h3 className="text-xl font-bold font-headline mb-6 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-400" />
              Intervention Alerts
            </h3>
            <div className="space-y-4">
              {alerts.map((alert) => (
                <div key={alert.id} className={`p-4 rounded-2xl border-l-4 transition-all hover:bg-white/5 ${alert.type === 'critical' ? 'border-rose-500 bg-rose-500/5' : 'border-amber-500 bg-amber-500/5'}`}>
                  <div className="flex justify-between items-start mb-2">
                    <h4 className={`font-bold text-sm ${alert.type === 'critical' ? 'text-rose-400' : 'text-amber-400'}`}>{alert.title}</h4>
                    <span className="text-[10px] text-slate-500">{alert.timestamp}</span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">{alert.message}</p>
                  <button className="mt-3 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-white flex items-center gap-1">
                    Take Action <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>

            <div className="mt-8 p-5 bg-gradient-to-br from-purple-500/10 to-transparent rounded-2xl border border-purple-500/20 relative group cursor-pointer overflow-hidden">
               <div className="absolute top-0 right-0 p-3">
                  <BrainCircuit className="w-5 h-5 text-purple-400 opacity-20 group-hover:opacity-100 transition-opacity" />
               </div>
               <h4 className="text-purple-400 font-bold text-sm mb-2 flex items-center gap-2 italic">
                 AI Strategic Insight
               </h4>
               <p className="text-xs text-slate-300 leading-relaxed">
                 Students are struggling with <span className="text-white font-bold">"Angular Momentum"</span> derivation. 
                 <br/><br/>
                 <span className="text-purple-300 font-bold">Recommended:</span> Unlock the 3D Simulation Module for Batch A to improve conceptual retention by approx. 24%.
               </p>
               <button className="mt-4 w-full py-2 bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 text-xs font-bold rounded-lg transition-all">
                 Apply Recommendation
               </button>
            </div>
          </div>
        </div>

        {/* Right Column: Student Roster & Mastery */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-surface-container-low p-6 rounded-3xl border border-white/5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
              <h3 className="text-xl font-bold font-headline flex items-center gap-2">
                <Users className="w-5 h-5 text-cyan-500" />
                Student Performance Roster
              </h3>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input 
                  type="text" 
                  placeholder="Search students..." 
                  className="bg-surface-container-highest border border-white/5 rounded-xl pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-cyan-500/50 w-full md:w-64 transition-all"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-slate-500 text-[10px] uppercase tracking-widest border-b border-white/5">
                    <th className="pb-4 font-normal">Student</th>
                    <th className="pb-4 font-normal">Current Elo</th>
                    <th className="pb-4 font-normal">Status</th>
                    <th className="pb-4 font-normal">Syllabus Progress</th>
                    <th className="pb-4 font-normal text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {students.filter(s => s.name.toLowerCase().includes(searchTerm.toLowerCase())).map((student, idx) => (
                    <tr key={idx} className="group hover:bg-white/5 transition-all">
                      <td className="py-4">
                        <div className="flex items-center gap-3">
                          <div className={`w-10 h-10 rounded-xl bg-gradient-to-br flex items-center justify-center font-bold text-xs ${idx % 2 === 0 ? 'from-cyan-500/20 to-cyan-500/5 text-cyan-400' : 'from-purple-500/20 to-purple-500/5 text-purple-400'}`}>
                            {student.avatar}
                          </div>
                          <div>
                            <p className="font-bold text-white text-sm">{student.name}</p>
                            <p className="text-[10px] text-slate-500">{student.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-4">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">{student.elo}</span>
                          <TrendingUp className="w-3 h-3 text-emerald-400" />
                        </div>
                      </td>
                      <td className="py-4">
                        <span className={`text-[10px] font-bold px-2 py-1 rounded-lg ${
                          student.status === 'Elite' ? 'bg-purple-500/10 text-purple-400' :
                          student.status === 'Critical' ? 'bg-rose-500/10 text-rose-400' :
                          'bg-cyan-500/10 text-cyan-400'
                        }`}>
                          {student.status}
                        </span>
                      </td>
                      <td className="py-4">
                        <div className="w-32">
                           <div className="flex justify-between text-[10px] mb-1">
                              <span className="text-slate-500">Progress</span>
                              <span className="text-white font-bold">{student.progress}%</span>
                           </div>
                           <div className="h-1.5 w-full bg-surface-container-highest rounded-full overflow-hidden">
                              <div 
                                className={`h-full transition-all duration-1000 ${student.progress > 90 ? 'bg-emerald-500' : 'bg-cyan-500'}`} 
                                style={{ width: `${student.progress}%` }}
                              ></div>
                           </div>
                        </div>
                      </td>
                      <td className="py-4 text-right">
                        <button className="p-2 hover:bg-surface-container-highest rounded-lg transition-all text-slate-400 hover:text-white">
                          <MoreVertical className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            <button className="mt-6 w-full py-3 border border-dashed border-white/10 hover:border-cyan-500/50 hover:bg-cyan-500/5 text-slate-500 hover:text-cyan-400 text-sm font-bold rounded-2xl transition-all flex items-center justify-center gap-2">
              View All Students Profile <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Mentor;
