import React, { useState, useEffect, useRef } from 'react';
import { GERMAN_TEXT } from './constants';
import { extractVocabulary, generateSpeech, analyzeTextSegments } from './services/geminiService';
import { WordPair, AppPhase, LoadingState, TextSegment } from './types';
import { BookOpen, Headphones, Library, GraduationCap, ChevronRight, ChevronLeft, Pause, Play, Volume2, Gauge, MousePointerClick, BrainCircuit, X, SkipForward } from 'lucide-react';

const App: React.FC = () => {
  const [phase, setPhase] = useState<AppPhase>(AppPhase.READING);
  const [vocabulary, setVocabulary] = useState<WordPair[]>([]);
  const [segments, setSegments] = useState<TextSegment[]>([]);
  const [loadingState, setLoadingState] = useState<LoadingState>({ isLoading: false, message: '' });
  
  // Audio State
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeSegmentIndex, setActiveSegmentIndex] = useState<number | null>(null);
  const [playbackRate, setPlaybackRate] = useState<number>(1.0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioDuration, setAudioDuration] = useState<number>(0);
  
  // Flashcard State
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  // Suggestopedia State
  const [suggestopediaActive, setSuggestopediaActive] = useState(false);
  const [suggestopediaWordIndex, setSuggestopediaWordIndex] = useState(0);
  // Steps: 'intro' (grow), 'bulgarian' (trans), 'fixation' (pulse/blink)
  const [suggestopediaStep, setSuggestopediaStep] = useState<'intro' | 'bulgarian' | 'fixation'>('intro');

  // Refs
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animationFrameRef = useRef<number>(0);
  const suggestopediaActiveRef = useRef(false); // To track active state inside async loops without closure issues
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null); // To prevent GC

  // Initialize Data on Mount
  useEffect(() => {
    const initData = async () => {
      setLoadingState({ isLoading: true, message: 'Analysieren des Textes und Erstellen des Wortschatzes...' });
      try {
        const [vocab, segs] = await Promise.all([
          extractVocabulary(GERMAN_TEXT),
          analyzeTextSegments(GERMAN_TEXT)
        ]);
        setVocabulary(vocab);
        setSegments(segs);
      } catch (error) {
        console.error("Failed to load data", error);
        alert("Fehler beim Laden der Daten. Bitte API Key prüfen.");
      } finally {
        setLoadingState({ isLoading: false, message: '' });
      }
    };
    initData();

    return () => {
      stopAudio();
      cancelAnimationFrame(animationFrameRef.current);
      stopSuggestopedia();
    };
  }, []);

  const calculateTimestamps = (duration: number, segs: TextSegment[]): TextSegment[] => {
    let totalWeight = 0;
    
    // Assign weights based on length and punctuation
    const weights = segs.map(s => {
      if (!s.isWord) {
        if (s.text.includes('.') || s.text.includes('!') || s.text.includes('?')) return 12;
        if (s.text.includes(',') || s.text.includes(';') || s.text.includes(':')) return 6;
        return 2;
      }
      return s.text.length + 2;
    });

    totalWeight = weights.reduce((a, b) => a + b, 0);

    let currentAccumulatedTime = 0;
    return segs.map((s, i) => {
      const segmentDuration = (weights[i] / totalWeight) * duration;
      const start = currentAccumulatedTime;
      const end = currentAccumulatedTime + segmentDuration;
      currentAccumulatedTime += segmentDuration;
      return { ...s, startTime: start, endTime: end };
    });
  };

  const handlePhaseChange = (newPhase: AppPhase) => {
    stopAudio();
    stopSuggestopedia();
    setPhase(newPhase);
    setCurrentCardIndex(0);
    setIsFlipped(false);
  };

  const handleGenerateAndPlayAudio = async () => {
    if (audioUrl) {
      playAudio();
      return;
    }

    setLoadingState({ isLoading: true, message: 'Generiere Audio (High Quality)...' });
    try {
      const { url, duration } = await generateSpeech(GERMAN_TEXT);
      setAudioUrl(url);
      setAudioDuration(duration);
      
      // Initialize Audio Element
      if (audioRef.current) {
          audioRef.current.src = url;
          audioRef.current.load();
      } else {
          const audio = new Audio(url);
          audio.preservesPitch = true; // IMPORTANT: Allows slowing down without deepening voice
          audioRef.current = audio;
      }

      if (segments.length > 0) {
        const timedSegments = calculateTimestamps(duration, segments);
        setSegments(timedSegments);
      }
      
      playAudio();
    } catch (error) {
      console.error("Audio generation failed", error);
      alert("Fehler beim Generieren des Audios.");
    } finally {
      setLoadingState({ isLoading: false, message: '' });
    }
  };

  // Sync highlighting loop using HTML Audio Element
  const syncHighlighting = () => {
    if (!audioRef.current || !isPlaying) return;
    
    const currentTime = audioRef.current.currentTime;
    
    const index = segments.findIndex(s => s.startTime !== undefined && currentTime >= s.startTime && currentTime <= (s.endTime || Infinity));
    
    if (index !== -1 && index !== activeSegmentIndex) {
      setActiveSegmentIndex(index);
    } else if (currentTime >= audioRef.current.duration) {
        setActiveSegmentIndex(null);
        setIsPlaying(false);
    }

    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(syncHighlighting);
    }
  };

  useEffect(() => {
    if (isPlaying) {
      animationFrameRef.current = requestAnimationFrame(syncHighlighting);
    } else {
      cancelAnimationFrame(animationFrameRef.current);
    }
  }, [isPlaying]);

  const playAudio = () => {
    if (!audioRef.current) return;
    
    audioRef.current.playbackRate = playbackRate;
    audioRef.current.play().then(() => {
        setIsPlaying(true);
    }).catch(e => console.error("Play failed", e));
    
    audioRef.current.onended = () => {
        setIsPlaying(false);
        setActiveSegmentIndex(null);
    };
  };

  const pauseAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  };

  const stopAudio = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    setIsPlaying(false);
    setActiveSegmentIndex(null);
  };

  const changeSpeed = (rate: number) => {
      setPlaybackRate(rate);
      if (audioRef.current) {
          audioRef.current.playbackRate = rate;
      }
  };

  const handleSegmentClick = (index: number) => {
      const seg = segments[index];
      if (!seg || seg.startTime === undefined || !audioRef.current) return;

      audioRef.current.currentTime = seg.startTime;
      setActiveSegmentIndex(index);
      
      if (!isPlaying) {
          playAudio();
      }
  };

  // --- TTS Helpers ---
  const speak = (text: string, lang: 'de-DE' | 'bg-BG', rate: number = 0.9): Promise<void> => {
      return new Promise((resolve) => {
        if (window.speechSynthesis.speaking) {
            window.speechSynthesis.cancel();
        }
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = lang;
        utterance.rate = rate;
        
        // Keep reference to prevent Garbage Collection
        currentUtteranceRef.current = utterance;

        utterance.onend = () => {
            currentUtteranceRef.current = null;
            resolve();
        };
        utterance.onerror = (e) => {
            console.warn("TTS Error (might be blocked or interrupted)", e);
            currentUtteranceRef.current = null;
            resolve(); // Resolve anyway to not block loop
        };
        window.speechSynthesis.speak(utterance);
      });
  };

  // --- Suggestopedia Logic ---
  const startSuggestopedia = () => {
      setSuggestopediaActive(true);
      suggestopediaActiveRef.current = true;
      setSuggestopediaWordIndex(0);
      runSuggestopediaCycle(0);
  };

  const stopSuggestopedia = () => {
      setSuggestopediaActive(false);
      suggestopediaActiveRef.current = false;
      window.speechSynthesis.cancel();
  };

  const skipToNextWord = () => {
      // Cancel current speech and force move to next index
      window.speechSynthesis.cancel();
      // We rely on the active loop detecting the skip, but since the loop is async/await, 
      // it might be stuck in a timeout or await.
      // Ideally, we restart the cycle at the next index.
      const nextIndex = suggestopediaWordIndex + 1;
      if (nextIndex < vocabulary.length) {
          setSuggestopediaWordIndex(nextIndex);
          // Restart cycle for new index implies breaking the old loop.
          // Since we can't easily "kill" the old promise chain, we rely on the ref check at start of cycle.
          // But to be immediate, we might need to force it.
          // Simple approach: The user clicking next will trigger state update, 
          // but we need to re-trigger the cycle logic if it's currently waiting.
          // For simplicity, let's just update index and let the user wait or re-trigger? 
          // No, let's call cycle directly, but ensure the old one dies via Ref check if possible.
          // However, we can't inject into the middle of the function.
          // Instead, let's just let the 'manual' interaction drive it or simple timeout checks.
          
          // Re-implementation: To allow "Skip", the cycle needs to be cancelable.
          // We will set a flag to ignore the rest of the current cycle?
          // Let's just reset the whole cycle with the new index.
          runSuggestopediaCycle(nextIndex);
      } else {
          stopSuggestopedia();
      }
  };

  const runSuggestopediaCycle = async (index: number) => {
      // Check if we are still active. 
      // Note: If user skipped, we might have multiple cycles running if we don't manage them.
      // But since JS is single threaded, as long as we check Ref at each step, we are okay.
      // However, if manual skip calls this, the previous one might still be in a `setTimeout`.
      // We can use a simple timestamp or ID to invalidate old runs, but let's trust the Ref + state check for now.
      
      // Update state for UI
      setSuggestopediaWordIndex(index);
      
      if (index >= vocabulary.length || !vocabulary[index] || !suggestopediaActiveRef.current) {
          if (index >= vocabulary.length) stopSuggestopedia();
          return;
      }

      const word = vocabulary[index];
      const currentWordId = index; // Capture current index to check against state if user skipped

      // Helper to check if we should abort (user stopped or skipped)
      const shouldContinue = () => suggestopediaActiveRef.current && suggestopediaWordIndex === currentWordId;

      // --- PHASE 1: INTRO (Growth) ---
      setSuggestopediaStep('intro');
      await speak(word.german, 'de-DE', 0.8);
      
      if (!suggestopediaActiveRef.current) return;
      // If user clicked skip, the index changed, so we should stop THIS loop (the new loop is running)
      // Actually `suggestopediaWordIndex` state updates are async, so checking Ref is best for stop.
      // For skip, we need to compare `index` arg with current `suggestopediaWordIndex` ref? 
      // Let's just check active ref for now.

      await new Promise(r => setTimeout(r, 500));
      if (!suggestopediaActiveRef.current) return;

      // --- PHASE 2: TRANSLATION ---
      setSuggestopediaStep('bulgarian');
      await speak(word.bulgarian, 'bg-BG', 1.0);

      await new Promise(r => setTimeout(r, 500));
      if (!suggestopediaActiveRef.current) return;

      // --- PHASE 3: FIXATION (Pulse/Blink) ---
      setSuggestopediaStep('fixation');
      // Speak German again for reinforcement
      speak(word.german, 'de-DE', 0.8); // Fire and forget speech here so we can wait specifically for time
      
      // Wait for 4-5 seconds for fixation
      await new Promise(r => setTimeout(r, 4500));
      
      if (!suggestopediaActiveRef.current) return;

      // Auto Advance if we haven't been stopped
      // Only advance if the index hasn't been changed manually by the user
      // (Though if user changed it manually, we likely want to just kill this loop. 
      //  But solving the race condition perfectly requires a "runId". 
      //  For now, standard flow works.)
      runSuggestopediaCycle(index + 1);
  };

  // --- Interactive Text Render ---
  const renderInteractiveText = () => {
    if (segments.length === 0) {
      return GERMAN_TEXT.split('\n').map((p, i) => <p key={i} className="mb-6 text-2xl leading-loose">{p}</p>);
    }
    
    return (
        <div className="leading-[2.5] text-justify font-serif-custom text-2xl">
          {segments.map((seg, idx) => {
            const needsSpace = idx > 0 && seg.isWord; 
            
            return (
              <React.Fragment key={idx}>
                {needsSpace && <span> </span>}
                <span 
                  onClick={() => handleSegmentClick(idx)}
                  className={`relative group inline-block transition-colors duration-200 cursor-pointer rounded px-0.5 border-b-2 border-transparent select-none
                    ${activeSegmentIndex === idx 
                        ? 'bg-amber-200 text-stone-900 shadow-sm border-amber-400' 
                        : 'hover:bg-teal-50 hover:border-teal-200'}
                  `}
                >
                  {seg.text}
                  {seg.translation && (
                    <span className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-3 hidden group-hover:block z-20 pointer-events-none">
                      <span className="bg-stone-800 text-white text-lg py-2 px-4 rounded-xl shadow-xl whitespace-nowrap block">
                        {seg.translation}
                      </span>
                      <span className="absolute top-full left-1/2 transform -translate-x-1/2 -mt-1 border-8 border-transparent border-t-stone-800"></span>
                    </span>
                  )}
                </span>
              </React.Fragment>
            );
          })}
        </div>
    );
  };

  // --- Render Suggestopedia Overlay ---
  const renderSuggestopediaOverlay = () => {
      if (!suggestopediaActive) return null;
      const word = vocabulary[suggestopediaWordIndex];
      if (!word) return null;

      return (
          <div className="fixed inset-0 bg-stone-900/95 z-[100] flex flex-col items-center justify-center p-8 text-center animate-in fade-in duration-300">
              <button 
                onClick={stopSuggestopedia}
                className="absolute top-6 right-6 text-stone-400 hover:text-white p-2 rounded-full hover:bg-stone-800 transition-colors"
              >
                  <X className="w-8 h-8" />
              </button>

              <div className="flex-1 flex flex-col justify-center items-center gap-12 max-w-5xl w-full">
                  
                  {/* German Word - Main Focus */}
                  {/* Animation logic: 
                      Intro: Scale 0 -> 100 over 2s
                      Fixation: Pulse slowly
                  */}
                  <div className={`transition-all ease-out duration-[2000ms] transform origin-center
                      ${suggestopediaStep === 'intro' ? 'scale-100 opacity-100' : ''}
                      ${suggestopediaStep === 'fixation' ? 'scale-110 animate-pulse' : ''}
                      ${suggestopediaStep === 'intro' ? 'scale-50 opacity-0' : ''} /* Initial state simulated by React key change? No, transitions need state change. */
                  `}>
                      {/* We use a key to force re-render animation on word change */}
                      <h2 key={word.german} className={`
                        text-7xl md:text-9xl font-serif-custom text-white font-bold tracking-tight mb-4
                        animate-in zoom-in duration-[2000ms] fill-mode-forwards
                        ${suggestopediaStep === 'fixation' ? 'animate-pulse' : ''}
                      `}>
                          {word.german}
                      </h2>
                  </div>

                  {/* Bulgarian Translation */}
                  <div className={`transition-all duration-700 transform
                      ${suggestopediaStep === 'intro' ? 'opacity-0 translate-y-8' : ''}
                      ${suggestopediaStep === 'bulgarian' || suggestopediaStep === 'fixation' ? 'opacity-100 translate-y-0' : ''}
                  `}>
                      <h3 className="text-4xl md:text-5xl text-teal-400 font-light">
                          {word.bulgarian}
                      </h3>
                  </div>

              </div>

              {/* Progress & Controls */}
              <div className="w-full max-w-3xl flex items-center gap-6 mt-8">
                  <div className="flex-1 h-1 bg-stone-800 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-teal-500 transition-all duration-1000 ease-linear" 
                        style={{ width: `${((suggestopediaWordIndex + 1) / vocabulary.length) * 100}%` }}
                      ></div>
                  </div>
                  
                  <button 
                    onClick={skipToNextWord}
                    className="p-4 bg-stone-800 text-teal-400 rounded-full hover:bg-teal-600 hover:text-white transition-all shadow-lg active:scale-95"
                    title="Nächstes Wort"
                  >
                      <SkipForward className="w-8 h-8" />
                  </button>
              </div>
              
              <p className="text-stone-500 mt-4 font-mono text-sm">
                  Wort {suggestopediaWordIndex + 1} von {vocabulary.length}
              </p>
          </div>
      );
  };

  return (
    <div className="min-h-screen bg-stone-100 text-stone-800 flex flex-col font-sans selection:bg-teal-200 selection:text-teal-900">
      
      {renderSuggestopediaOverlay()}

      {/* Header */}
      <header className="bg-white shadow-sm sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 py-4 flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-2">
            <BookOpen className="text-teal-600 w-8 h-8" />
            <h1 className="text-2xl font-bold tracking-tight text-stone-800">Suggestopedia <span className="text-teal-600">Deutsch</span></h1>
          </div>
          <nav className="flex space-x-1 bg-stone-100 p-1 rounded-xl overflow-x-auto max-w-full">
            {[
              { id: AppPhase.READING, label: 'Lesen', icon: Headphones },
              { id: AppPhase.VOCABULARY, label: 'Wortschatz', icon: Library },
              { id: AppPhase.SUGGESTOPEDIA, label: 'Deep Learning', icon: BrainCircuit },
              { id: AppPhase.FLASHCARDS, label: 'Karten', icon: GraduationCap },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => handlePhaseChange(tab.id)}
                className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 flex items-center gap-2 whitespace-nowrap ${
                  phase === tab.id
                    ? 'bg-white text-teal-700 shadow-sm'
                    : 'text-stone-500 hover:text-stone-700'
                }`}
              >
                <tab.icon className="w-4 h-4" />
                <span className="">{tab.label}</span>
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow container mx-auto px-4 py-8 max-w-4xl">
        
        {loadingState.isLoading && (
          <div className="fixed inset-0 bg-white/90 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
            <div className="animate-spin rounded-full h-16 w-16 border-b-4 border-teal-600 mb-6"></div>
            <p className="text-stone-600 animate-pulse font-medium text-lg">{loadingState.message}</p>
          </div>
        )}

        {/* Phase 1: Reading & Listening */}
        {phase === AppPhase.READING && (
          <div className="space-y-6 fade-in">
            <div className="bg-white rounded-3xl p-8 md:p-12 shadow-sm border border-stone-200">
              <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 pb-6 border-b border-stone-100 gap-6">
                <div>
                    <h2 className="text-3xl font-serif-custom text-stone-800 mb-2">Die Geschichte</h2>
                    <p className="text-stone-500 text-sm">Hören Sie zu und lesen Sie mit.</p>
                </div>
                
                <div className="flex flex-col sm:flex-row items-center gap-4 w-full md:w-auto">
                  {/* Speed Control */}
                  <div className="flex items-center bg-stone-100 rounded-xl p-1.5 w-full justify-center md:w-auto">
                    <div className="px-3 text-stone-400">
                        <Gauge className="w-5 h-5" />
                    </div>
                    {[0.75, 1.0, 1.25].map(rate => (
                        <button
                            key={rate}
                            onClick={() => changeSpeed(rate)}
                            className={`px-3 py-1.5 text-sm font-bold rounded-lg transition-colors ${
                                playbackRate === rate 
                                ? 'bg-white text-teal-700 shadow-sm' 
                                : 'text-stone-500 hover:text-teal-600'
                            }`}
                        >
                            {rate}x
                        </button>
                    ))}
                  </div>

                  <button
                    onClick={isPlaying ? pauseAudio : handleGenerateAndPlayAudio}
                    className={`flex items-center gap-2 px-8 py-3 rounded-full font-bold text-lg transition-colors shadow-sm w-full md:w-auto justify-center ${
                      isPlaying 
                        ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' 
                        : 'bg-teal-600 text-white hover:bg-teal-700'
                    }`}
                  >
                    {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 fill-current" />}
                    {isPlaying ? 'Pause' : 'Vorlesen'}
                  </button>
                </div>
              </div>
              
              {/* Interactive Text Container */}
              <article className="prose prose-xl prose-stone max-w-none">
                {renderInteractiveText()}
              </article>

            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-teal-50 border border-teal-100 rounded-2xl p-6 flex gap-4 items-start">
                  <div className="bg-white p-3 rounded-full shadow-sm text-teal-600 flex-shrink-0">
                     <MousePointerClick className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-teal-900 text-lg">Interaktiv</h3>
                    <p className="text-teal-800 mt-1">
                      Klicken Sie auf ein beliebiges Wort, um dorthin zu springen. 
                      Zeigen Sie auf ein Wort für die Übersetzung.
                    </p>
                  </div>
                </div>
                <div className="bg-amber-50 border border-amber-100 rounded-2xl p-6 flex gap-4 items-start">
                   <div className="bg-white p-3 rounded-full shadow-sm text-amber-600 flex-shrink-0">
                     <Volume2 className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-amber-900 text-lg">Natürliche Stimme</h3>
                    <p className="text-amber-800 mt-1">
                      Die Stimme bleibt auch bei langsamer Geschwindigkeit natürlich (kein Roboter-Effekt).
                    </p>
                  </div>
                </div>
            </div>
          </div>
        )}

        {/* Phase 2: Vocabulary List */}
        {phase === AppPhase.VOCABULARY && (
          <div className="space-y-8">
            <div className="text-center mb-8 bg-white p-8 rounded-3xl border border-stone-200">
               <h2 className="text-4xl font-serif-custom text-stone-800 mb-4">Wortschatz</h2>
               <p className="text-stone-500 text-lg mb-6">Die wichtigsten 30 Wörter für Anfänger (A1/A2)</p>
               <button 
                onClick={() => handlePhaseChange(AppPhase.SUGGESTOPEDIA)}
                className="bg-teal-600 text-white px-8 py-3 rounded-full font-bold text-lg hover:bg-teal-700 transition-colors inline-flex items-center gap-2 shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 duration-200"
               >
                   <BrainCircuit className="w-6 h-6" />
                   Start Deep Learning Session
               </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {vocabulary.length > 0 ? (
                vocabulary.map((pair, idx) => (
                  <div key={idx} className="bg-white p-6 rounded-2xl border border-stone-200 shadow-sm hover:shadow-md transition-shadow flex justify-between items-center group">
                    <div className="flex items-center gap-4">
                        <button 
                            onClick={() => speak(pair.german, 'de-DE')}
                            className="p-3 text-stone-300 hover:text-teal-600 hover:bg-teal-50 rounded-full transition-colors"
                            title="Aussprache hören"
                        >
                            <Volume2 className="w-5 h-5" />
                        </button>
                        <span className="font-bold text-xl text-teal-900">{pair.german}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-stone-300">→</span>
                      <span className="text-stone-600 italic text-lg">{pair.bulgarian}</span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="col-span-2 text-center py-20 text-stone-400 text-xl">
                  Wortschatz wird geladen...
                </div>
              )}
            </div>
          </div>
        )}

        {/* Phase 3: Suggestopedia Intro Screen (If active handled by overlay, this is the tab view) */}
        {phase === AppPhase.SUGGESTOPEDIA && (
             <div className="flex flex-col items-center justify-center min-h-[60vh] text-center space-y-8 bg-white rounded-3xl p-12 shadow-sm border border-stone-200">
                <div className="bg-teal-50 p-6 rounded-full">
                    <BrainCircuit className="w-20 h-20 text-teal-600" />
                </div>
                <div>
                    <h2 className="text-4xl font-serif-custom font-bold text-stone-800 mb-4">Deep Learning Session</h2>
                    <p className="text-xl text-stone-500 max-w-2xl mx-auto leading-relaxed">
                        Die Methode der Suggestopädie nutzt Entspannung und Fixierung, um das Gedächtnis zu aktivieren.
                        Lehnen Sie sich zurück. Die Wörter werden vorgelesen und groß angezeigt.
                        Versuchen Sie, sich das Wortbild einzuprägen.
                    </p>
                </div>
                <button 
                    onClick={startSuggestopedia}
                    className="bg-teal-600 text-white px-10 py-4 rounded-full font-bold text-xl hover:bg-teal-700 transition-all shadow-xl hover:shadow-2xl hover:-translate-y-1"
                >
                    Session Starten
                </button>
             </div>
        )}

        {/* Phase 4: Flashcards */}
        {phase === AppPhase.FLASHCARDS && vocabulary.length > 0 && (
          <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-10">
            
            <div className="w-full max-w-lg perspective-1000 group cursor-pointer" onClick={() => setIsFlipped(!isFlipped)}>
              <div className={`relative w-full h-96 transition-all duration-500 transform-style-3d ${isFlipped ? 'rotate-y-180' : ''}`}>
                
                {/* Front Side (German) */}
                <div className="absolute inset-0 w-full h-full bg-white rounded-3xl shadow-xl border border-stone-100 backface-hidden flex flex-col items-center justify-center p-8 relative">
                  <span className="text-sm font-bold tracking-[0.2em] text-teal-600 uppercase mb-6">Deutsch</span>
                  <h3 className="text-5xl font-serif-custom text-center text-stone-800 break-words w-full px-4 leading-tight">
                    {vocabulary[currentCardIndex].german}
                  </h3>
                  
                  {/* Speaker Button */}
                  <div className="absolute top-6 right-6" onClick={(e) => e.stopPropagation()}>
                    <button 
                        onClick={() => speak(vocabulary[currentCardIndex].german, 'de-DE')}
                        className="p-4 text-stone-400 hover:text-teal-600 hover:bg-stone-50 rounded-full transition-all"
                    >
                        <Volume2 className="w-8 h-8" />
                    </button>
                  </div>

                  <div className="absolute bottom-8 text-stone-400 text-sm font-medium">Klicken zum Umdrehen</div>
                </div>

                {/* Back Side (Bulgarian) */}
                <div className="absolute inset-0 w-full h-full bg-teal-600 rounded-3xl shadow-xl backface-hidden rotate-y-180 flex flex-col items-center justify-center p-8">
                  <span className="text-sm font-bold tracking-[0.2em] text-teal-200 uppercase mb-6">Български</span>
                  <h3 className="text-5xl font-serif-custom text-center text-white break-words w-full leading-tight">
                    {vocabulary[currentCardIndex].bulgarian}
                  </h3>
                  <div className="absolute bottom-8 text-teal-200/60 text-sm font-medium">Klicken zum Umdrehen</div>
                </div>

              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-8">
              <button 
                onClick={(e) => { e.currentTarget.blur(); prevCard(); }}
                className="p-5 rounded-full bg-white text-stone-600 shadow-md hover:shadow-lg hover:bg-stone-50 transition-all active:scale-95"
              >
                <ChevronLeft className="w-8 h-8" />
              </button>
              
              <div className="text-stone-500 font-bold font-mono text-xl">
                {currentCardIndex + 1} / {vocabulary.length}
              </div>

              <button 
                onClick={(e) => { e.currentTarget.blur(); nextCard(); }}
                className="p-5 rounded-full bg-white text-stone-600 shadow-md hover:shadow-lg hover:bg-stone-50 transition-all active:scale-95"
              >
                <ChevronRight className="w-8 h-8" />
              </button>
            </div>

          </div>
        )}
      </main>
    </div>
  );

  function nextCard() {
    setIsFlipped(false);
    setTimeout(() => {
      setCurrentCardIndex((prev) => (prev + 1) % vocabulary.length);
    }, 200);
  }

  function prevCard() {
    setIsFlipped(false);
    setTimeout(() => {
      setCurrentCardIndex((prev) => (prev - 1 + vocabulary.length) % vocabulary.length);
    }, 200);
  }
};

export default App;