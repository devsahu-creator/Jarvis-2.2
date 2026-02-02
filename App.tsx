import React, { useState, useEffect, useRef } from 'react';
import { JarvisService, VoiceStatus } from './services/jarvisService';
import { AudioVisualizer } from './components/AudioVisualizer';
import { ThinkingWidget } from './components/ThinkingWidget';

const App: React.FC = () => {
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [voiceStatus, setVoiceStatus] = useState<VoiceStatus>('idle');
  const [transcript, setTranscript] = useState<{role: 'user' | 'model', text: string} | null>(null);
  const [audioQueue, setAudioQueue] = useState<AudioBuffer[]>([]);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // New States for Features
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [isLocked, setIsLocked] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [blockedUrl, setBlockedUrl] = useState<string | null>(null);

  // Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const liveSessionRef = useRef<{ disconnect: () => Promise<void> } | null>(null);
  const scrollIntervalRef = useRef<number | null>(null);
  const currentAudioSourceRef = useRef<AudioBufferSourceNode | null>(null);

  // Audio Playback Queue Worker
  useEffect(() => {
    if (audioQueue.length > 0 && !isPlayingAudio) {
      playNextAudio();
    }
  }, [audioQueue, isPlayingAudio]);

  // Interruption Handling
  useEffect(() => {
    if (voiceStatus === 'listening' || voiceStatus === 'processing') {
      stopAudioPlayback();
    }
  }, [voiceStatus]);

  // Clear action status after delay
  useEffect(() => {
    if (lastAction && lastAction !== "POPUP BLOCKED") {
        const timer = setTimeout(() => setLastAction(null), 3000);
        return () => clearTimeout(timer);
    }
  }, [lastAction]);

  const stopAudioPlayback = () => {
    setAudioQueue([]); // Clear future queue
    setIsPlayingAudio(false);
    
    if (currentAudioSourceRef.current) {
        try {
            currentAudioSourceRef.current.onended = null;
            currentAudioSourceRef.current.stop();
        } catch (e) { /* ignore */ }
        currentAudioSourceRef.current = null;
    }
  };

  const testAudio = () => {
      // Diagnostic sound to verify speakers
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      osc.frequency.value = 440; // A4
      osc.type = 'sine';
      
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + 0.5);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
      setLastAction("AUDIO CHECK: OK");
  };

  // --- Helper Functions ---
  
  const categorizeError = (error: any): string => {
    const msg = (error.message || error.toString()).toLowerCase();
    const name = error.name || '';

    // 0. User Abort
    if (name === 'AbortError' || msg.includes('aborted')) {
        return "SESSION ENDED: USER TERMINATED UPLINK.";
    }

    // 1. Network / Offline
    if (!navigator.onLine) {
        return "OFFLINE: DATA UPLINK SEVERED. CHECK NETWORK CONFIGURATION.";
    }
    if (msg.includes('network') || msg.includes('failed to fetch') || msg.includes('connection') || msg.includes('offline')) {
        return "CONNECTION FAILURE: UNABLE TO CONTACT REMOTE SERVER.";
    }

    // 2. Service Availability (503, 429, etc)
    if (msg.includes('503') || msg.includes('unavailable') || msg.includes('overloaded')) {
        return "SERVER OVERLOAD: NEURAL ENGINE AT CAPACITY. PLEASE RETRY.";
    }
    if (msg.includes('429') || msg.includes('quota')) {
        return "RATE LIMIT EXCEEDED: COOLING DOWN SYSTEMS.";
    }

    // 3. Permissions
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || msg.includes('permission denied')) {
        return "SECURITY ALERT: AUDIO INPUT ACCESS DENIED. PLEASE GRANT PERMISSION.";
    }

    // 4. Hardware
    if (name === 'NotFoundError' || msg.includes('device not found')) {
        return "HARDWARE MISSING: NO MICROPHONE DETECTED.";
    }
    if (name === 'NotReadableError' || msg.includes('concurrent') || msg.includes('busy')) {
        return "HARDWARE CONFLICT: MICROPHONE IN USE BY ANOTHER PROCESS.";
    }
    if (name === 'NotSupportedError' || msg.includes('not supported')) {
      return "COMPATIBILITY ERROR: BROWSER DOES NOT SUPPORT REQUIRED AUDIO FEATURES.";
    }

    // 5. Config / Auth
    if (msg.includes('api key') || msg.includes('auth')) {
        return "AUTHENTICATION FAILED: INVALID SECURITY CREDENTIALS.";
    }

    // 6. Generic/Unknown
    return `SYSTEM ERROR: ${error.message?.toUpperCase() || 'UNKNOWN FATAL EXCEPTION'}`;
  };

  const getMediaStream = async () => {
    try {
        // Try high-quality constraints first with aggressive noise suppression
        return await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: { ideal: true },
                autoGainControl: { ideal: true },
                noiseSuppression: { ideal: true }, // Maximize noise suppression
                channelCount: 1,
                sampleRate: { ideal: 16000 } // Prefer native 16kHz for model compatibility
            } 
        });
    } catch (err: any) {
        console.warn("High-quality audio constraints failed, trying fallback...", err);
        // Fallback for constraint issues or if specific features aren't supported
        if (err.name === 'OverconstrainedError' || err.name === 'ConstraintNotSatisfiedError') {
             return await navigator.mediaDevices.getUserMedia({ audio: true });
        }
        throw err;
    }
  };

  const simulateKey = (key: string, code: string) => {
    let keyCode = 0;
    if (code === 'Space') keyCode = 32;
    if (code === 'KeyK') keyCode = 75;
    if (code === 'KeyJ') keyCode = 74;
    if (code === 'KeyL') keyCode = 76;
    if (code === 'KeyF') keyCode = 70;
    if (code === 'KeyM') keyCode = 77;

    const options = {
        key, code, keyCode, which: keyCode,
        bubbles: true, cancelable: true, view: window
    };
    
    document.dispatchEvent(new KeyboardEvent('keydown', options));
    document.dispatchEvent(new KeyboardEvent('keypress', options));
    document.dispatchEvent(new KeyboardEvent('keyup', options));
  };

  const handleScroll = (action: 'up' | 'down' | 'auto' | 'stop') => {
    if (scrollIntervalRef.current) {
        window.clearInterval(scrollIntervalRef.current);
        scrollIntervalRef.current = null;
    }

    if (action === 'stop') return;

    // Simulate scroll on the main container or window
    const scrollAmount = window.innerHeight * 0.8;

    if (action === 'down') {
        window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
    } else if (action === 'up') {
        window.scrollBy({ top: -scrollAmount, behavior: 'smooth' });
    } else if (action === 'auto') {
        scrollIntervalRef.current = window.setInterval(() => {
            window.scrollBy({ top: 2, behavior: 'auto' });
        }, 16);
    }
  };

  const playNextAudio = async () => {
    if (audioQueue.length === 0) return;
    setIsPlayingAudio(true);
    
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    const ctx = audioContextRef.current;
    
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
    
    const buffer = audioQueue[0];
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    
    currentAudioSourceRef.current = source;

    source.onended = () => {
      currentAudioSourceRef.current = null;
      setAudioQueue(prev => prev.slice(1));
      setIsPlayingAudio(false);
    };
    
    source.start();
  };

  const startJarvis = async () => {
    if (isConnecting || isLiveConnected) return;
    
    setIsConnecting(true);
    setVoiceStatus('processing');
    setTranscript(null);
    setErrorMsg(null);
    setGeneratedImage(null);
    setBlockedUrl(null);
    setAudioQueue([]);
    
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Microphone API not available (requires HTTPS).");
      }

      // Initialize Audio Context immediately on user interaction
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      }
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      const stream = await getMediaStream();

      liveSessionRef.current = await JarvisService.connectLive(
        audioContextRef.current,
        stream,
        (audioBuffer) => setAudioQueue(prev => [...prev, audioBuffer]),
        (role, text) => setTranscript({ role, text }),
        (status) => setVoiceStatus(status),
        async (name, args) => {
            // SAFE ARGUMENT EXTRACTION
            const safeArg = (val: any) => (val && typeof val === 'string') ? val : '';

            // TOOL HANDLERS
            if (name === 'generateImage') {
                const prompt = safeArg(args.prompt);
                if (!prompt) return { error: "Missing prompt" };
                
                setLastAction("GENERATING IMAGE...");
                JarvisService.generateImage(prompt).then(img => {
                    if (img) {
                        setGeneratedImage(img);
                        setLastAction("IMAGE RENDERED");
                    } else {
                        setLastAction("ERR: IMAGE GEN FAILED");
                    }
                });
                return { status: "Generating image displayed to user" };
            }
            if (name === 'lockSystem') {
                setIsLocked(true);
                return { status: "System locked" };
            }
            if (name === 'scrollPage') {
                const action = safeArg(args.action);
                if (!['up', 'down', 'auto', 'stop'].includes(action)) return { error: "Invalid action" };
                handleScroll(action as any);
                setLastAction(`SCROLL: ${action.toUpperCase()}`);
                return { status: "Scrolled" };
            }
            if (name === 'controlMedia') {
                const action = safeArg(args.action);
                simulateKey('k', 'KeyK');
                setLastAction(`MEDIA: ${action.toUpperCase() || 'TOGGLE'}`);
                return { status: "Media toggle executed" };
            }
            
            // URL Handlers (Search, Open, Play)
            let url = '';
            let actionLabel = '';
            const query = safeArg(args.query);
            
            if (name === 'performGoogleSearch') { // Renamed tool
                url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
                actionLabel = "SEARCHING";
            } else if (name === 'playMedia') {
                const type = safeArg(args.type) || 'video';
                const sq = type === 'short' ? `${query} shorts` : query;
                url = `https://www.youtube.com/results?search_query=${encodeURIComponent(sq)}`;
                actionLabel = "PLAYING";
            } else if (name === 'openWebsite') {
                url = safeArg(args.url);
                actionLabel = "OPENING";
            }

            if (url) {
                setLastAction(`${actionLabel}: ${query || 'URL'}`);
                const win = window.open(url, '_blank');
                if (!win) {
                    setBlockedUrl(url);
                    setLastAction("POPUP BLOCKED");
                    // Critical: Inform the model that the action failed so it can respond verbally
                    return { error: "Browser blocked the popup window. User has been alerted manually." };
                }
                return { status: "Opened successfully" };
            }
            
            // Fallback for recognized tools with missing required args
            if (['performGoogleSearch', 'playMedia', 'openWebsite'].includes(name)) {
                setLastAction("CMD ERR: MISSING PARAMS");
                return { error: "Missing required parameters (url or query)" };
            }

            return { error: "Unknown tool" };
        },
        () => {
           setIsLiveConnected(false);
           setVoiceStatus('idle');
           setIsConnecting(false);
           stopAudioPlayback();
        },
        (err) => {
           console.error("Live Session Error:", err);
           setErrorMsg(categorizeError(err));
           setIsLiveConnected(false);
           setIsConnecting(false);
           stopAudioPlayback();
        }
      );

      setIsLiveConnected(true);

    } catch (err: any) {
      console.error("Init Error:", err);
      setErrorMsg(categorizeError(err));
      setIsLiveConnected(false);
      setIsConnecting(false);
    }
  };

  const stopJarvis = async () => {
    if (liveSessionRef.current) {
      await liveSessionRef.current.disconnect();
      liveSessionRef.current = null;
    }
    if (scrollIntervalRef.current) {
        clearInterval(scrollIntervalRef.current);
        scrollIntervalRef.current = null;
    }
    stopAudioPlayback();
    setIsLiveConnected(false);
    setVoiceStatus('idle');
    setIsConnecting(false);
  };

  const getStatusText = () => {
    if (isLocked) return "SYSTEM LOCKED";
    if (errorMsg) return "SYSTEM ERROR";
    if (isConnecting) return "ESTABLISHING UPLINK...";
    if (!isLiveConnected) return "SYSTEM STANDBY";
    if (lastAction) return lastAction;
    switch (voiceStatus) {
      case 'listening': return "LISTENING...";
      case 'processing': return "COMPUTING...";
      case 'speaking': return "SPEAKING";
      default: return "ONLINE // READY";
    }
  };

  return (
    <div className="w-screen h-screen bg-black text-jarvis-cyan font-display flex flex-col relative overflow-hidden">
      
      {/* --- HUD DECORATION --- */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(0,243,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,243,255,0.03)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none"></div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_50%,rgba(0,0,0,0.8)_100%)] pointer-events-none"></div>
      
      {/* --- LOCK SCREEN --- */}
      {isLocked && (
        <div className="absolute inset-0 z-50 bg-black flex flex-col items-center justify-center space-y-8">
            <div className="text-red-500 text-6xl font-bold animate-pulse tracking-[0.5em]">LOCKED</div>
            <button 
                onClick={() => setIsLocked(false)}
                className="px-8 py-3 bg-red-900/30 border border-red-500 text-red-500 hover:bg-red-900/50 rounded font-mono uppercase"
            >
                Authenticate to Unlock
            </button>
        </div>
      )}

      {/* --- POPUP BLOCKER RECOVERY --- */}
      {blockedUrl && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-50 animate-bounce">
            <a 
                href={blockedUrl} 
                target="_blank" 
                rel="noreferrer" 
                onClick={() => { setBlockedUrl(null); setLastAction(null); }}
                className="bg-red-500/90 hover:bg-red-600 text-white px-6 py-3 rounded-full font-bold shadow-[0_0_20px_rgba(255,0,0,0.5)] border border-red-400 flex items-center space-x-2"
            >
                <span>⚠️ POPUP BLOCKED - CLICK TO OPEN</span>
            </a>
        </div>
      )}

      {/* --- GENERATED IMAGE --- */}
      {generatedImage && !isLocked && (
        <div className="absolute inset-0 z-40 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-8">
            <div className="relative max-w-4xl max-h-[80vh] border-2 border-jarvis-cyan rounded-lg overflow-hidden shadow-[0_0_50px_rgba(0,243,255,0.3)]">
                <img src={`data:image/jpeg;base64,${generatedImage}`} alt="Generated" className="object-contain w-full h-full" />
            </div>
            <button 
                onClick={() => setGeneratedImage(null)}
                className="mt-6 px-6 py-2 border border-jarvis-cyan text-jarvis-cyan hover:bg-jarvis-cyan/20 rounded-full"
            >
                CLOSE VISUALIZATION
            </button>
        </div>
      )}

      {/* --- HEADER --- */}
      <header className="absolute top-0 w-full p-6 flex justify-between items-start z-10">
        <div>
          <h1 className="text-3xl font-bold tracking-[0.2em] text-white drop-shadow-[0_0_10px_rgba(255,255,255,0.5)]">JARVIS</h1>
          <div className="text-xs text-jarvis-blue mt-1">VOICE INTERFACE PROTOCOL MK.85</div>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-400">SYS.STATUS</div>
          <div className={`text-xl font-bold tracking-widest ${isLiveConnected ? 'text-green-400 animate-pulse' : errorMsg ? 'text-red-500 blink' : isConnecting ? 'text-yellow-400' : 'text-gray-500'}`}>
            {isLiveConnected ? 'ONLINE' : errorMsg ? 'ERROR' : isConnecting ? 'CONNECTING' : 'OFFLINE'}
          </div>
        </div>
      </header>

      {/* --- MAIN VISUALIZER --- */}
      <main className="flex-1 flex flex-col items-center justify-center relative z-0">
        
        <div className="relative w-[300px] h-[300px] md:w-[400px] md:h-[400px] flex items-center justify-center">
            {/* Rings */}
            <div className={`absolute inset-0 rounded-full border-2 border-dashed ${
                errorMsg ? 'border-red-500' : 
                (voiceStatus === 'processing' || isConnecting) ? 'border-purple-500 animate-[spin_2s_linear_infinite]' : 
                (voiceStatus === 'listening') ? 'border-white animate-[spin_3s_linear_infinite] shadow-[0_0_15px_rgba(255,255,255,0.3)]' :
                isLiveConnected ? 'border-jarvis-cyan animate-[spin_4s_linear_infinite]' : 
                'border-gray-800'
            }`}></div>
            <div className={`absolute inset-4 rounded-full border ${errorMsg ? 'border-red-500/50' : 'border-jarvis-blue/30'}`}></div>

            {/* Widget */}
            <div className={`absolute inset-10 rounded-full overflow-hidden bg-black/50 backdrop-blur-sm border shadow-[0_0_30px_rgba(0,243,255,0.2)] ${errorMsg ? 'border-red-500 shadow-[0_0_30px_rgba(255,0,0,0.2)]' : 'border-jarvis-cyan/50'}`}>
                {(voiceStatus === 'processing' || isConnecting) ? (
                   <ThinkingWidget />
                ) : (
                   <AudioVisualizer mode={voiceStatus as 'idle' | 'listening' | 'speaking'} />
                )}
            </div>

            {/* Initiate Button */}
            {!isLiveConnected && !isConnecting && (
                <button 
                    onClick={startJarvis}
                    className="absolute z-20 w-32 h-32 rounded-full bg-jarvis-cyan/10 hover:bg-jarvis-cyan/20 border border-jarvis-cyan text-jarvis-cyan font-bold tracking-widest transition-all duration-300 hover:scale-110 hover:shadow-[0_0_30px_#00f3ff]"
                >
                    {errorMsg ? "RETRY" : "INITIATE"}
                </button>
            )}
        </div>

        {/* Status Text */}
        <div className={`mt-8 tracking-[0.3em] text-sm font-mono animate-pulse ${errorMsg ? 'text-red-500' : (voiceStatus === 'processing' || isConnecting) ? 'text-purple-400' : voiceStatus === 'listening' ? 'text-white' : 'text-jarvis-blue'}`}>
            {getStatusText()}
        </div>
        
        {/* Error Details */}
        {errorMsg && (
            <div className="mt-2 text-red-400 text-xs font-mono max-w-md text-center px-4 bg-red-900/20 py-2 rounded border border-red-500/30">
                {errorMsg}
            </div>
        )}

        {/* Transcript */}
        <div className="mt-8 h-24 w-full max-w-2xl px-6 text-center">
            {transcript && (
                <div className={`transition-opacity duration-500 ${transcript ? 'opacity-100' : 'opacity-0'}`}>
                    <div className="text-xs text-gray-500 mb-2 font-mono uppercase tracking-widest">
                        JARVIS RESPONSE
                    </div>
                    <div className="text-lg md:text-2xl font-light leading-relaxed text-jarvis-cyan">
                        "{transcript.text}"
                    </div>
                </div>
            )}
        </div>

      </main>

      {/* --- FOOTER --- */}
      <footer className="absolute bottom-0 w-full p-6 flex justify-center z-10 space-x-4">
          {!isLiveConnected && !isConnecting && (
              <button 
                onClick={testAudio}
                className="px-6 py-2 border border-gray-600 text-gray-400 hover:text-jarvis-cyan hover:border-jarvis-cyan rounded-full text-xs tracking-widest uppercase transition-colors"
              >
                  System Check
              </button>
          )}
          {(isLiveConnected || isConnecting) && (
              <button 
                onClick={stopJarvis}
                className="px-8 py-3 bg-red-500/10 border border-red-500 text-red-500 hover:bg-red-500/20 rounded-full font-bold tracking-widest transition-colors uppercase text-sm backdrop-blur-md"
              >
                  Terminate Uplink
              </button>
          )}
      </footer>

    </div>
  );
};

export default App;