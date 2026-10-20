import { Link, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import api from '../api/axios';
// eslint-disable-next-line no-unused-vars
import { motion } from 'framer-motion';
import { Trophy, Swords, Sparkles, BrainCircuit, Activity, BookOpen, AlertCircle, Timer } from 'lucide-react';
import {
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer
} from 'recharts';
import OnboardingModal from '../components/OnboardingModal';
import SyllabusRoadmap from '../components/SyllabusRoadmap';

const containerVariants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.1 } }
};

const cardVariants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
};

const cardHover = {
  y: -5,
  boxShadow: "0 20px 40px rgba(34,211,238,0.15)",
  transition: { type: "spring", stiffness: 300 }
};

export default function Dashboard() {
  const [metrics, setMetrics] = useState(null);
  const [mission, setMission] = useState(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [weaknesses, setWeaknesses] = useState([]);
  const [masterSyllabusId, setMasterSyllabusId] = useState(null); 
  
  const navigate = useNavigate();

  const fetchDashboardData = () => {
    // 1. Fetch user profile first for onboarding rules
    api.get('/auth/me')
      .then(res => {
        setMasterSyllabusId(res.data.master_syllabus_id);
        if (!res.data.master_syllabus_id) setShowOnboarding(true);
        else setShowOnboarding(false);
      })
      .catch(err => {
        console.error("Auth error", err);
      });
      
    // 2. Fetch Dashboard Metrics asynchronously
    api.get('/dashboard/metrics')
      .then(res => setMetrics(res.data))
      .catch(err => console.error("Metrics logic failed", err));
      
    // 3. Fetch Today's Planner Mission asynchronously
    api.get('/planner/daily')
      .then(res => setMission(res.data))
      .catch(err => console.error("Planner logic failed", err));
      
    // 4. Fetch Weaknesses for Adaptive Practice
    api.get('/adaptive/weaknesses')
      .then(res => setWeaknesses(res.data))
      .catch(err => console.error("Adaptive logic failed", err));
  };

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const handleOnboardingComplete = () => {
    setShowOnboarding(false);
    fetchDashboardData();
  };

  if (!metrics) {
     return (
        <div className="min-h-screen bg-[#030712] flex flex-col items-center justify-center">
            <div className="w-16 h-16 border-4 border-[#22d3ee] border-t-transparent rounded-full animate-spin"></div>
            <p className="mt-6 text-[#22d3ee] animate-pulse font-bold tracking-widest text-sm text-center">INITIALIZING NEURAL LINK...</p>
        </div>
     );
  }

  const currentXP = metrics.total_xp || 0;
  const currentLevel = metrics.level || 1;
  const levelXP = currentLevel * 500; 
  const xpPercentage = Math.min((currentXP / levelXP) * 100, 100);
  const circumference = 2 * Math.PI * 45; // r=45
  const strokeDashoffset = circumference - (xpPercentage / 100) * circumference;

  return (
    <div className="min-h-screen bg-[#030712] text-white p-4 md:p-8 font-sans overflow-x-hidden selection:bg-cyan-500/30">
      {/* Background Glows */}
      <div className="fixed top-[-10%] left-[-10%] w-[40vw] h-[40vw] bg-purple-600/10 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="fixed bottom-[-10%] right-[-10%] w-[40vw] h-[40vw] bg-cyan-600/10 rounded-full blur-[120px] pointer-events-none"></div>

      {showOnboarding && <OnboardingModal onComplete={handleOnboardingComplete} />}

      <motion.div 
        className="max-w-7xl mx-auto space-y-8 relative z-10"
        variants={containerVariants}
        initial="hidden"
        animate="show"
      >

        {/* Module 2: Today's Optimal Mission */}
        {!mission ? (
          <motion.div variants={cardVariants} className="bg-[#0A0F1C]/60 backdrop-blur-[20px] border border-white/10 rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] p-8 flex flex-col items-center justify-center text-center space-y-5">
             <div className="w-12 h-12 border-4 border-cyan-400 border-t-transparent rounded-full animate-spin shadow-[0_0_15px_rgba(34,211,238,0.5)]"></div>
             <p className="font-headline text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-400 animate-pulse drop-shadow-sm">
               AI is actively analyzing your forgetting curves and course tracker to generate today's mission...
             </p>
          </motion.div>
        ) : (
          <motion.div variants={cardVariants} className="bg-[#0A0F1C]/60 backdrop-blur-[20px] border border-white/10 rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] p-6 overflow-hidden relative group">
             <div className="absolute top-0 right-0 w-64 h-64 bg-cyan-500/10 rounded-full blur-[80px] -mr-32 -mt-32 pointer-events-none transition-all duration-500 group-hover:bg-cyan-500/20"></div>
             
             <div className="flex items-center gap-3 mb-6 relative z-10">
               <div className="p-2 bg-cyan-500/20 rounded-xl border border-cyan-500/30 shadow-[0_0_15px_rgba(34,211,238,0.3)]">
                 <Sparkles className="w-6 h-6 text-cyan-400 animate-pulse" />
               </div>
               <h2 className="font-headline text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-cyan-400 tracking-tight drop-shadow-sm">
                 Today's Optimal Mission
               </h2>
             </div>
             
             <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 relative z-10">
               {mission.map((task, idx) => {
                  let Icon = BookOpen;
                  let label = "Start";
                  let color = "text-cyan-400";
                  let bg = "bg-cyan-500/10";
                  let border = "border-cyan-500/30";

                  const actionType = task.action_type;

                  if (actionType === 'resource_study') {
                    Icon = BrainCircuit; color = "text-cyan-400"; label = "Open Library"; border = "border-cyan-500/30"; bg = "bg-cyan-500/10";
                  } else if (actionType === 'practice_arena') {
                    Icon = Swords; color = "text-indigo-400"; label = "Enter Arena"; border = "border-indigo-500/30"; bg = "bg-indigo-500/10";
                  } else if (actionType === 'practice_test') {
                    Icon = Timer; color = "text-amber-400"; label = "Start Session"; border = "border-amber-500/30"; bg = "bg-amber-500/10";
                  } else if (actionType === 'revision') {
                    Icon = AlertCircle; color = "text-rose-400"; label = "Stabilize Memory"; border = "border-rose-500/30"; bg = "bg-rose-500/10";
                  }

                  return (
                     <div key={idx} className={`flex flex-col justify-between p-5 rounded-2xl border ${border} bg-white/5 hover:bg-white/10 transition-all duration-300 shadow-lg relative overflow-hidden group/card backdrop-blur-sm`}>
                        <div className="flex items-start gap-4 mb-4">
                          <div className={`p-3 rounded-xl ${bg} border ${border} drop-shadow-md`}>
                            <Icon className={`w-6 h-6 ${color}`} />
                          </div>
                          <div className="flex-1 mt-1">
                            <h3 className="font-headline font-bold text-white leading-tight text-lg mb-1.5 drop-shadow-sm">
                              {task.task_title}
                            </h3>
                          </div>
                        </div>
                        <p className="text-sm font-body text-white/50 italic mb-5 pl-3 border-l-2 border-white/20 leading-relaxed">
                          "{task.reasoning}"
                        </p>
                        <div className="mt-auto">
                          <button 
                            onClick={() => {
                               if (actionType === 'resource_study') navigate('/library', { state: { topic: task.target_topic } });
                               else if (actionType === 'practice_arena') navigate('/arena', { state: { topic: task.target_topic, mode: 'topic_bot' } });
                               else if (actionType === 'practice_test') navigate('/practice', { state: { topic: task.target_topic } });
                               else if (actionType === 'revision') navigate('/revision', { state: { topic: task.target_topic } });
                            }}
                            className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl border ${border} ${bg} ${color} hover:brightness-125 transition-all text-sm font-black uppercase tracking-widest group-hover/card:border-white/30`}
                          >
                            {label}
                          </button>
                        </div>
                     </div>
                  );
               })}
             </div>
          </motion.div>
        )}

        {/* Top Fold: Hero & Stats */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <motion.div 
             className="lg:col-span-2 bg-[#0A0F1C]/60 backdrop-blur-[20px] border border-white/10 rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] overflow-hidden relative p-8 flex flex-col justify-between"
             variants={cardVariants}
             whileHover={cardHover}
          >
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/20 rounded-full blur-[80px] -mr-32 -mt-32 pointer-events-none"></div>
            
            <div>
              <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-2 text-transparent bg-clip-text bg-gradient-to-r from-white to-white/60">
                Welcome back, {metrics.username}.
              </h2>
              <p className="text-cyan-400 flex items-center gap-2 font-medium tracking-wide">
                <Sparkles className="w-4 h-4" /> Focus initialized. {metrics.grade_level ? `Level: ${metrics.grade_level}` : 'Ready to learn'}
                {metrics.active_subjects?.length > 0 && (
                  <span className="text-white/50"> · {metrics.active_subjects.join(', ')}</span>
                )}
              </p>
            </div>
            
            <div className="mt-10 flex flex-wrap gap-8 items-end">
              <div>
                <p className="text-[10px] tracking-[0.2em] text-white/40 uppercase mb-2 font-bold">Study Rating</p>
                <div className="flex items-center gap-4">
                  <div className="p-4 bg-purple-500/10 rounded-2xl border border-purple-500/30 shadow-[0_0_20px_rgba(167,139,250,0.2)]">
                    <Trophy className="text-purple-400 w-8 h-8" />
                  </div>
                  <div>
                    <p className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 to-indigo-400">
                      Scholar
                    </p>
                    <p className="text-sm text-purple-300/70 font-medium">ELO Rating: {metrics.elo_rating}</p>
                  </div>
                </div>
              </div>
              <div className="hidden md:block h-16 w-[1px] bg-white/10"></div>
              
              <div className="flex items-center gap-6">
                {/* Fluid XP Ring */}
                <div className="relative w-24 h-24 flex items-center justify-center">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                    <circle cx="50" cy="50" r="45" stroke="rgba(255,255,255,0.05)" strokeWidth="6" fill="transparent" />
                    <motion.circle 
                      cx="50" cy="50" r="45" 
                      stroke="#a78bfa" 
                      strokeWidth="6" 
                      fill="transparent" 
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      initial={{ strokeDashoffset: circumference }}
                      animate={{ strokeDashoffset: strokeDashoffset }}
                      transition={{ duration: 2, ease: "easeOut", delay: 0.5 }}
                      style={{ filter: "drop-shadow(0 0 8px #a78bfa)" }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-xs text-white/50 font-bold tracking-widest uppercase">Lvl</span>
                    <span className="text-xl font-black text-purple-200">{metrics.level}</span>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] tracking-[0.2em] text-white/40 uppercase mb-1 font-bold">Total Experience</p>
                  <p className="text-4xl font-black text-white">{currentXP.toLocaleString()} <span className="text-sm text-white/40 font-medium">XP</span></p>
                </div>
              </div>
            </div>
          </motion.div>

          {/* Quick Metrics Connect */}
          <motion.div 
            className="bg-[#0A0F1C]/60 backdrop-blur-[20px] border border-white/10 rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] overflow-hidden flex flex-col items-center justify-center p-8 text-center relative group"
            variants={cardVariants}
            whileHover={cardHover}
          >
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
            <div className="mb-6 p-5 rounded-full bg-cyan-500/10 border border-cyan-500/30 group-hover:scale-110 transition-transform duration-500 shadow-[0_0_30px_rgba(34,211,238,0.2)]">
              <Activity className="text-cyan-400 w-10 h-10" />
            </div>
            <p className="text-sm text-white/50 font-medium relative z-10 mb-4">
              Your Resource Library is active.
            </p>
            <button onClick={() => navigate('/library')} className="w-full relative z-10 font-bold text-lg text-white bg-gradient-to-r from-cyan-500 to-blue-600 px-6 py-4 rounded-2xl shadow-[0_0_20px_rgba(34,211,238,0.4)] hover:shadow-[0_0_40px_rgba(34,211,238,0.6)] transition-all transform hover:-translate-y-1">
              Add Study Material
            </button>
          </motion.div>
        </div>

        {/* Second Fold: Analytics & Heatmap */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* Targeted Mastery (Radar) */}
          <motion.div 
            className="bg-[#0A0F1C]/60 backdrop-blur-[20px] border border-white/10 rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] overflow-hidden p-6 flex flex-col relative"
            variants={cardVariants}
            whileHover={cardHover}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold tracking-wide">Targeted Mastery</h3>
              <Activity className="w-5 h-5 text-purple-400" />
            </div>
            <div className="flex-1 w-full min-h-[250px] relative">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="65%" data={metrics.mastery_radar}>
                  <PolarGrid stroke="rgba(255,255,255,0.1)" strokeDasharray="3 3" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 12, fontWeight: 600 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                  <Radar 
                    name="Mastery" 
                    dataKey="A" 
                    stroke="#a78bfa" 
                    strokeWidth={2}
                    fill="#22d3ee" 
                    fillOpacity={0.4} 
                    dot={{ r: 3, fill: '#a78bfa', strokeWidth: 0 }}
                  />
                </RadarChart>
              </ResponsiveContainer>
              <div className="absolute bottom-0 left-0 right-0 p-4 bg-white/5 backdrop-blur-md border-t border-white/10 rounded-b-3xl text-center">
                <p className="text-[10px] font-black text-cyan-400 tracking-widest mb-1">AI INSIGHT</p>
                <p className="text-xs text-white/80 leading-relaxed font-medium">
                  Aggregated mastery scores based on Spaced Repetition ease vectors.
                </p>
              </div>
            </div>
          </motion.div>

          {/* Heatmap Matrix */}
          <motion.div 
            className="bg-[#0A0F1C]/60 backdrop-blur-[20px] border border-white/10 rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] overflow-hidden p-6 flex flex-col"
            variants={cardVariants}
            whileHover={cardHover}
          >
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold tracking-wide">Synapse Activity</h3>
              <div className="flex items-center gap-2 text-[10px] tracking-widest text-white/40 uppercase font-black">
                <span>Less</span>
                <div className="flex gap-1.5">
                  <div className="w-3 h-3 rounded-sm bg-[#1e293b]"></div>
                  <div className="w-3 h-3 rounded-sm bg-[#064e3b]"></div>
                  <div className="w-3 h-3 rounded-sm bg-[#047857]"></div>
                  <div className="w-3 h-3 rounded-sm bg-[#10b981]"></div>
                </div>
                <span>More</span>
              </div>
            </div>
            
            {/* Heatmap Grid */}
            <div className="flex gap-2 overflow-x-auto pb-4 custom-scrollbar flex-1 items-center justify-center">
              <div className="flex gap-2">
                {[0,1,2,3,4,5,6].map(col => (
                  <div key={col} className="flex flex-col gap-2 flex-shrink-0">
                    {[0,1,2,3].map(row => {
                      const cellIndex = col * 4 + row;
                      const dayData = metrics.heatmap ? metrics.heatmap[cellIndex] : null;
                      const intensity = dayData ? dayData.count : 0;
                      
                      let bgColor = 'bg-[#1e293b]';
                      if (intensity > 0 && intensity <= 2) bgColor = 'bg-[#064e3b]';
                      if (intensity > 2 && intensity <= 5) bgColor = 'bg-[#065f46]';
                      if (intensity > 5 && intensity <= 10) bgColor = 'bg-[#047857]';
                      if (intensity > 10) bgColor = 'bg-[#10b981] shadow-[0_0_10px_rgba(16,185,129,0.5)]';
                      
                      return (
                        <motion.div 
                          key={row} 
                          title={dayData ? `${dayData.date}: ${intensity} actions` : "No Activity"}
                          className={`w-6 h-6 rounded-md ${bgColor} border border-white/5 cursor-pointer relative`}
                          whileHover={{ scale: 1.4, zIndex: 10, borderRadius: '4px' }}
                          transition={{ type: "spring", stiffness: 400, damping: 17 }}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
            
            <div className="mt-auto pt-4 border-t border-white/10 text-center">
              <p className="text-sm text-white/50 font-medium">Keep your synaptic streaks alive.</p>
            </div>
          </motion.div>
        </div>
        
        {/* Targeted Weakness Remediation */}
        {weaknesses.length > 0 && (
          <motion.div variants={cardVariants} className="bg-[#0A0F1C]/60 backdrop-blur-[20px] border border-white/10 rounded-3xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="p-2 bg-rose-500/20 rounded-xl border border-rose-500/30">
                <AlertCircle className="w-6 h-6 text-rose-400" />
              </div>
              <h2 className="font-headline text-2xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white to-rose-400 drop-shadow-sm">
                Targeted Weakness Remediation
              </h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {weaknesses.map((w, idx) => (
                <div key={idx} className="bg-white/5 border border-white/10 rounded-2xl p-5 flex flex-col items-start gap-4 hover:border-rose-500/30 transition-all duration-300 relative overflow-hidden group shadow-lg">
                  <div className="absolute top-0 right-0 w-32 h-32 bg-rose-500/10 rounded-full blur-[50px] -mr-16 -mt-16 pointer-events-none group-hover:bg-rose-500/20 transition-all"></div>
                  
                  <h3 className="font-headline font-bold text-white leading-snug drop-shadow-sm text-lg relative z-10 w-full truncate">
                    {w.topic}
                  </h3>
                  
                  <div className="flex flex-col gap-2 w-full relative z-10">
                    <span className="text-xs font-bold text-rose-300 bg-rose-500/10 border border-rose-500/20 px-3 py-1.5 rounded-lg text-center flex items-center justify-center gap-2">
                       <Timer className="w-4 h-4" /> Avg Time: {w.avg_time_taken}s
                    </span>
                    <span className="text-xs font-bold text-orange-300 bg-orange-500/10 border border-orange-500/20 px-3 py-1.5 rounded-lg text-center font-body flex justify-center items-center">
                      <Swords className="w-3 h-3 mr-1" /> {w.error_count} Critical Errors
                    </span>
                  </div>
                  
                  <button 
                    onClick={() => navigate('/arena', { state: { topic: w.topic, mode: 'adaptive_bot' } })}
                    className="w-full mt-auto bg-gradient-to-r from-rose-500/20 to-orange-500/20 hover:from-rose-500 hover:to-orange-500 border border-rose-500/30 hover:border-rose-400 text-rose-200 hover:text-white font-bold py-3 rounded-xl transition-all shadow-[0_0_15px_rgba(244,63,94,0.15)] group-hover:shadow-[0_0_20px_rgba(244,63,94,0.4)] text-sm uppercase tracking-wider relative z-10"
                  >
                    Generate Practice Set
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Global Syllabus Tracking Map */}
        <motion.div variants={cardVariants}>
          <SyllabusRoadmap 
            key={masterSyllabusId || 'uninitialized'}
            onTriggerOnboarding={() => setShowOnboarding(true)} 
          />
        </motion.div>

      </motion.div>
    </div>
  );
}
