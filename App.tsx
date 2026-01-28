import React, { useState, useEffect, useRef } from 'react';
import { AppMode } from './types';
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

  // Interruption Handling: Stop audio if user starts speaking or processing new command
  useEffect(() => {
    if (voiceStatus === 'listening' || voiceStatus === 'processing') {
      stopAudioPlayback();
    }
  }, [voiceStatus]);

  // Clear action status after delay
  useEffect(() => {
    if (lastAction) {
        const timer = setTimeout(() => setLastAction(null), 3000);
        return () => clearTimeout(timer);
    }
  }, [lastAction]);

  const stopAudioPlayback = () => {
    setAudioQueue([]); // Clear future queue
    setIsPlayingAudio(false);
    
    if (currentAudioSourceRef.current) {
        try {
            // Remove listener to prevent triggering the natural 'onended' flow logic
            currentAudioSourceRef.current.onended = null;
            currentAudioSourceRef.current.stop();
        } catch (e) {
            // Ignore error if already stopped
        }
        currentAudioSourceRef.current = null;
    }
  };

  // --- Helper Functions for DOM Simulation ---
  const simulateKey = (key: string, code: string) => {
    // Simulating keyboard events for YouTube/Web control
    const options = {
        key: key,
        code: code,
        keyCode: code === 'Space' ? 32 : 0,
        which: code === 'Space' ? 32 : 0, // Legacy support
        bubbles: true,
        cancelable: true,
        view: window
    };
    
    const eventDown = new KeyboardEvent('keydown', options);
    const eventUp = new KeyboardEvent('keyup', options);
    const eventPress = new KeyboardEvent('keypress', options);

    document.dispatchEvent(eventDown);
    if (code === 'Space' || key.length === 1) {
        document.dispatchEvent(eventPress);
    }
    document.dispatchEvent(eventUp);

    // Also try focused element just in case (essential for some players)
    if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.dispatchEvent(eventDown);
        if (code === 'Space' || key.length === 1) {
            document.activeElement.dispatchEvent(eventPress);
        }
        document.activeElement.dispatchEvent(eventUp);
    }
  };

  const handleScroll = (action: 'up' | 'down' | 'auto' | 'stop') => {
    if (scrollIntervalRef.current) {
        window.clearInterval(scrollIntervalRef.current);
        scrollIntervalRef.current = null;
    }

    if (action === 'stop') {
        return;
    }

    const scrollAmount = window.innerHeight * 0.7; // 70% of viewport

    if (action === 'down') {
        window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
    } else if (action === 'up') {
        window.scrollBy({ top: -scrollAmount, behavior: 'smooth' });
    } else if (action === 'auto') {
        // Continuous smooth scroll
        scrollIntervalRef.current = window.setInterval(() => {
            window.scrollBy({ top: 3, behavior: 'auto' });
        }, 20);
    }
  };
  // -------------------------------------------

  const playNextAudio = async () => {
    if (audioQueue.length === 0) return;
    setIsPlayingAudio(true);
    
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
    }
    const ctx = audioContextRef.current;
    
    // Resume context if suspended (browser policy fix)
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

  const getMediaStream = async () => {
    try {
        return await navigator.mediaDevices.getUserMedia({ 
            audio: {
                echoCancellation: true,
                autoGainControl: true,
                noiseSuppression: true,
                channelCount: 1
            } 
        });
    } catch (err: any) {
        console.warn("High-quality audio constraints failed, trying fallback...", err);
        return await navigator.mediaDevices.getUserMedia({ 
            audio: true 
        });
    }
  };

  const startJarvis = async () => {
    if (isConnecting || isLiveConnected) return;
    
    setIsConnecting(true);
    setVoiceStatus('processing'); // Visual feedback during connection
    setTranscript(null);
    setErrorMsg(null);
    setGeneratedImage(null);
    
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error("Browser API 'navigator.mediaDevices.getUserMedia' is not available. Ensure you are using HTTPS or localhost.");
      }

      const stream = await getMediaStream();

      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      }
      if (audioContextRef.current.state === 'suspended') {
        await audioContextRef.current.resume();
      }

      liveSessionRef.current = await JarvisService.connectLive(
        audioContextRef.current,
        stream,
        (audioBuffer) => {
           setAudioQueue(prev => [...prev, audioBuffer]);
        },
        (role, text) => {
           setTranscript({ role, text });
        },
        (status) => {
           setVoiceStatus(status);
        },
        // Tool Callback Handler
        async (name, args) => {
            if (name === 'generateImage') {
                const prompt = args.prompt;
                JarvisService.generateImage(prompt).then(img => {
                    if (img) setGeneratedImage(img);
                });
                return { status: "Generating image displayed to user" };
            }
            if (name === 'lockSystem') {
                setIsLocked(true);
                return { status: "System locked" };
            }
            if (name === 'scrollPage') {
                const action = args.action; 
                handleScroll(action);
                setLastAction(`SCROLL: ${action.toUpperCase()}`);
                return { status: "Scrolled" };
            }
            if (name === 'controlMedia') {
                const action = args.action;
                simulateKey('k', 'KeyK');
                setLastAction(`MEDIA: ${action.toUpperCase()}`);
                return { status: "Media toggle executed" };
            }
            if (name === 'googleSearch') {
                const query = args.query || 'unknown';
                setLastAction(`SEARCHING: ${query.toUpperCase()}`);
                const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
                window.open(url, '_blank');
                return { status: "Search opened" };
            }
            if (name === 'playMedia') {
                const query = args.query || 'media';
                const type = args.type || 'video';
                setLastAction(`PLAYING: ${query.toUpperCase()}`);
                const searchQuery = type === 'short' ? `${query} shorts` : query;
                const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`;
                window.open(url, '_blank');
                return { status: "Media opened" };
            }
            if (name === 'openWebsite') {
                 setLastAction("OPENING LINK...");
                 const url = args.url;
                 if (url) window.open(url, '_blank');
                 return { status: "Website opened" };
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
           let userMessage = "Connection Failed";
           
           if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
               userMessage = "Microphone Access Denied. Please allow permissions.";
           } else if (err.message && err.message.includes('403')) {
               userMessage = "Access Denied: Check API Key.";
           } else if (err.message) {
               userMessage = err.message;
           }
           
           setErrorMsg(userMessage);
           setIsLiveConnected(false);
           setIsConnecting(false);
           stopAudioPlayback();
        }
      );

      setIsLiveConnected(true);

    } catch (err: any) {
      console.error("Initialization Error:", err);
      let errorMessage = "Unknown initialization error.";
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          errorMessage = "Microphone access denied. Please grant permission.";
      } else if (err.message) {
          errorMessage = err.message;
      }
      setErrorMsg(errorMessage);
      setIsLiveConnected(false);
      setIsConnecting(false);
    }
  };

  const stopJarvis = async () => {
    if (liveSessionRef.current) {
      await liveSessionRef.current.disconnect();
      liveSessionRef.current = null;
    }
    // Clean up any active intervals
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
    
    // Check if performing action
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
      
      {/* --- HUD DECORATION LAYERS --- */}
      <div className="absolute inset-0 bg-[linear-gradient(rgba(0,243,255,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(0,243,255,0.03)_1px,transparent_1px)] bg-[size:40px_40px] pointer-events-none"></div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_50%,rgba(0,0,0,0.8)_100%)] pointer-events-none"></div>
      
      {/* --- LOCK SCREEN OVERLAY --- */}
      {isLocked && (
        <div className="absolute inset-0 z-50 bg-black flex flex-col items-center justify-center space-y-8">
            <div className="text-red-500 text-6xl font-bold animate-pulse tracking-[0.5em]">LOCKED</div>
            <div className="w-32 h-32 rounded-full border-4 border-red-500 flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
            </div>
            <button 
                onClick={() => setIsLocked(false)}
                className="px-8 py-3 bg-red-900/30 border border-red-500 text-red-500 hover:bg-red-900/50 rounded font-mono uppercase"
            >
                Authenticate to Unlock
            </button>
        </div>
      )}

      {/* --- GENERATED IMAGE MODAL --- */}
      {generatedImage && !isLocked && (
        <div className="absolute inset-0 z-40 bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-8">
            <div className="relative max-w-4xl max-h-[80vh] border-2 border-jarvis-cyan rounded-lg overflow-hidden shadow-[0_0_50px_rgba(0,243,255,0.3)]">
                <img src={`data:image/jpeg;base64,${generatedImage}`} alt="Generated" className="object-contain w-full h-full" />
                <div className="absolute bottom-0 left-0 right-0 bg-black/70 p-2 text-center text-xs text-jarvis-cyan font-mono uppercase">
                    Rendered by Nano Banana (Gemini 2.5 Image)
                </div>
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
            {/* Outer Glow Ring */}
            <div className={`absolute inset-0 rounded-full border-2 border-dashed ${errorMsg ? 'border-red-500' : (voiceStatus === 'processing' || isConnecting) ? 'border-purple-500 animate-[spin_2s_linear_infinite]' : isLiveConnected ? 'border-jarvis-cyan animate-[spin_4s_linear_infinite]' : 'border-gray-800'}`}></div>
            {/* Inner Static Ring */}
            <div className={`absolute inset-4 rounded-full border ${errorMsg ? 'border-red-500/50' : 'border-jarvis-blue/30'}`}></div>

            {/* Content Switcher */}
            <div className={`absolute inset-10 rounded-full overflow-hidden bg-black/50 backdrop-blur-sm border shadow-[0_0_30px_rgba(0,243,255,0.2)] ${errorMsg ? 'border-red-500 shadow-[0_0_30px_rgba(255,0,0,0.2)]' : 'border-jarvis-cyan/50'}`}>
                {(voiceStatus === 'processing' || isConnecting) ? (
                   <ThinkingWidget />
                ) : (
                   <AudioVisualizer isActive={voiceStatus === 'speaking' || voiceStatus === 'listening'} />
                )}
            </div>

            {/* Start Button */}
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
        <div className={`mt-8 tracking-[0.3em] text-sm font-mono animate-pulse ${errorMsg ? 'text-red-500' : (voiceStatus === 'processing' || isConnecting) ? 'text-purple-400' : 'text-jarvis-blue'}`}>
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
      <footer className="absolute bottom-0 w-full p-6 flex justify-center z-10">
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