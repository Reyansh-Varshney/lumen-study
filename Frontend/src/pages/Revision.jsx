import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine
} from 'recharts';
import { format, differenceInDays, parseISO } from 'date-fns';

export default function Revision() {
  const [srsData, setSrsData] = useState([]);
  const [selectedTopicId, setSelectedTopicId] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchSrsData = async () => {
      try {
        const token = localStorage.getItem('access_token');
        // Fallback to a relative or common base URL
        const baseURL = import.meta.env.VITE_API_URL || 'http://localhost:8000';
        const response = await fetch(`${baseURL}/srs/curves`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (response.ok) {
          const data = await response.json();
          setSrsData(data);
          if (data.length > 0) {
            setSelectedTopicId(data[0].reference_id);
          }
        }
      } catch (error) {
        console.error("Failed to fetch SRS data:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchSrsData();
  }, []);

  const selectedRecord = useMemo(() => {
    return srsData.find(record => record.reference_id === selectedTopicId);
  }, [srsData, selectedTopicId]);

  const generateCurveData = (record) => {
    if (!record) return [];

    const interval = Math.max(1, record.interval || 1);
    const easeFactor = record.ease_factor || 2.5;
    const memoryStrength = interval * (easeFactor / 2.5) * 1.2;

    const data = [];
    // Loop from Day -2 to Day +14
    for (let day = -2; day <= 14; day++) {
      let retention = 100;
      
      // If the day is in the past or exactly today (Last Review), keep it flat at 100%
      // Only decay for future days
      if (day > 0) {
        retention = 100 * Math.exp(-day / memoryStrength);
      }
      
      data.push({
        dayOffset: day,
        retention: Math.max(0, Math.round(retention))
      });
    }
    return data;
  };

  const daysSinceReview = selectedRecord 
    ? Math.max(0, differenceInDays(new Date(), new Date(selectedRecord.last_reviewed_date || new Date()))) 
    : 0;

  const { curveData, currentRetention } = useMemo(() => {
    if (!selectedRecord) return { curveData: [], currentRetention: 0 };

    const data = generateCurveData(selectedRecord);
    
    // Calculate a standard memory strength based on SM-2 variables for current retention.
    const interval = Math.max(1, selectedRecord.interval || 1);
    const easeFactor = selectedRecord.ease_factor || 2.5;
    const memoryStrength = interval * (easeFactor / 2.5) * 1.2;

    const exactRetention = 100 * Math.exp(-daysSinceReview / memoryStrength);
    
    return { 
        curveData: data, 
        currentRetention: Math.min(Math.max(exactRetention, 0), 100) 
    };
  }, [selectedRecord, daysSinceReview]);

  const handleReviewNow = () => {
    if (!selectedTopicId) return;
    navigate('/arena', { 
      state: { 
        topic: selectedTopicId, 
        mode: 'topic_bot' 
      } 
    });
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-on-surface">
        <div className="animate-pulse flex flex-col items-center">
            <div className="w-16 h-16 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin shadow-[0_0_15px_rgba(34,211,238,0.5)]"></div>
            <p className="mt-4 font-label tracking-widest text-cyan-400">Loading Memory Matrix...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full space-y-8 p-8 bg-surface text-on-surface animate-fade-in custom-scrollbar">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-outline-variant/30 pb-6">
        <div>
          <h1 className="text-4xl font-headline font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-500 tracking-tight drop-shadow-sm">
            Revision Engine
          </h1>
          <p className="text-on-surface-variant font-body">
            Visualize your memory decay based on the SM-2 Spaced Repetition Algorithm.
          </p>
        </div>
        
        {/* Dropdown for Topic Selection */}
        {srsData.length > 0 && (
          <div className="relative group">
            <div className="absolute inset-0 bg-cyan-500/20 blur-md rounded-xl group-hover:bg-cyan-500/30 transition-all"></div>
            <select 
              className="relative appearance-none bg-surface-container-high border border-cyan-500/50 text-cyan-50 font-headline font-bold rounded-xl px-6 py-3 pr-10 focus:outline-none focus:ring-2 focus:ring-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.15)] transition-all cursor-pointer backdrop-blur-sm"
              value={selectedTopicId}
              onChange={(e) => setSelectedTopicId(e.target.value)}
            >
              {srsData.map((record) => (
                <option key={record._id} value={record.reference_id} className="bg-surface-container-high text-on-surface">
                  {record.reference_id}
                </option>
              ))}
            </select>
            <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-cyan-400 pointer-events-none">
              expand_more
            </span>
          </div>
        )}
      </div>

      {srsData.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-12 mt-8 container-card text-center">
          <span className="material-symbols-outlined text-6xl text-cyan-500/50 mb-4 animate-bounce">
            memory
          </span>
          <h2 className="text-2xl font-bold font-headline">No Revision Data Yet</h2>
          <p className="text-on-surface-variant max-w-md mx-auto mt-2">
            Ask questions in the Resource Library to extract topics and populate your spaced repetition engine.
          </p>
          <button 
            onClick={() => navigate('/library')}
            className="mt-6 px-8 py-3 bg-cyan-500/20 text-cyan-400 border border-cyan-500/50 rounded-lg hover:bg-cyan-500/30 transition-all font-bold tracking-wide shadow-[0_0_10px_rgba(34,211,238,0.2)]"
          >
            Open Library
          </button>
        </div>
      ) : (
        <>
          {/* Chart Container */}
          <div className="container-card relative overflow-hidden group">
            {/* Background effects */}
            <div className="absolute -inset-1 bg-gradient-to-br from-cyan-500/5 to-blue-500/5 -z-10 rounded-3xl blur-2xl"></div>
            
            <h2 className="text-xl font-headline font-bold mb-6 flex items-center gap-2">
              <span className="material-symbols-outlined text-cyan-400">monitoring</span>
              Ebbinghaus Forgetting Curve
            </h2>
            
            <div className="w-full h-[400px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={curveData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                  <defs>
                    <filter id="glow">
                      <feGaussianBlur stdDeviation="3.5" result="coloredBlur"/>
                      <feMerge>
                        <feMergeNode in="coloredBlur"/>
                        <feMergeNode in="SourceGraphic"/>
                      </feMerge>
                    </filter>
                  </defs>
                  
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                  
                  <XAxis 
                    dataKey="dayOffset" 
                    stroke="#94a3b8" 
                    tick={{ fill: '#94a3b8', fontSize: 12 }}
                    tickFormatter={(tick) => {
                      if (tick === 0) return "Last Review";
                      if (tick < 0) return `Day ${tick}`;
                      return `Day +${tick}`;
                    }}
                    tickLine={false}
                    axisLine={false}
                    dy={10}
                  />
                  
                  <YAxis 
                    domain={[0, 100]} 
                    stroke="#94a3b8"
                    tick={{ fill: '#94a3b8', fontSize: 12 }}
                    tickFormatter={(value) => `${value}%`}
                    tickLine={false}
                    axisLine={false}
                    dx={-10}
                  />
                  
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'rgba(15, 23, 42, 0.9)', 
                      backdropFilter: 'blur(8px)',
                      border: '1px solid rgba(34,211,238,0.3)',
                      borderRadius: '12px',
                      color: '#fff',
                      boxShadow: '0 4px 20px rgba(0,0,0,0.5)'
                    }}
                    itemStyle={{ color: '#22d3ee', fontWeight: 'bold' }}
                    formatter={(value) => [`${value}%`, 'Retention']}
                    labelFormatter={(label) => {
                      if (label === 0) return "Last Review";
                      if (label < 0) return `Day ${label}`;
                      return `Day +${label}`;
                    }}
                  />

                  {/* Reference Line for Today */}
                  <ReferenceLine 
                    x={daysSinceReview} 
                    stroke="#10b981" 
                    strokeDasharray="3 3" 
                    label={{ position: 'top', value: 'Today', fill: '#10b981', fontSize: 12 }} 
                  />

                  {/* Reference Line for Threshold (60%) */}
                  <ReferenceLine 
                    y={60} 
                    stroke="#f59e0b" 
                    strokeDasharray="3 3" 
                    strokeWidth={1.5}
                    label={{ position: 'insideTopLeft', value: 'Optimal Review Threshold', fill: '#f59e0b', fontSize: 12, dy: -10 }} 
                  />

                  <Line 
                    type="monotone" 
                    dataKey="retention" 
                    stroke="#22d3ee" 
                    strokeWidth={4} 
                    dot={{ r: 4, fill: '#0f172a', stroke: '#22d3ee', strokeWidth: 2 }}
                    activeDot={{ r: 8, fill: '#22d3ee', stroke: '#fff', strokeWidth: 2, filter: 'url(#glow)' }}
                    filter="url(#glow)"
                    animationDuration={1500}
                    animationEasing="ease-out"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Action Loop Section */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            
            {/* Next Review Status */}
            <div className="container-card col-span-1 md:col-span-2 flex flex-col justify-center">
              <div className="flex flex-col md:flex-row justify-between items-center gap-6">
                
                <div className="flex items-center gap-6">
                  {/* Circular Progress representation */}
                  <div className="relative w-24 h-24 flex items-center justify-center rounded-full bg-surface-container-high border-4 border-surface shadow-inner">
                    <svg className="w-full h-full transform -rotate-90 absolute">
                      <circle cx="48" cy="48" r="44" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-surface-container" />
                      <circle 
                        cx="48" cy="48" r="44" 
                        stroke="currentColor" 
                        strokeWidth="8" 
                        fill="transparent" 
                        strokeDasharray={`${(currentRetention / 100) * 276} 276`} 
                        className={`${currentRetention < 60 ? 'text-amber-500' : 'text-cyan-400'} transition-all duration-1000 ease-in-out drop-shadow-md`} 
                      />
                    </svg>
                    <span className="text-xl font-headline font-black mix-blend-screen">{currentRetention.toFixed(0)}%</span>
                  </div>
                  
                  <div>
                    <h3 className="text-lg font-headline font-bold text-on-surface">Retention Status</h3>
                    <p className="text-sm font-label text-on-surface-variant flex items-center gap-1 mt-1">
                      <span className="material-symbols-outlined text-[16px]">calendar_today</span>
                      Next Review: <span className="text-cyan-400 font-bold ml-1">
                        {selectedRecord?.next_review_date ? format(parseISO(selectedRecord.next_review_date), 'MMM dd, yyyy') : 'Unknown'}
                      </span>
                    </p>
                    <p className="text-xs text-on-surface-variant/70 mt-2 italic">
                      {currentRetention < 60 
                        ? `Caution: Knowledge is decaying. Review immediately to reset the curve.` 
                        : `Healthy retention. Next review will push the forgetting curve further out.`}
                    </p>
                  </div>
                </div>

              </div>
            </div>

            {/* Battle / Review Action */}
            <div className="col-span-1 flex items-center justify-center">
               <button 
                  onClick={handleReviewNow}
                  className="w-full h-full min-h-[120px] relative overflow-hidden group bg-gradient-to-br from-cyan-600 to-blue-700 rounded-2xl p-1 transition-all hover:scale-[1.02] shadow-[0_0_30px_rgba(34,211,238,0.3)] hover:shadow-[0_0_50px_rgba(34,211,238,0.5)]"
                >
                  <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-all"></div>
                  {/* Shimmer Effect */}
                  <div className="absolute top-0 -inset-full h-full w-1/2 z-5 block transform -skew-x-12 bg-gradient-to-r from-transparent to-white opacity-20 group-hover:animate-shimmer"></div>
                  
                  <div className="relative h-full w-full bg-surface/10 backdrop-blur-sm rounded-xl flex flex-col items-center justify-center border border-white/10 gap-2">
                    <span className="material-symbols-outlined text-4xl text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.8)]">
                      swords
                    </span>
                    <span className="font-headline font-black text-xl text-white tracking-widest uppercase">
                      Enter Arena
                    </span>
                    <span className="text-xs text-cyan-100 font-label tracking-wide uppercase opacity-80">
                      Review Now
                    </span>
                  </div>
               </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
