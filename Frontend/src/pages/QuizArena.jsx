import { useState, useRef } from 'react';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import {
  BrainCircuit, Loader2, Sparkles, Target, ChevronRight,
  CheckCircle, XCircle, Trophy, Zap, TrendingUp, RefreshCw,
  BookOpen, Flame, Star,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';


// ─── State Machine ─────────────────────────────────────────────────────────────
// 'topic_input' | 'llm_loading' | 'active_quiz' | 'socratic_tutor' | 'results'

// ─── Skeleton Item ──────────────────────────────────────────────────────────────
function SkeletonBlock({ className = '' }) {
  return (
    <div
      className={`rounded-xl bg-slate-700/60 overflow-hidden relative ${className}`}
      style={{ isolation: 'isolate' }}
    >
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.6s_infinite] bg-gradient-to-r from-transparent via-slate-500/20 to-transparent" />
    </div>
  );
}

// ─── Radial Score Ring ──────────────────────────────────────────────────────────
function RadialRing({ score, total }) {
  const radius = 56;
  const circumference = 2 * Math.PI * radius;
  const percentage = total > 0 ? score / total : 0;
  const offset = circumference * (1 - percentage);
  const isGood = percentage >= 0.6;

  return (
    <div className="relative w-36 h-36 flex items-center justify-center">
      {/* Outer glow pulse */}
      <motion.div
        animate={{ scale: [1, 1.12, 1], opacity: [0.4, 0.8, 0.4] }}
        transition={{ repeat: Infinity, duration: 2.5, ease: 'easeInOut' }}
        className={`absolute inset-0 rounded-full blur-xl ${isGood ? 'bg-emerald-500/30' : 'bg-rose-500/20'}`}
      />
      <svg className="absolute inset-0 -rotate-90" viewBox="0 0 128 128" fill="none">
        {/* Track */}
        <circle cx="64" cy="64" r={radius} strokeWidth="8" className="stroke-slate-700/60" />
        {/* Progress */}
        <motion.circle
          cx="64"
          cy="64"
          r={radius}
          strokeWidth="8"
          strokeLinecap="round"
          fill="none"
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.4, ease: 'easeOut', delay: 0.3 }}
          strokeDasharray={circumference}
          className={isGood ? 'stroke-emerald-400' : 'stroke-rose-400'}
          style={{ filter: `drop-shadow(0 0 8px ${isGood ? '#34d399' : '#f87171'})` }}
        />
      </svg>
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 14, delay: 0.5 }}
        className="relative z-10 text-center"
      >
        <span className={`text-3xl font-headline font-extrabold ${isGood ? 'text-emerald-400' : 'text-rose-400'}`}>
          {score}
        </span>
        <span className="text-slate-400 text-lg font-headline font-bold">/{total}</span>
      </motion.div>
    </div>
  );
}

// ─── Animated background ambient orbs ──────────────────────────────────────────
function AmbientOrbs() {
  return (
    <div className="pointer-events-none fixed inset-0 overflow-hidden -z-10">
      <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-cyan-500/6 blur-[120px]" />
      <div className="absolute top-1/2 -right-32 w-80 h-80 rounded-full bg-violet-500/6 blur-[100px]" />
      <div className="absolute bottom-0 left-1/3 w-64 h-64 rounded-full bg-indigo-500/5 blur-[80px]" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function QuizArena() {
  // ── State Machine
  const [phase, setPhase] = useState('topic_input');
  const [quizId, setQuizId] = useState(null);

  // ── Topic
  const [topic, setTopic] = useState('');
  const [inputFocused, setInputFocused] = useState(false);

  // ── Quiz data
  const [questions, setQuestions] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [score, setScore] = useState(0);

  // ── Turn interaction
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [isCorrect, setIsCorrect] = useState(null);
  const [direction, setDirection] = useState(1); // slide direction

  // ── Socratic tutor
  const [approachText, setApproachText] = useState('');
  const [isCheckingApproach, setIsCheckingApproach] = useState(false);
  const [aiTutorFeedback, setAiTutorFeedback] = useState('');

  // 🔴 FIX: Add state to accumulate user responses throughout the quiz
  const [userResponses, setUserResponses] = useState([]);

  const inputRef = useRef(null);
  const navigate = useNavigate();

  // ─── Kickstart: Generate Quiz ─────────────────────────────────────────────
  const handleStartRevision = async () => {
    if (!topic.trim()) return;
    setPhase('llm_loading');
    try {
      // 🔴 FIX: Send target_topics as an array!
      const response = await api.post('/quiz/generate', { 
          target_topics: [topic], 
          generation_type: "custom" 
      });
      
      setQuestions(response.data.questions);
      setQuizId(response.data.quiz_id);
      
      setCurrentIndex(0);
      setScore(0);
      setUserResponses([]); // 🔴 FIX: Reset responses on new quiz
      resetTurnState();
      setPhase('active_quiz');
    } catch (err) {
      console.error(err);
      setPhase('topic_input');
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  };

  const resetTurnState = () => {
    setSelectedAnswer(null);
    setIsCorrect(null);
    setApproachText('');
    setAiTutorFeedback('');
    setIsCheckingApproach(false);
  };

  // ─── Answer handler ───────────────────────────────────────────────────────
  const handleAnswerSelect = (option) => {
    if (selectedAnswer !== null) return;
    setSelectedAnswer(option);
    const correct = option === questions[currentIndex].correct_answer;
    setIsCorrect(correct);
    if (correct) setScore((p) => p + 1);
    // If wrong → open socratic panel
    if (!correct) setPhase('socratic_tutor');
  };

  // ─── Socratic: Diagnose Approach ──────────────────────────────────────────
  const handleDiagnose = async () => {
    if (!approachText.trim()) return;
    setIsCheckingApproach(true);
    try {
      const q = questions[currentIndex];
      const res = await api.post('/doubt/approach', {
        question: q.question,
        correct_answer: q.correct_answer,
        user_logic: approachText,
      });
      const raw = res.data.feedback || res.data.message || res.data;
      setAiTutorFeedback(typeof raw === 'string' ? raw : 'Review this concept carefully to master it.');
    } catch {
      setAiTutorFeedback('The AI Tutor is currently offline. Review your logic and try again.');
    } finally {
      setIsCheckingApproach(false);
    }
  };

  // ─── Next question / Finish ────────────────────────────────────────────────
  const handleNext = async () => {
    // 🔴 FIX: Capture the current turn data before moving or finishing
    const currentResponse = {
      question_idx: currentIndex,
      selected_option: selectedAnswer,
      is_correct: isCorrect,
      approach_feedback: aiTutorFeedback || "" // Empty string if Socratic tutor wasn't used
    };

    const updatedResponses = [...userResponses, currentResponse];
    setUserResponses(updatedResponses);

    if (currentIndex < questions.length - 1) {
      setDirection(1);
      setCurrentIndex((p) => p + 1);
      resetTurnState();
      setPhase('active_quiz');
    } else {
      setPhase('results');
      try {
        // 🔴 FIX: Send the exact JSON schema required by the backend
        await api.post('/quiz/submit', { 
          quiz_id: quizId,
          target_topics: [topic],
          score: isCorrect ? score : score, // Score state already updated in handleAnswerSelect
          total_questions: questions.length,
          responses: updatedResponses,
          completed_at: new Date().toISOString()
        });
      } catch (err) {
        console.error("Submission failed:", err);
      }
    }
  };

  // ─── Quick action: restart ─────────────────────────────────────────────────
  const handleRestart = () => {
    setQuestions([]);
    setTopic('');
    setScore(0);
    setUserResponses([]); // 🔴 FIX: Clear responses
    setCurrentIndex(0);
    resetTurnState();
    setPhase('topic_input');
  };

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 1: TOPIC INPUT
  // ══════════════════════════════════════════════════════════════════════════
  if (phase === 'topic_input') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-6rem)] p-6 relative">
        <AmbientOrbs />

        <motion.div
          initial={{ opacity: 0, y: 32 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 120, damping: 18 }}
          className="w-full max-w-lg"
        >
          {/* Header badge */}
          <div className="flex justify-center mb-8">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.15, type: 'spring', stiffness: 180 }}
              className="flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-800/80 border border-slate-700/60 backdrop-blur-sm text-xs font-bold tracking-widest uppercase text-cyan-400"
              style={{ boxShadow: '0 0 16px rgba(34,211,238,0.12)' }}
            >
              <Flame className="w-3.5 h-3.5" />
              Daily Revision Arena
            </motion.div>
          </div>

          {/* Headline */}
          <div className="text-center mb-10 space-y-3">
            <h1 className="text-4xl sm:text-5xl font-headline font-extrabold text-white leading-tight">
              Forge Your{' '}
              <span
                className="bg-clip-text text-transparent"
                style={{ backgroundImage: 'linear-gradient(135deg, #22d3ee 0%, #a78bfa 100%)' }}
              >
                Challenge
              </span>
            </h1>
            <p className="text-slate-400 text-sm max-w-sm mx-auto leading-relaxed">
              Target a concept. The AI Tutor crafts 5 tailored MCQs to beat your forgetting curve.
            </p>
          </div>

          {/* Input card with glow ring on focus */}
          <div
            className="relative rounded-2xl p-0.5 transition-all duration-300"
            style={{
              background: inputFocused
                ? 'linear-gradient(135deg, #22d3ee55, #a78bfa55)'
                : 'linear-gradient(135deg, #334155, #1e293b)',
              boxShadow: inputFocused ? '0 0 32px rgba(34,211,238,0.18), 0 0 64px rgba(167,139,250,0.1)' : 'none',
            }}
          >
            <div className="bg-slate-900 rounded-[14px] p-6 space-y-5">
              <div className="relative">
                <Target className="absolute left-4 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-slate-500" />
                <input
                  ref={inputRef}
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  onFocus={() => setInputFocused(true)}
                  onBlur={() => setInputFocused(false)}
                  onKeyDown={(e) => e.key === 'Enter' && handleStartRevision()}
                  placeholder="Ask the AI Tutor to forge your customized Arena... (e.g., Photosynthesis)"
                  className="w-full bg-slate-800/60 text-white placeholder-slate-500 pl-11 pr-4 py-4 rounded-xl text-sm outline-none focus:bg-slate-800 transition-all"
                />
              </div>

              <motion.button
                onClick={handleStartRevision}
                disabled={!topic.trim()}
                whileHover={topic.trim() ? { scale: 1.015 } : {}}
                whileTap={topic.trim() ? { scale: 0.975 } : {}}
                className="relative w-full py-4 rounded-xl font-bold text-sm text-white overflow-hidden disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                style={{
                  background: 'linear-gradient(135deg, #0891b2 0%, #7c3aed 100%)',
                  boxShadow: topic.trim() ? '0 0 24px rgba(8,145,178,0.4), 0 0 48px rgba(124,58,237,0.2)' : 'none',
                }}
              >
                {/* Shimmer sweep on hover */}
                <motion.span
                  className="absolute inset-0 opacity-0 hover:opacity-100"
                  style={{ background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.12) 50%, transparent 60%)' }}
                  animate={{ x: ['-100%', '200%'] }}
                  transition={{ repeat: Infinity, duration: 2.5, ease: 'linear' }}
                />
                <span className="relative flex items-center justify-center gap-2">
                  <Sparkles className="w-4 h-4" />
                  Initialize Arena
                </span>
              </motion.button>
            </div>
          </div>

          {/* Footer hints */}
          <div className="flex justify-center gap-6 mt-6 text-xs text-slate-600">
            {['Algebra', 'Graph Theory', 'World History', 'Cell Biology'].map((s) => (
              <button
                key={s}
                onClick={() => setTopic(s)}
                className="hover:text-slate-300 transition-colors duration-200"
              >
                {s}
              </button>
            ))}
          </div>
        </motion.div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 2: LLM LOADING (Skeleton Screen)
  // ══════════════════════════════════════════════════════════════════════════
  if (phase === 'llm_loading') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-6rem)] p-6">
        <AmbientOrbs />
        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 140, damping: 16 }}
          className="w-full max-w-xl space-y-6"
        >
          {/* Spinning brain icon */}
          <div className="flex flex-col items-center gap-4 mb-4">
            <div className="relative">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ repeat: Infinity, duration: 3, ease: 'linear' }}
                className="w-14 h-14 rounded-full"
                style={{
                  background: 'conic-gradient(from 0deg, #22d3ee, #a78bfa, #22d3ee)',
                  padding: '2px',
                }}
              >
                <div className="w-full h-full rounded-full bg-slate-900 flex items-center justify-center">
                  <BrainCircuit className="w-7 h-7 text-cyan-400" />
                </div>
              </motion.div>
              <motion.div
                animate={{ scale: [1, 1.4, 1], opacity: [0.5, 0, 0.5] }}
                transition={{ repeat: Infinity, duration: 2, ease: 'easeOut' }}
                className="absolute inset-0 rounded-full border border-cyan-400/40"
              />
            </div>
            <motion.p
              animate={{ opacity: [0.6, 1, 0.6] }}
              transition={{ repeat: Infinity, duration: 2.2, ease: 'easeInOut' }}
              className="text-sm text-slate-400 text-center max-w-xs"
            >
              Tutor is synthesizing 5 tailored challenges for{' '}
              <span className="text-cyan-400 font-semibold">{topic}</span>{' '}
              based on your course topics...
            </motion.p>
          </div>

          {/* Skeleton MCQ card */}
          <div className="bg-slate-800/50 border border-slate-700/40 rounded-2xl p-6 space-y-5 backdrop-blur-sm">
            <SkeletonBlock className="h-5 w-1/3" />
            <SkeletonBlock className="h-7 w-full" />
            <SkeletonBlock className="h-5 w-5/6" />
            <div className="grid grid-cols-1 gap-3 pt-2">
              {[0, 1, 2, 3].map((i) => (
                <SkeletonBlock key={i} className={`h-14 w-full`} style={{ animationDelay: `${i * 0.1}s` }} />
              ))}
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 5: RESULTS
  // ══════════════════════════════════════════════════════════════════════════
  if (phase === 'results') {
    const pct = questions.length > 0 ? score / questions.length : 0;
    const isGood = pct >= 0.6;
    const xpGained = Math.round(pct * 120);
    const eloDelta = isGood ? `+${Math.round(pct * 28)}` : `-${Math.round((1 - pct) * 18)}`;

    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-6rem)] p-6 relative">
        <AmbientOrbs />

        <motion.div
          initial={{ opacity: 0, scale: 0.88 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ type: 'spring', stiffness: 140, damping: 16 }}
          className="w-full max-w-md relative"
        >
          {/* Aura glow behind card */}
          <motion.div
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3, duration: 0.8, ease: 'easeOut' }}
            className="absolute inset-0 rounded-3xl blur-2xl"
            style={{
              background: isGood
                ? 'linear-gradient(135deg, rgba(34,211,238,0.12) 0%, rgba(167,139,250,0.12) 100%)'
                : 'rgba(239,68,68,0.08)',
              transform: 'scale(1.08)',
            }}
          />

          <div
            className="relative bg-slate-900/90 backdrop-blur-xl border border-slate-700/50 rounded-3xl p-8 flex flex-col items-center gap-7 text-center"
            style={{
              boxShadow: isGood
                ? '0 0 0 1px rgba(34,211,238,0.2), 0 24px 64px rgba(0,0,0,0.5)'
                : '0 24px 64px rgba(0,0,0,0.4)',
            }}
          >
            {/* Trophy Icon */}
            <motion.div
              initial={{ y: -12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
              className={`p-3 rounded-2xl ${isGood ? 'bg-cyan-500/10' : 'bg-rose-500/10'}`}
            >
              <Trophy className={`w-7 h-7 ${isGood ? 'text-cyan-400' : 'text-rose-400'}`} />
            </motion.div>

            <div>
              <h2 className="text-3xl font-headline font-extrabold text-white mb-1">
                {isGood ? 'Arena Conquered' : 'Keep Training'}
              </h2>
              <p className="text-slate-500 text-sm">
                {isGood ? `You've mastered the ${topic} battlefield.` : `${topic} needs more practice.`}
              </p>
            </div>

            {/* Score Ring */}
            <RadialRing score={score} total={questions.length} />

            {/* SRS Calibration text */}
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.7 }}
              className="flex items-start gap-3 bg-violet-500/8 border border-violet-500/20 rounded-xl px-4 py-3 text-left w-full"
            >
              <BookOpen className="w-4 h-4 text-violet-400 mt-0.5 flex-shrink-0" />
              <p className="text-xs text-slate-400 leading-relaxed">
                <span className="text-violet-300 font-semibold">Tutor has calibrated your SRS learning decay;</span>{' '}
                expect personalized review topics for{' '}
                <span className="text-violet-300 font-semibold">{topic}</span> soon.
              </p>
            </motion.div>

            {/* XP + Elo stats */}
            <div className="grid grid-cols-2 gap-4 w-full">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.55 }}
                className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40 text-center"
              >
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <Star className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">XP Gained</span>
                </div>
                <p className="text-2xl font-headline font-extrabold text-amber-400">+{xpGained}</p>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.65 }}
                className="bg-slate-800/60 rounded-xl p-4 border border-slate-700/40 text-center"
              >
                <div className="flex items-center justify-center gap-1.5 mb-1">
                  <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
                  <span className="text-[10px] uppercase tracking-widest text-slate-500 font-bold">Elo Change</span>
                </div>
                <p className={`text-2xl font-headline font-extrabold ${isGood ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {eloDelta}
                </p>
              </motion.div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col gap-3 w-full">
              <motion.button
                onClick={handleRestart}
                whileHover={{ scale: 1.015 }}
                whileTap={{ scale: 0.975 }}
                className="w-full py-3.5 rounded-xl font-bold text-sm text-white flex items-center justify-center gap-2"
                style={{ background: 'linear-gradient(135deg, #0891b2 0%, #7c3aed 100%)', boxShadow: '0 0 20px rgba(8,145,178,0.3)' }}
              >
                <RefreshCw className="w-4 h-4" />
                New Arena
              </motion.button>
              <button
                onClick={() => navigate('/')}
                className="w-full py-3 rounded-xl font-semibold text-sm text-slate-400 hover:text-white border border-slate-700/60 hover:border-slate-500 transition-all"
              >
                Return to Dashboard
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PHASE 3 & 4: ACTIVE QUIZ + SOCRATIC TUTOR
  // ══════════════════════════════════════════════════════════════════════════
  const currentQuestion = questions[currentIndex];
  const progressPct = ((currentIndex) / questions.length) * 100;

  // Option styling logic
  const getOptionStyle = (option) => {
    const isSelected = selectedAnswer === option;
    const isActualCorrect = option === currentQuestion.correct_answer;

    if (selectedAnswer === null) {
      return {
        base: 'bg-slate-800/60 border-slate-700/50 text-slate-200 hover:bg-slate-700/60 hover:border-slate-500/70',
        glow: '',
        icon: null,
        animateProps: {},
      };
    }

    if (isSelected && isCorrect) {
      return {
        base: 'bg-emerald-950/40 border-emerald-500/60 text-emerald-300',
        glow: '0 0 0 1px rgba(52,211,153,0.4), 0 0 24px rgba(52,211,153,0.12)',
        icon: <CheckCircle className="w-5 h-5 text-emerald-400 flex-shrink-0" />,
        animateProps: { scale: [1, 1.025, 1] },
      };
    }

    if (isSelected && !isCorrect) {
      return {
        base: 'bg-rose-950/40 border-rose-500/60 text-rose-300',
        glow: '0 0 0 1px rgba(248,113,113,0.4)',
        icon: <XCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />,
        animateProps: { x: [0, -8, 8, -6, 6, -3, 3, 0], transition: { duration: 0.5 } },
      };
    }

    if (!isSelected && isActualCorrect) {
      return {
        base: 'bg-emerald-950/20 border-emerald-600/40 text-emerald-400/80',
        glow: '0 0 16px rgba(52,211,153,0.08)',
        icon: <CheckCircle className="w-5 h-5 text-emerald-500/70 flex-shrink-0" />,
        animateProps: {},
      };
    }

    return {
      base: 'bg-slate-800/30 border-slate-700/30 text-slate-500 opacity-50',
      glow: '',
      icon: null,
      animateProps: {},
    };
  };

  return (
    <div className="max-w-2xl mx-auto py-8 px-4 min-h-[calc(100vh-6rem)] flex flex-col relative">
      <AmbientOrbs />

      {/* ── Top Header: Progress ──────────────────────────────────────────────── */}
      <div className="mb-8 space-y-3">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div
              className="p-1.5 rounded-lg"
              style={{ background: 'linear-gradient(135deg, rgba(34,211,238,0.15), rgba(167,139,250,0.15))' }}
            >
              <Target className="w-4 h-4 text-cyan-400" />
            </div>
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">{topic}</span>
          </div>
          <span className="text-xs font-bold text-slate-500 font-headline tabular-nums">
            {currentIndex + 1} <span className="text-slate-700">/ {questions.length}</span>
          </span>
        </div>

        {/* Gradient progress bar */}
        <div className="relative h-1.5 bg-slate-800 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${progressPct}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              background: 'linear-gradient(90deg, #22d3ee, #a78bfa)',
              boxShadow: '0 0 8px rgba(34,211,238,0.5)',
            }}
          />
        </div>

        {/* Dot indicators */}
        <div className="flex gap-1.5">
          {questions.map((_, i) => (
            <motion.div
              key={i}
              animate={{
                backgroundColor: i < currentIndex
                  ? 'rgba(34,211,238,0.5)'
                  : i === currentIndex
                  ? '#22d3ee'
                  : 'rgba(51,65,85,0.6)',
                boxShadow: i === currentIndex ? '0 0 8px rgba(34,211,238,0.6)' : 'none',
              }}
              className="flex-1 h-1 rounded-full transition-all duration-300"
            />
          ))}
        </div>
      </div>

      {/* ── Question Card ─────────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col gap-5">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={currentIndex}
            custom={direction}
            variants={{
              enter: (d) => ({ opacity: 0, x: d > 0 ? 60 : -60, scale: 0.97 }),
              center: { opacity: 1, x: 0, scale: 1 },
              exit: (d) => ({ opacity: 0, x: d > 0 ? -60 : 60, scale: 0.97 }),
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            className="space-y-5"
          >
            {/* Question text */}
            <div className="bg-slate-800/50 backdrop-blur-sm border border-slate-700/40 rounded-2xl p-6">
              <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-500/80 mb-3 block">
                Challenge {currentIndex + 1} of {questions.length}
              </span>
              <h2 className="text-xl sm:text-2xl font-headline font-semibold text-white leading-snug">
                {currentQuestion.question}
              </h2>
            </div>

            {/* Options */}
            <div className="grid grid-cols-1 gap-3">
              {currentQuestion.options.map((option, idx) => {
                const style = getOptionStyle(option);
                return (
                  <motion.button
                    key={idx}
                    onClick={() => handleAnswerSelect(option)}
                    disabled={selectedAnswer !== null}
                    animate={style.animateProps}
                    whileHover={selectedAnswer === null ? { scale: 1.012, x: 3 } : {}}
                    whileTap={selectedAnswer === null ? { scale: 0.985 } : {}}
                    className={`relative w-full text-left px-5 py-4 rounded-xl border-2 transition-all duration-250 font-medium text-sm sm:text-base flex items-center gap-4 ${style.base}`}
                    style={{ boxShadow: style.glow || 'none' }}
                  >
                    {/* Option letter badge */}
                    <span
                      className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-xs font-bold border border-current opacity-60"
                    >
                      {String.fromCharCode(65 + idx)}
                    </span>
                    <span className="flex-1">{option}</span>
                    {style.icon}
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        </AnimatePresence>

        {/* ── Post-Answer Section ────────────────────────────────────────────── */}
        <AnimatePresence>
          {selectedAnswer !== null && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
              className="overflow-hidden space-y-4"
            >
              {/* ── Correct: Explanation slide-down ─────────── */}
              {isCorrect && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="bg-emerald-950/30 border border-emerald-500/25 rounded-xl p-5"
                  style={{ boxShadow: '0 0 24px rgba(52,211,153,0.08)' }}
                >
                  <p className="text-emerald-400 font-bold flex items-center gap-2 mb-2 text-sm">
                    <CheckCircle className="w-4 h-4" /> Bullseye! Correct Approach
                  </p>
                  <p className="text-slate-300 text-sm leading-relaxed">{currentQuestion.explanation}</p>
                </motion.div>
              )}

              {/* ── Wrong: Socratic Panel ──────────────────── */}
              {!isCorrect && (phase === 'socratic_tutor') && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 200, damping: 22-1 }}
                  className="bg-slate-800/60 backdrop-blur-sm border border-rose-500/20 rounded-2xl p-6 space-y-5"
                  style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04)' }}
                >
                  <div>
                    <h3 className="text-rose-400 font-headline font-bold flex items-center gap-2 text-base mb-1">
                      <BrainCircuit className="w-5 h-5" /> Logic Break Detected
                    </h3>
                    <p className="text-slate-500 text-xs leading-relaxed">
                      Expose your reasoning to the AI Tutor — it'll pinpoint exactly where the misconception occurred.
                    </p>
                  </div>

                  {/* Correct answer hint */}
                  <div className="bg-emerald-950/20 border border-emerald-600/25 rounded-xl px-4 py-3">
                    <p className="text-xs text-slate-500 mb-0.5">Correct Answer</p>
                    <p className="text-emerald-400 font-semibold text-sm">{currentQuestion.correct_answer}</p>
                  </div>

                  {/* Two-column layout on md+ */}
                  {!aiTutorFeedback ? (
                    <div className="flex flex-col md:flex-row gap-4">
                      <div className="flex-1 space-y-3">
                        <textarea
                          value={approachText}
                          onChange={(e) => setApproachText(e.target.value)}
                          placeholder="Describe your logic step-by-step... (e.g., I used the center of mass as pivot because...)"
                          rows={4}
                          className="w-full bg-slate-900/70 border border-slate-700/60 rounded-xl px-4 py-3 text-sm text-slate-200 placeholder-slate-600 outline-none focus:border-violet-500/50 focus:ring-1 focus:ring-violet-500/30 resize-none transition-all"
                          disabled={isCheckingApproach}
                        />
                        <motion.button
                          onClick={handleDiagnose}
                          disabled={!approachText.trim() || isCheckingApproach}
                          whileHover={approachText.trim() && !isCheckingApproach ? { scale: 1.015 } : {}}
                          whileTap={approachText.trim() && !isCheckingApproach ? { scale: 0.975 } : {}}
                          className="w-full flex justify-center items-center gap-2 py-3 rounded-xl font-bold text-sm text-white disabled:opacity-40 transition-all"
                          style={{
                            background: 'linear-gradient(135deg, #6d28d9, #4c1d95)',
                            boxShadow: approachText.trim() ? '0 0 16px rgba(109,40,217,0.35)' : 'none',
                          }}
                        >
                          {isCheckingApproach ? (
                            <><Loader2 className="w-4 h-4 animate-spin" /> Deep Analyzing...</>
                          ) : (
                            <><Zap className="w-4 h-4" /> Diagnose Approach</>
                          )}
                        </motion.button>
                      </div>
                    </div>
                  ) : (
                    /* AI Tutor feedback box */
                    <motion.div
                      initial={{ opacity: 0, scale: 0.96 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ type: 'spring', stiffness: 180, damping: 18 }}
                      className="bg-violet-950/30 border border-violet-500/25 rounded-xl p-5 backdrop-blur-sm"
                      style={{ boxShadow: '0 0 24px rgba(139,92,246,0.1)' }}
                    >
                      <p className="text-xs font-bold tracking-widest uppercase text-violet-400 flex items-center gap-1.5 mb-3">
                        <Sparkles className="w-3.5 h-3.5" /> AI Tutor Insight
                      </p>
                      <p className="text-slate-300 text-sm leading-relaxed">{aiTutorFeedback}</p>
                      <p className="text-[11px] text-slate-500 mt-3 leading-relaxed border-t border-slate-700/40 pt-3">
                        Correct: <span className="text-violet-300 font-medium">{currentQuestion.explanation}</span>
                      </p>
                    </motion.div>
                  )}
                </motion.div>
              )}

              {/* ── Next / Finish Button ───────────────────── */}
              <div className="flex justify-end">
                <motion.button
                  onClick={handleNext}
                  whileHover={{ scale: 1.02, x: 2 }}
                  whileTap={{ scale: 0.97 }}
                  className="flex items-center gap-2 px-7 py-3 rounded-xl font-bold text-sm text-white transition-all"
                  style={{
                    background: 'linear-gradient(135deg, #0891b2 0%, #7c3aed 100%)',
                    boxShadow: '0 0 20px rgba(8,145,178,0.3)',
                  }}
                >
                  {currentIndex === questions.length - 1 ? (
                    <><Trophy className="w-4 h-4" /> Finish Arena</>
                  ) : (
                    <>Next Challenge <ChevronRight className="w-4 h-4" /></>
                  )}
                </motion.button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
