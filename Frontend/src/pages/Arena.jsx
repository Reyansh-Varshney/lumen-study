import { useState, useEffect, useRef, useCallback } from 'react';
// eslint-disable-next-line no-unused-vars
import { motion, AnimatePresence } from 'framer-motion';
import { Radar, Swords, Trophy, Loader2, ArrowRight, Timer } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../api/axios';

// ─── EASILY CONFIGURABLE CONSTANT ───────────────────────────────────────────
// Change this to adjust how many seconds each question allows.
const SECONDS_PER_QUESTION = 30;
// ─────────────────────────────────────────────────────────────────────────────

export default function Arena() {
  const [matchState, setMatchState] = useState('searching'); // 'searching' | 'battling' | 'waiting_for_opponent' | 'finished'
  const [opponent, setOpponent] = useState(null);
  const [subject, setSubject] = useState('General Studies');

  // Battle state
  const [questions, setQuestions] = useState([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [playerScore, setPlayerScore] = useState(0);
  const [opponentScore, setOpponentScore] = useState(0);

  // Turn interaction state
  const [selectedAnswer, setSelectedAnswer] = useState(null);

  // ─── Phase 1: Timer State ───────────────────────────────────────────────────
  const [timeLeft, setTimeLeft] = useState(SECONDS_PER_QUESTION);

  // Results state
  const [resultsData, setResultsData] = useState(null);

  const ws = useRef(null);
  // Use a ref to track the "advancing" flag so interval callbacks can read the 
  // most up-to-date value without stale closures.
  const isAdvancing = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();

  // Pull the navigation state out into stable primitives so the WebSocket
  // effect can depend on them without re-subscribing on every render.
  const matchMode = location.state?.mode;
  const matchTopic = location.state?.topic;
  const matchDocIds = location.state?.activeDocIds;

  // ─── WebSocket Connection & Message Handler ─────────────────────────────────
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      navigate('/auth');
      return;
    }

    api.get('/auth/me').then(res => {
      const firstSubject = res.data?.active_subjects?.[0];
      if (firstSubject) setSubject(firstSubject);
    }).catch(err => console.error(err));

    ws.current = new WebSocket(`ws://localhost:8000/ws/arena?token=${token}`);

    ws.current.onopen = () => {
      if (matchMode === 'resource_bot') {
        ws.current.send(JSON.stringify({
          type: "RESOURCE_BOT_MATCH",
          active_doc_ids: matchDocIds
        }));
      } else if (matchMode === 'topic_bot') {
        ws.current.send(JSON.stringify({
          type: "TOPIC_BOT_MATCH",
          topic: matchTopic
        }));
      } else if (matchMode === 'adaptive_bot') {
        ws.current.send(JSON.stringify({
          type: "ADAPTIVE_BOT_MATCH",
          topic: matchTopic
        }));
      }
    };

    ws.current.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('WS Received:', data);
      const type = data.type?.toUpperCase() || '';

      if (type === 'MATCH_FOUND') {
        setOpponent(data.opponent);
      } else if (type === 'BATTLE_START') {
        setQuestions(data.questions);
        setCurrentQuestionIndex(0);
        setPlayerScore(0);
        setOpponentScore(0);
        setSelectedAnswer(null);
        setTimeLeft(SECONDS_PER_QUESTION);
        isAdvancing.current = false;
        setMatchState('battling');
      } else if (type === 'OPPONENT_PROGRESS') {
        setOpponentScore(data.opponent_score !== undefined ? data.opponent_score : data.score);
      } else if (type === 'WAITING_FOR_OPPONENT') {
        setMatchState('waiting_for_opponent');
        setPlayerScore(data.your_score);
      } else if (type === 'MATCH_OVER') {
        setResultsData(data);
        setMatchState('finished');
      } else if (type === 'ERROR') {
        console.error('Arena Error:', data.message);
      }
    };

    ws.current.onerror = (error) => console.error('WebSocket Error:', error);

    return () => {
      if (ws.current) ws.current.close();
    };
  }, [navigate, matchMode, matchTopic, matchDocIds]);

  // ─── Phase 2 & 3: Countdown Engine + Auto-Advance ──────────────────────────
  // Defined with useCallback so the interval cleanup stays stable.
  const advanceQuestion = useCallback((timedOut = false) => {
    // Guard: don't fire twice if both the timer and an answer click race.
    if (isAdvancing.current) return;
    isAdvancing.current = true;

    // Fire WS payload — timeout uses is_correct: false, mimicking a wrong answer.
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'ANSWER_SUBMITTED',
        question_idx: currentQuestionIndex,
        is_correct: false,
        timed_out: timedOut,
        time_taken: timedOut ? 30 : 30,
      }));
    }

    // Give UI a short pause then advance
    setTimeout(() => {
      setCurrentQuestionIndex((prev) => {
        // prev + 1 is checked inside the setter to avoid stale closure on `questions.length`
        return prev + 1;
      });
      setSelectedAnswer(null);
      setTimeLeft(SECONDS_PER_QUESTION);
      isAdvancing.current = false;
    }, timedOut ? 600 : 1500);

  }, [currentQuestionIndex]);

  // Main Countdown Effect — depends on currentIndex so it resets each question.
  useEffect(() => {
    if (matchState !== 'battling') return;

    // Reset for new question
    setTimeLeft(SECONDS_PER_QUESTION);
    isAdvancing.current = false;

    const interval = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          // CRITICAL: clear interval synchronously before triggering side effects
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // ── MEMORY LEAK PREVENTION ─────────────────────────────────────────────
    return () => clearInterval(interval);

  }, [currentQuestionIndex, matchState]);

  // Watch timeLeft — when it hits 0, trigger the timeout handler.
  useEffect(() => {
    if (matchState !== 'battling') return;
    if (timeLeft !== 0) return;
    if (selectedAnswer !== null) return; // Already answered — let the normal flow run.
    if (isAdvancing.current) return;

    advanceQuestion(true);
  }, [timeLeft, matchState]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Normal Answer Handler ──────────────────────────────────────────────────
  const handleAnswerClick = (option) => {
    if (selectedAnswer !== null || isAdvancing.current) return;

    const correct = option === questions[currentQuestionIndex]?.correct_answer;
    setSelectedAnswer(option);

    if (correct) setPlayerScore((prev) => prev + 1);

    const timeTaken = 30 - timeLeft;

    // Send standard WS payload
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'ANSWER_SUBMITTED',
        question_idx: currentQuestionIndex,
        is_correct: correct,
        timed_out: false,
        time_taken: timeTaken,
      }));
    }

    // Auto-advance after displaying feedback
    isAdvancing.current = true;
    setTimeout(() => {
      setCurrentQuestionIndex((prev) => prev + 1);
      setSelectedAnswer(null);
      setTimeLeft(SECONDS_PER_QUESTION);
      isAdvancing.current = false;
    }, 1500);
  };

  // ─── Timer Color Logic ──────────────────────────────────────────────────────
  const getTimerClass = () => {
    if (timeLeft <= 5)  return 'text-rose-500 animate-pulse';
    if (timeLeft <= 10) return 'text-amber-400';
    return 'text-emerald-400';
  };

  const getBarClass = () => {
    if (timeLeft <= 5)  return 'bg-rose-500';
    if (timeLeft <= 10) return 'bg-amber-400';
    return 'bg-emerald-400';
  };

  const progressPercent = (timeLeft / SECONDS_PER_QUESTION) * 100;

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENE: MATCHMAKING
  // ═══════════════════════════════════════════════════════════════════════════
  if (matchState === 'searching') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-6rem)] relative overflow-hidden">
        <motion.div
          animate={{ scale: [1, 2, 2.5], opacity: [0.8, 0.4, 0] }}
          transition={{ repeat: Infinity, duration: 2, ease: 'easeOut' }}
          className="absolute w-64 h-64 border-2 border-primary rounded-full"
        />
        <motion.div
          animate={{ scale: [1, 2, 2.5], opacity: [0.8, 0.4, 0] }}
          transition={{ repeat: Infinity, duration: 2, delay: 0.6, ease: 'easeOut' }}
          className="absolute w-64 h-64 border-2 border-primary rounded-full"
        />

        <div className="z-10 flex flex-col items-center bg-surface-container-high/80 backdrop-blur-md p-10 rounded-2xl border border-outline-variant/20 shadow-2xl">
          <div className="p-4 bg-primary/10 rounded-full mb-6">
            <Radar className="w-12 h-12 text-primary animate-pulse" />
          </div>
          <h2 className="text-3xl font-headline font-bold text-on-surface mb-2">Finding Opponent</h2>
          <div className="bg-primary/20 text-primary px-4 py-1.5 rounded-full font-bold text-sm tracking-widest mb-4 border border-primary/30 shadow-[0_0_10px_rgba(14,165,233,0.2)]">
            {subject} PRACTICE
          </div>
          <p className="text-on-surface-variant text-sm flex items-center gap-2">
            Searching global queue...
            <Loader2 className="w-3 h-3 animate-spin" />
          </p>

          <AnimatePresence>
            {opponent && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mt-6 px-6 py-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-500 font-bold flex items-center gap-3"
              >
                <Swords className="w-5 h-5" />
                Match Found: {opponent}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENE: WAITING FOR OPPONENT
  // ═══════════════════════════════════════════════════════════════════════════
  if (matchState === 'waiting_for_opponent') {
    const maxScore = questions.length || 5;
    return (
      <div className="flex flex-col items-center justify-center min-h-[calc(100vh-6rem)] relative overflow-hidden">
        <div className="z-10 flex flex-col items-center bg-surface-container-high/80 backdrop-blur-md p-10 rounded-2xl border border-outline-variant/20 shadow-2xl w-full max-w-md">
          <Loader2 className="w-16 h-16 text-primary animate-spin mb-6" />
          <h2 className="text-3xl font-headline font-bold text-on-surface mb-2">Nail-Biter!</h2>
          <p className="text-on-surface-variant text-lg font-medium mb-6">
            You scored {playerScore}/{maxScore}!
          </p>
          <div className="w-full bg-surface-container-lowest p-6 rounded-xl border border-outline-variant/10 text-center">
            <p className="text-sm text-on-surface-variant uppercase tracking-widest font-bold mb-4">Opponent Progress</p>
            <div className="w-full h-4 bg-surface-container-highest rounded-full overflow-hidden shadow-inner mb-2">
              <motion.div
                animate={{ width: `${(opponentScore / maxScore) * 100}%` }}
                className="h-full bg-error"
                transition={{ duration: 0.5 }}
              />
            </div>
            <p className="text-error font-bold text-sm">{opponentScore} / {maxScore}</p>
          </div>
          <p className="mt-6 text-sm text-primary font-bold animate-pulse">Waiting for opponent to finish...</p>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENE: RESULTS
  // ═══════════════════════════════════════════════════════════════════════════
  if (matchState === 'finished') {
    const isForfeit = resultsData?.reason === 'opponent_disconnected';
    const isWinner = isForfeit || (resultsData?.your_score > resultsData?.opponent_score);
    const isDraw = !isForfeit && (resultsData?.your_score === resultsData?.opponent_score);
    const newElo = resultsData?.your_new_elo ?? resultsData?.new_elo;

    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col items-center justify-center min-h-[calc(100vh-6rem)]"
      >
        <div className={`p-10 rounded-3xl border w-full max-w-lg text-center backdrop-blur-xl ${isWinner ? 'bg-primary/5 border-primary/30 shadow-[0_0_50px_rgba(14,165,233,0.15)]' : 'bg-surface-container-high border-error/20'}`}>
          <div className="mb-6 flex justify-center">
            {isWinner ? (
              <div className="p-6 bg-primary/20 rounded-full">
                <Trophy className="w-16 h-16 text-primary" />
              </div>
            ) : (
              <div className="p-6 bg-error/10 rounded-full">
                <Swords className="w-16 h-16 text-error opacity-70" />
              </div>
            )}
          </div>

          <h1 className="text-4xl font-headline font-extrabold mb-4 text-on-surface">
            {isForfeit ? 'Opponent Fled!' : isWinner ? 'Victory!' : isDraw ? 'Draw!' : 'Defeat'}
          </h1>
          
          {isForfeit && (
            <div className="mb-6 inline-block text-emerald-400 font-bold bg-emerald-500/10 px-4 py-2 rounded-lg border border-emerald-500/20 shadow-md">
              {resultsData?.message}
            </div>
          )}

          <div className="my-8 flex justify-center gap-6">
            <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/10 text-center flex-1">
              <p className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold mb-1">New Elo</p>
              <p className="text-3xl font-headline font-bold text-tertiary">{newElo}</p>
            </div>
            {!isForfeit && (
              <div className="bg-surface-container-lowest p-4 rounded-xl border border-outline-variant/10 text-center flex-1">
                <p className="text-[10px] uppercase tracking-widest text-on-surface-variant font-bold mb-1">Score</p>
                <p className="text-3xl font-headline font-bold text-on-surface">
                  <span className="text-primary">{resultsData?.your_score}</span>
                  <span className="text-on-surface-variant mx-1">-</span>
                  <span className="text-error">{resultsData?.opponent_score}</span>
                </p>
              </div>
            )}
          </div>

          <button
            onClick={() => navigate('/')}
            className="w-full py-4 bg-on-surface hover:bg-on-surface-variant text-surface font-bold rounded-xl transition-all shadow-lg text-sm flex items-center justify-center gap-2"
          >
            Leave Arena <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </motion.div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SCENE: BATTLE
  // ═══════════════════════════════════════════════════════════════════════════
  const currentQuestion = questions[currentQuestionIndex];
  const maxScore = questions.length || 5;
  const playerProgress  = (playerScore  / maxScore) * 100;
  const opponentProgress = (opponentScore / maxScore) * 100;

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 flex flex-col gap-6">

      {/* ── Phase 4: Timer Display ─────────────────────────────────────────── */}
      <div className="flex flex-col items-center gap-2">
        <div className={`flex items-center gap-2 text-3xl font-headline font-extrabold tabular-nums transition-colors duration-500 ${getTimerClass()}`}>
          <Timer className="w-6 h-6" />
          {String(timeLeft).padStart(2, '0')}
          <span className="text-sm font-body text-on-surface-variant">sec</span>
        </div>
        {/* Progress bar — thin strip below the number */}
        <div className="w-64 h-2 bg-surface-container-highest rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-1000 ease-linear ${getBarClass()}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* ── HUD: Dual Progress Bars ──────────────────────────────────────────── */}
      <div className="flex gap-8 items-center bg-surface-container-high p-4 rounded-2xl shadow-xl border border-outline-variant/5">
        <div className="flex-1">
          <div className="flex justify-between mb-2">
            <span className="text-primary font-bold text-xs uppercase tracking-widest">You</span>
            <span className="text-primary font-bold">{playerScore}/{maxScore}</span>
          </div>
          <div className="w-full h-3 bg-surface-container-lowest rounded-full overflow-hidden shadow-inner">
            <motion.div
              animate={{ width: `${playerProgress}%` }}
              className="h-full bg-primary"
            />
          </div>
        </div>

        <Swords className="w-6 h-6 text-on-surface-variant opacity-50 flex-shrink-0" />

        <div className="flex-1">
          <div className="flex justify-between mb-2">
            <span className="text-error font-bold text-xs uppercase tracking-widest">{opponent || 'Opponent'}</span>
            <span className="text-error font-bold">{opponentScore}/{maxScore}</span>
          </div>
          <div className="w-full h-3 bg-surface-container-lowest rounded-full overflow-hidden shadow-inner">
            <motion.div
              animate={{ width: `${opponentProgress}%` }}
              className="h-full bg-error"
            />
          </div>
        </div>
      </div>

      {/* ── Question Area ─────────────────────────────────────────────────────── */}
      <AnimatePresence mode="wait">
        {currentQuestion && (
          <motion.div
            key={currentQuestionIndex}
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -50 }}
            className="bg-surface-container-low border border-outline-variant/10 rounded-2xl p-8 shadow-lg flex flex-col gap-8"
          >
            <div className="text-center">
              <span className="inline-block py-1 px-3 bg-surface-container-high rounded-full text-[10px] font-bold tracking-widest uppercase text-on-surface-variant mb-4 border border-outline-variant/5">
                Round {currentQuestionIndex + 1}
              </span>
              <h2 className="text-2xl lg:text-3xl font-headline font-semibold text-on-surface leading-snug">
                {currentQuestion.question}
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* eslint-disable-next-line react-hooks/refs */}
              {currentQuestion.options.map((option, idx) => {
                const isSelected = selectedAnswer === option;
                const isCorrect  = option === currentQuestion.correct_answer;

                let btnState = 'bg-surface-container-lowest hover:bg-surface-container-high hover:border-outline-variant/30 text-on-surface border-outline-variant/10';

                if (selectedAnswer !== null) {
                  if (isSelected && isCorrect) {
                    btnState = 'bg-emerald-500/10 border-emerald-500 text-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.3)] ring-2 ring-emerald-500';
                  } else if (isSelected && !isCorrect) {
                    btnState = 'bg-rose-500/10 border-rose-500 text-rose-500 ring-2 ring-rose-500';
                  } else if (isCorrect) {
                    btnState = 'bg-emerald-500/5 border-emerald-500/50 text-emerald-500/70';
                  } else {
                    btnState = 'bg-surface-container-highest border-outline-variant/5 text-on-surface-variant opacity-40';
                  }
                }

                return (
                  <motion.button
                    key={idx}
                    onClick={() => handleAnswerClick(option)}
                    disabled={selectedAnswer !== null || isAdvancing.current}
                    whileHover={selectedAnswer === null ? { scale: 1.02 } : {}}
                    whileTap={selectedAnswer  === null ? { scale: 0.98 } : {}}
                    animate={isSelected && !isCorrect ? { x: [-5, 5, -5, 5, 0], transition: { duration: 0.3 } } : {}}
                    className={`p-6 rounded-xl border-2 text-left font-medium text-lg transition-colors duration-200 ${btnState}`}
                  >
                    {option}
                  </motion.button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
