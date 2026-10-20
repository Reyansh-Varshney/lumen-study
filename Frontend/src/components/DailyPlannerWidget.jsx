import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { Brain, Swords, ShieldCheck, Sparkles, AlertCircle, ArrowRight } from 'lucide-react';

export default function DailyPlannerWidget() {
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchPlan = async () => {
      try {
        const response = await api.get('/planner/daily');
        setTasks(response.data);
      } catch (err) {
        console.error("Planner fetch error:", err);
        setError("AI Mentor is recalibrating your optimal path. Please try again later.");
      } finally {
        setLoading(false);
      }
    };
    fetchPlan();
  }, []);

  const handleAction = (task) => {
    const type = task.action_type;

    if (type === 'resource_study') {
      navigate('/library', { state: { topic: task.target_topic } });
    } else if (type === 'practice_arena') {
      navigate('/arena', { state: { topic: task.target_topic, mode: 'topic_bot' } });
    } else if (type === 'practice_test') {
      navigate('/practice', { state: { topic: task.target_topic } });
    } else if (type === 'revision') {
      navigate('/revision', { state: { topic: task.target_topic } });
    } else {
      navigate('/');
    }
  };

  const getTaskVisuals = (type) => {
    switch(type) {
      case 'resource_study':
        return { icon: Brain, color: "text-cyan-400", border: "border-cyan-500/30", bg: "bg-cyan-500/10", label: "Open Library" };
      case 'practice_arena':
        return { icon: Swords, color: "text-red-400", border: "border-red-500/30", bg: "bg-red-500/10", label: "Enter Arena" };
      case 'practice_test':
        return { icon: ShieldCheck, color: "text-amber-400", border: "border-amber-500/30", bg: "bg-amber-500/10", label: "Start Session" };
      case 'revision':
        return { icon: Sparkles, color: "text-purple-400", border: "border-purple-500/30", bg: "bg-purple-500/10", label: "Review Now" };
      default:
        return { icon: Sparkles, color: "text-purple-400", border: "border-purple-500/30", bg: "bg-purple-500/10", label: "Start Task" };
    }
  };

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-surface/40 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.4)] p-6 w-full group transition-all duration-300">
      {/* Background Glows */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-primary/10 rounded-full blur-[80px] -mr-20 -mt-20 pointer-events-none"></div>
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-cyan-500/10 rounded-full blur-[60px] -ml-20 -mb-20 pointer-events-none"></div>

      <div className="flex items-center gap-3 mb-6 relative z-10">
        <div className="p-2 bg-primary/20 rounded-xl border border-primary/30 shadow-[0_0_15px_rgba(var(--primary),0.3)]">
          <Sparkles className="w-6 h-6 text-primary animate-pulse" />
        </div>
        <h2 className="font-headline text-3xl font-black text-transparent bg-clip-text bg-gradient-to-r from-primary to-cyan-400 tracking-tight drop-shadow-sm">
          Today's Optimal Mission
        </h2>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center p-8 text-center space-y-5 min-h-[150px] relative z-10">
           <div className="w-14 h-14 border-4 border-primary border-t-transparent rounded-full animate-spin shadow-[0_0_20px_rgba(var(--primary),0.5)]"></div>
           <p className="font-headline text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-primary to-cyan-300 animate-pulse drop-shadow-sm max-w-lg mx-auto">
             Your AI mentor is reviewing your course tracker and memory curves to calculate today's optimal path...
           </p>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center p-8 text-center border border-error/20 bg-error/10 backdrop-blur-md rounded-xl relative z-10">
           <AlertCircle className="w-10 h-10 text-error mb-3 animate-pulse" />
           <p className="text-on-surface-variant text-sm font-label tracking-wide uppercase">{error}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 relative z-10">
          {tasks.map((task, idx) => {
            const Visuals = getTaskVisuals(task.action_type);
            const Icon = Visuals.icon;

            return (
               <div 
                 key={idx} 
                 className={`flex flex-col justify-between p-5 rounded-2xl border ${Visuals.border} bg-surface-container-high/40 hover:bg-surface transition-all duration-300 shadow-lg hover:shadow-[0_0_25px_rgba(255,255,255,0.05)] relative overflow-hidden group/card backdrop-blur-sm`}
               >
                 <div className={`absolute -right-4 -bottom-4 w-28 h-28 rounded-full blur-2xl opacity-10 group-hover/card:opacity-30 transition-opacity ${Visuals.bg}`}></div>
                 
                 <div>
                   <div className="flex items-start gap-4 mb-4">
                     <div className={`p-3 rounded-xl ${Visuals.bg} border ${Visuals.border} drop-shadow-md`}>
                       <Icon className={`w-6 h-6 ${Visuals.color}`} />
                     </div>
                     <div className="flex-1 mt-1">
                       <h3 className="font-headline font-bold text-on-surface leading-tight text-lg mb-1.5 drop-shadow-sm">
                         {task.task_title}
                       </h3>
                       <span className="inline-block px-2 py-0.5 text-[10px] font-black uppercase tracking-widest bg-black/40 text-on-surface-variant border border-white/10 rounded-md">
                         {task.target_topic}
                       </span>
                     </div>
                   </div>
                   <p className="text-sm font-body text-on-surface-variant/90 italic mb-5 pl-3 border-l-2 border-primary/40 leading-relaxed">
                     "{task.reasoning}"
                   </p>
                 </div>

                 <div className="mt-auto">
                   <button 
                     onClick={() => handleAction(task)}
                     className={`w-full flex items-center justify-center gap-2 py-3 rounded-xl border ${Visuals.border} ${Visuals.bg} hover:backdrop-brightness-125 transition-all duration-300 text-sm font-black uppercase tracking-widest text-on-surface group-hover/card:border-white/30`}
                   >
                     {Visuals.label}
                     <ArrowRight className="w-5 h-5 ml-1 transition-transform group-hover/card:translate-x-1" />
                   </button>
                 </div>
               </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
