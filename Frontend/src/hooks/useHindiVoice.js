import { useState, useEffect, useCallback, useRef } from 'react';

// Browser capability check — this is static, so it never needs to live in state.
const SPEECH_SUPPORTED = typeof window !== 'undefined'
  && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);

const useHindiVoice = () => {
  const [transcript, setTranscript] = useState('');
  const [isListening, setIsListening] = useState(false);

  // The recognition instance is an external object, so it belongs in a ref
  // rather than in state.
  const recognitionRef = useRef(null);

  useEffect(() => {
    if (!SPEECH_SUPPORTED) {
      console.warn("Speech Recognition API not supported in this browser.");
      return;
    }

    // Initialize Web Speech API for Recognition
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recog = new SpeechRecognition();
    recog.continuous = true; // Use continuous so it doesn't stop randomly
    recog.interimResults = true;
    recog.lang = 'hi-IN'; // Set language to Hindi

    recog.onresult = (event) => {
      const text = Array.from(event.results)
        .map(result => result[0].transcript)
        .join('');
      setTranscript(text);
    };

    recog.onstart = () => {
      setIsListening(true);
    };

    recog.onend = () => {
      setIsListening(false);
    };

    recog.onerror = (event) => {
      console.error("Speech recognition error", event.error);
      setIsListening(false);
    };

    recognitionRef.current = recog;

    return () => {
      recognitionRef.current = null;
    };
  }, []);

  const startListening = useCallback(() => {
    if (recognitionRef.current) {
      setTranscript('');
      recognitionRef.current.start();
    } else {
      console.warn("Speech Recognition API not supported in this browser.");
    }
  }, []);

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }
  }, []);

  const speakHindi = useCallback((text) => {
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);

      const setVoiceAndSpeak = () => {
        const voices = window.speechSynthesis.getVoices();
        // Find a Hindi voice
        const hindiVoice = voices.find(v => v.lang.includes('hi') || v.lang.includes('hi-IN'));

        if (hindiVoice) {
          utterance.voice = hindiVoice;
        } else {
          console.warn("No Hindi voice found. Falling back to default voice.");
        }

        // Ensure language is set properly for correct pronunciation even if voice is generic fallback
        utterance.lang = 'hi-IN';
        window.speechSynthesis.speak(utterance);
      };

      // Ensure voices are loaded (Chrome sometimes needs this)
      if (window.speechSynthesis.getVoices().length > 0) {
        setVoiceAndSpeak();
      } else {
        window.speechSynthesis.onvoiceschanged = () => {
          setVoiceAndSpeak();
          window.speechSynthesis.onvoiceschanged = null; // Clean up
        };
      }
    } else {
      console.warn("Text-to-speech not supported in this browser.");
    }
  }, []);

  return {
    transcript,
    isListening,
    isSupported: SPEECH_SUPPORTED,
    startListening,
    stopListening,
    speakHindi
  };
};

export default useHindiVoice;
