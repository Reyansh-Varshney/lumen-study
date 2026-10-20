import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { ShieldAlert, Maximize, AlertTriangle, Timer, CheckCircle, ArrowRight, ArrowLeft, Loader2, Play } from 'lucide-react';
import api from '../api/axios';
import * as faceapi from '@vladmandic/face-api';

export default function PracticeTest() {
  const navigate = useNavigate();

  // 1. State Initialization
  const [user, setUser] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [answers, setAnswers] = useState({});
  const [isLoading, setIsLoading] = useState(true);

  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [modelError, setModelError] = useState(false);
  const [isSessionStarted, setIsSessionStarted] = useState(false);
  const [timeLeft, setTimeLeft] = useState(null);
  const [warnings, setWarnings] = useState(0);

  const [isTerminated, setIsTerminated] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [toastMessage, setToastMessage] = useState(null);

  // 2. Refs
  const videoRef = useRef(null);
  const streamRef = useRef(null); // Owns the MediaStream so it can always be released
  const lookAwayTimer = useRef(null);
  const timerRef = useRef(null);
  const trackIntervalRef = useRef(null);
  const warningsRef = useRef(0);
  const isTerminatedRef = useRef(false);
  const isSubmittingRef = useRef(false);

  // 2b. Session lifecycle helpers.
  // These are declared before the effects that depend on them so the
  // dependency arrays are always evaluated against a defined value.
  const cleanupSession = useCallback(() => {
    if (trackIntervalRef.current) {
      clearInterval(trackIntervalRef.current);
      trackIntervalRef.current = null;
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    if (document.fullscreenElement && document.exitFullscreen) {
      document.exitFullscreen().catch(() => {});
    }
    // Stop every track, independent of whether the element still exists
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
  }, []);

  const submitSession = useCallback(async () => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmitting(true);

    if (document.fullscreenElement && document.exitFullscreen) {
      try { await document.exitFullscreen(); } catch { /* fullscreen may already be closed */ }
    }

    cleanupSession();

    let score = 0;
    const responses = questions.map((q, idx) => {
      const selected = answers[idx];
      const isCorrect = selected === q.correct_answer;
      if (isCorrect) score++;
      return {
        question_idx: idx,
        selected_option: selected || '',
        is_correct: isCorrect,
        approach_feedback: 'Practice Attempt',
        topic_name: q.topic_name || null
      };
    });

    try {
      await api.post('/practice-test/submit', {
        user_id: user?.user_id || 'me',
        score,
        warnings_issued: warningsRef.current,
        total_questions: questions.length,
        responses,
        completed_at: new Date().toISOString()
      });
      toast.success(`Session Submitted! Score: ${score}/${questions.length}`);
      navigate('/');
    } catch (err) {
      console.error("Submission failed", err);
      toast.error("Network error during submission.");
      navigate('/');
    }
  }, [answers, cleanupSession, navigate, questions, user]);

  // 3. Mount & Fetch Data
  useEffect(() => {
    const init = async () => {
      try {
        const userRes = await api.get('/auth/me');
        setUser(userRes.data);

        const sessionRes = await api.get(`/practice-test/generate/${userRes.data.user_id || 'me'}`);
        if (sessionRes.data && sessionRes.data.questions) {
          setQuestions(sessionRes.data.questions);
          setTimeLeft(sessionRes.data.questions.length * 60);
          setIsLoading(false);
        }
      } catch (err) {
        console.error("Initialization failed", err);
        toast.error("Failed to start the session. Check your dashboard.");
        setTimeout(() => navigate('/'), 3000);
      }
    };
    init();

    return () => cleanupSession();
  }, [navigate, cleanupSession]);

  // 4. Load Models
  const loadModels = async () => {
    setModelError(false);
    try {
      await faceapi.nets.tinyFaceDetector.loadFromUri('/models');
      setIsModelLoaded(true);
    } catch (e) {
      console.error("Failed to load models.", e);
      setModelError(true);
    }
  };

  useEffect(() => {
    if (!isLoading && !isModelLoaded) {
      loadModels();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  const startVideo = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      console.error("Camera permissions denied:", err);
      toast.error("Camera access is required for focus mode.");
    }
  };

  // Attach the stream once the <video> element actually exists (startVideo may
  // resolve before React has rendered the session UI).
  useEffect(() => {
    if (isSessionStarted && videoRef.current && streamRef.current && videoRef.current.srcObject !== streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
    }
  }, [isSessionStarted]);

  const showWarningToast = (msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const incrementWarning = useCallback((msg) => {
    setWarnings(prev => {
      const next = prev + 1;
      warningsRef.current = next;
      return next;
    });
    showWarningToast(msg);
  }, []);

  // --- API EVENT LISTENERS ---
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && isSessionStarted && !isTerminated) {
        incrementWarning("⚠️ WARNING: Tab switching detected — please stay on this screen.");
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [isSessionStarted, isTerminated, incrementWarning]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && isSessionStarted && !isTerminated) {
        incrementWarning("⚠️ WARNING: Please remain in fullscreen mode.");
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [isSessionStarted, isTerminated, incrementWarning]);

  // --- UNIFIED ENFORCEMENT ---
  useEffect(() => {
    if (warnings >= 3 && !isTerminated) {
      isTerminatedRef.current = true;
      setIsTerminated(true);
      submitSession();
    }
  }, [warnings, isTerminated, submitSession]);


  // --- FACE DETECTION LOOP ---
  const handleVideoPlay = () => {
    if (trackIntervalRef.current) return; // avoid stacking intervals on re-play
    trackIntervalRef.current = setInterval(async () => {
      if (!videoRef.current || isTerminatedRef.current || !isSessionStarted) return;

      const detection = await faceapi.detectSingleFace(
        videoRef.current,
        new faceapi.TinyFaceDetectorOptions({ scoreThreshold: 0.5 })
      );

      if (!detection) {
        if (!lookAwayTimer.current) {
          lookAwayTimer.current = Date.now();
        } else if (Date.now() - lookAwayTimer.current > 1500) {
          incrementWarning("⚠️ WARNING: Please keep your face in view.");
          lookAwayTimer.current = null;
        }
      } else {
        lookAwayTimer.current = null;
      }
    }, 500);
  };

  // 5. Timer Logic
  useEffect(() => {
    if (timeLeft !== null && timeLeft > 0 && isSessionStarted && !isTerminated) {
      timerRef.current = setInterval(() => {
        setTimeLeft(prev => {
          if (prev <= 1) {
            clearInterval(timerRef.current);
            submitSession();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timerRef.current);
  }, [timeLeft, isSessionStarted, isTerminated, submitSession]);

  const handleStartSession = async () => {
    try {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      toast.error("Fullscreen required.");
      return;
    }
    setIsSessionStarted(true);
    startVideo();
  };

  // 6. Submit Logic — see `submitSession` above (declared before the effects
  // that depend on it).

  const handleOptionSelect = (option) => {
    setAnswers(prev => ({ ...prev, [currentIdx]: option }));
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (isLoading) {
    return (
      <div className="h-screen bg-slate-900 flex flex-col items-center justify-center space-y-4">
        <Loader2 className="w-12 h-12 text-primary animate-spin" />
        <p className="text-slate-400 font-headline">Preparing your practice set...</p>
      </div>
    );
  }

  if (!isModelLoaded) {
    return (
      <div className="h-screen bg-slate-900 flex flex-col items-center justify-center space-y-4 p-6 text-center">
        {modelError ? (
          <>
            <ShieldAlert className="w-14 h-14 text-red-500" />
            <p className="text-slate-300 font-headline max-w-md">
              The focus engine could not load its face-detection models.
              Make sure files are served from <code className="text-primary">/models</code>, then retry.
            </p>
            <button
              onClick={loadModels}
              className="mt-2 px-8 py-3 bg-primary hover:bg-primary/90 text-white font-bold rounded-xl transition-all"
            >
              Retry
            </button>
          </>
        ) : (
          <>
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
            <p className="text-slate-400 font-headline">Initializing Focus Mode...</p>
          </>
        )}
      </div>
    );
  }

  if (!isSessionStarted) {
    return (
      <div className="h-screen bg-slate-900 flex flex-col items-center justify-center p-6 text-center">
        <ShieldAlert className="w-20 h-20 text-primary mb-6 animate-pulse" />
        <h1 className="text-4xl font-headline font-bold text-white mb-4">Focus Mode Ready</h1>
        <p className="text-slate-300 max-w-xl text-lg mb-8 leading-relaxed">
           You are about to begin a focused study session.
           Staying in <strong>fullscreen</strong>, keeping this <strong>tab visible</strong>, and staying <strong>in view</strong> will keep your focus score high.
        </p>
        <button
          onClick={handleStartSession}
          className="flex items-center gap-3 px-10 py-5 bg-primary hover:bg-primary/90 text-white font-bold rounded-2xl shadow-[0_0_30px_rgba(var(--primary),0.4)] transition-all hover:scale-105"
        >
          <Play className="w-6 h-6" /> Start Session
        </button>
      </div>
    );
  }

  if (isTerminated) {
    return (
      <div className="fixed inset-0 z-[2000] bg-red-950/90 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-center">
        <ShieldAlert className="w-24 h-24 text-red-500 mb-6 animate-pulse" />
        <h1 className="text-4xl font-headline font-bold text-white mb-4">Session Ended</h1>
        <h2 className="text-2xl font-bold text-red-300 mb-6 uppercase tracking-widest">Focus Interruption Detected</h2>
        <p className="text-slate-200 max-w-lg text-lg leading-relaxed">
          Our focus tracker detected repeated instances of looking away, tab switching, or exiting fullscreen.
          Your session was submitted automatically.
        </p>
        <button onClick={() => navigate('/')} className="mt-10 px-8 py-3 bg-white text-red-900 font-bold rounded-xl hover:bg-slate-200 transition-all">
          Back to Dashboard
        </button>
      </div>
    );
  }

  const currentQuestion = questions[currentIdx];

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col relative">
      {/* WebCam View */}
      <div className="fixed top-6 right-6 w-40 h-32 z-50 rounded-xl overflow-hidden border-2 border-primary shadow-[0_0_20px_rgba(var(--primary),0.3)] bg-slate-800">
        <video
          ref={videoRef}
          autoPlay
          muted
          onPlay={handleVideoPlay}
          className="w-full h-full object-cover -scale-x-100"
        />
        {!videoRef.current?.srcObject && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-800/80">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        )}
      </div>

      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 px-8 py-4 flex justify-between items-center shadow-2xl relative z-10">
        <div className="flex items-center gap-6">
          <h1 className="text-xl font-bold flex items-center gap-2">
            <Maximize className="w-6 h-6 text-primary" />
            <span className="hidden sm:inline">Self-Assessment</span>
          </h1>
          <div className="h-8 w-[1px] bg-slate-700 hidden sm:block"></div>
          <p className="text-slate-400 font-medium">Q{currentIdx + 1} of {questions.length}</p>
        </div>

        <div className="flex items-center gap-6 pr-44">
          {/* Warnings */}
          <div className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold transition-all ${warnings > 0 ? 'bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse' : 'text-slate-400'}`}>
            <AlertTriangle className="w-5 h-5" />
            <span>Flags: {warnings}/3</span>
          </div>

          {/* Timer */}
          <div className={`flex items-center gap-2 px-6 py-2 rounded-xl border font-mono text-xl ${timeLeft < 30 ? 'bg-red-900 text-red-200 border-red-500' : 'bg-slate-950 text-emerald-400 border-emerald-500/30'}`}>
            <Timer className="w-5 h-5" />
            {formatTime(timeLeft)}
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center p-8 max-w-5xl mx-auto w-full">
        <div className="w-full bg-slate-800 rounded-3xl p-10 shadow-3xl border border-slate-700 relative overflow-hidden min-h-[400px]">
          {/* Progress Bar */}
          <div className="absolute top-0 left-0 h-1 bg-primary/20 w-full">
            <div
              className="h-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${((currentIdx + 1) / questions.length) * 100}%` }}
            />
          </div>

          <h2 className="text-2xl font-bold mb-8 leading-relaxed">
            {currentQuestion?.question}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {currentQuestion?.options.map((option, i) => (
              <button
                key={i}
                onClick={() => handleOptionSelect(option)}
                className={`flex items-center gap-4 p-5 rounded-2xl border-2 text-left transition-all relative group ${answers[currentIdx] === option
                    ? 'bg-primary/10 border-primary text-white shadow-[0_0_20px_rgba(var(--primary),0.2)]'
                    : 'bg-slate-900/50 border-slate-700 hover:border-slate-500 text-slate-300'
                  }`}
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 transition-colors ${answers[currentIdx] === option ? 'bg-primary text-white' : 'bg-slate-800 text-slate-500 group-hover:text-slate-300'
                  }`}>
                  {String.fromCharCode(65 + i)}
                </div>
                <span className="text-lg">{option}</span>
                {answers[currentIdx] === option && (
                  <CheckCircle className="w-5 h-5 text-primary absolute right-5" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Footer Navigation */}
        <div className="flex justify-between w-full mt-10">
          <button
            disabled={currentIdx === 0}
            onClick={() => setCurrentIdx(prev => prev - 1)}
            className="flex items-center gap-2 px-8 py-3 rounded-xl bg-slate-800 text-slate-400 font-bold hover:bg-slate-700 transition-all disabled:opacity-0"
          >
            <ArrowLeft className="w-5 h-5" /> Previous
          </button>

          {currentIdx === questions.length - 1 ? (
            <button
              onClick={submitSession}
              disabled={isSubmitting}
              className={`flex items-center gap-2 px-10 py-4 font-bold rounded-2xl shadow-xl transition-all scale-110 ${
                 isSubmitting 
                 ? 'bg-slate-700 text-slate-400 cursor-not-allowed' 
                 : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/40'
               }`}
            >
              {isSubmitting ? (
                 <>
                   <Loader2 className="w-6 h-6 animate-spin" /> Submitting
                 </>
               ) : (
                 'Complete & Submit'
               )}
            </button>
          ) : (
            <button
              onClick={() => setCurrentIdx(prev => prev + 1)}
              className="flex items-center gap-2 px-8 py-3 bg-primary hover:bg-primary/90 text-white font-bold rounded-xl transition-all shadow-lg shadow-primary/20"
            >
              Next Question <ArrowRight className="w-5 h-5" />
            </button>
          )}
        </div>
      </main>

      {/* Warning Overlay (Flash Effect) */}
      <div className={`fixed inset-0 pointer-events-none z-50 transition-opacity duration-300 bg-red-600/10 ${warnings > 0 ? 'opacity-100' : 'opacity-0'}`} />

      {/* Custom Toast Message */}
      {toastMessage && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[100] bg-red-600 text-white font-bold px-8 py-4 rounded-2xl shadow-2xl animate-bounce border-2 border-white">
          {toastMessage}
        </div>
      )}
    </div>
  );
}
