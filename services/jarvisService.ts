import { GoogleGenAI, LiveServerMessage, Modality, Type, FunctionDeclaration } from "@google/genai";
import { Message, GroundingChunk } from "../types";
import { base64ToUint8Array, decodeAudioData, createPcmBlob } from "./audioUtils";

const API_KEY = process.env.API_KEY;

const SYSTEM_INSTRUCTION = `
You are JARVIS (Just A Rather Very Intelligent System), customized with a friendly Indian spirit.
**Language Rule**: Speak in **Hinglish** (natural mix of Hindi and English).
**Persona**: Tony Stark's AI assistant, but "Desi". Loyal, witty, smart, and efficient.
**Tone**: Use "Sir" or "Boss". Be cool and helpful.

**CRITICAL CAPABILITY - WEB NAVIGATION & MEDIA**:
1. **Play Media (YouTube)**: Use 'playMedia' to *search* and open videos.
   - "Play Arijit Singh songs" -> playMedia({ query: "Arijit Singh songs", type: "video" })
   - **CONFIRMATION**: Always say "Playing [query] on YouTube, Sir."

2. **Media Control (Playback)**: Use 'controlMedia' to play/pause current video.
   - "Play video", "Resume", "Video chalao" -> controlMedia({ action: "play" })
   - "Pause video", "Stop", "Ruko" -> controlMedia({ action: "pause" })
   - **CONFIRMATION**: Say "Video resumed" or "Video paused".

3. **Browser Control (Scrolling)**: Use 'scrollPage' for navigation.
   - "Scroll down", "Niche jao" -> scrollPage({ action: "down" })
   - "Scroll up", "Upar jao" -> scrollPage({ action: "up" })
   - "Scroll more", "Aur niche" -> scrollPage({ action: "down" })
   - "Start scrolling", "Auto scroll" -> scrollPage({ action: "auto" })
   - "Stop scrolling", "Ruk jao" -> scrollPage({ action: "stop" })
   - **CONFIRMATION**: Say "Scrolling down", "Auto scroll initiated", or "Stopping scroll".

4. **Google Search**: Use 'googleSearch' for general queries.
   - "Google who is Iron Man" -> googleSearch({ query: "who is Iron Man" })
   - **CONFIRMATION**: Always say "Searching Google for [query], Sir."

5. **Open Websites**: Use 'openWebsite' for specific URLs.
   - **CONFIRMATION**: Say "Opening website, Sir."

OTHER CAPABILITIES:
- Check time ('getCurrentTime').
- System status ('getSystemStatus').
- Generate images ('generateImage').
- Lock system ('lockSystem').

**EXECUTION PROTOCOL**:
1. Receive command.
2. Call the appropriate tool.
3. Wait for the tool result.
4. **IMMEDIATELY** provide a verbal confirmation to the user based on the tool execution.
`;

// Define Tools
const tools: FunctionDeclaration[] = [
  {
    name: "getCurrentTime",
    description: "Get the current local system time.",
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: "playMedia",
    description: "Search and open videos or shorts on YouTube in a new tab.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: { type: Type.STRING, description: "The video to search for." },
        type: { type: Type.STRING, description: "Type: 'video' or 'short'." },
      },
      required: ["query"],
    },
  },
  {
    name: "controlMedia",
    description: "Control video playback (play/pause) using keyboard shortcuts.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        action: { type: Type.STRING, description: "Action: 'play' or 'pause'." },
      },
      required: ["action"],
    },
  },
  {
    name: "scrollPage",
    description: "Scroll the page content.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            action: { type: Type.STRING, description: "Action: 'up', 'down', 'auto', or 'stop'." }
        },
        required: ["action"]
    }
  },
  {
    name: "openWebsite",
    description: "Open any website URL in a new tab.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        url: { type: Type.STRING, description: "The full URL to open." },
      },
      required: ["url"],
    },
  },
  {
    name: "googleSearch",
    description: "Perform a Google Search.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            query: { type: Type.STRING, description: "The search query." }
        },
        required: ["query"]
    }
  },
  {
    name: "getSystemStatus",
    description: "Get system status.",
    parameters: {
        type: Type.OBJECT,
        properties: {},
    }
  },
  {
    name: "generateImage",
    description: "Generate an image.",
    parameters: {
        type: Type.OBJECT,
        properties: {
            prompt: { type: Type.STRING, description: "The image description" }
        },
        required: ["prompt"]
    }
  },
  {
    name: "lockSystem",
    description: "Lock the system.",
    parameters: {
        type: Type.OBJECT,
        properties: {}
    }
  }
];

export type VoiceStatus = 'listening' | 'processing' | 'speaking' | 'idle';

export const JarvisService = {
  async sendMessage(
    history: Message[],
    newMessage: string
  ): Promise<{ text: string; groundingUrls?: { title: string; uri: string }[] }> {
    if (!process.env.API_KEY) {
        return { text: "API Key is missing. Please check your environment configuration." };
    }
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [
          ...history.map(m => ({ role: m.role, parts: [{ text: m.content }] })),
          { role: 'user', parts: [{ text: newMessage }] }
        ],
        config: { systemInstruction: SYSTEM_INSTRUCTION }
      });
      return { text: response.text || "Sorry Sir, connection mein kuch issue hai." };
    } catch (e) {
      console.error(e);
      return { text: "Error connecting to neural network." };
    }
  },

  async generateImage(prompt: string): Promise<string | null> {
    if (!process.env.API_KEY) return null;
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts: [{ text: prompt }] },
        });
        
        for (const part of response.candidates?.[0]?.content?.parts || []) {
            if (part.inlineData) {
                return part.inlineData.data;
            }
        }
        return null;
    } catch (e) {
        console.error("Image generation failed", e);
        return null;
    }
  },

  async connectLive(
    audioContext: AudioContext,
    inputStream: MediaStream,
    onAudioData: (buffer: AudioBuffer) => void,
    onTranscript: (role: 'user' | 'model', text: string) => void,
    onStatusChange: (status: VoiceStatus) => void,
    onToolCallback: (name: string, args: any) => Promise<any>,
    onClose: () => void,
    onError: (error: Error) => void
  ) {
    if (!process.env.API_KEY) {
        throw new Error("API Key is missing in environment variables.");
    }
    const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

    const source = audioContext.createMediaStreamSource(inputStream);
    const processorWorkaroundGain = audioContext.createGain();
    processorWorkaroundGain.gain.value = 0;
    
    const scriptProcessor = audioContext.createScriptProcessor(4096, 1, 1);
    
    let currentInputTranscription = '';
    let currentOutputTranscription = '';
    let silenceTimer: any = null;
    let isModelSpeaking = false;

    const sessionPromise = ai.live.connect({
      model: 'gemini-2.5-flash-native-audio-preview-12-2025',
      callbacks: {
        onopen: () => {
            console.log("JARVIS Live Connection Established");
            onStatusChange('idle');
        },
        onmessage: async (msg: LiveServerMessage) => {
            // 1. Handle Tool Calls
            if (msg.toolCall) {
                onStatusChange('processing');
                const responses = [];
                for (const fc of msg.toolCall.functionCalls) {
                    console.log(`Executing Tool: ${fc.name}`, fc.args);
                    let result = {};
                    
                    try {
                        // Delegate all tool execution to the callback (App.tsx)
                        // This allows App.tsx to handle window.open, scrolling, etc.
                        if (['openWebsite', 'googleSearch', 'playMedia', 'controlMedia', 'scrollPage', 'generateImage', 'lockSystem'].includes(fc.name)) {
                             result = await onToolCallback(fc.name, fc.args);
                        } else if (fc.name === 'getCurrentTime') {
                             result = { time: new Date().toLocaleTimeString() };
                        } else if (fc.name === 'getSystemStatus') {
                             result = { 
                                status: 'nominal', 
                                platform: navigator.platform, 
                                online: navigator.onLine,
                                timestamp: Date.now()
                            };
                        }
                    } catch (err) {
                        console.error(`Tool Execution Failed: ${fc.name}`, err);
                        result = { error: 'Execution failed', details: String(err) };
                    }

                    responses.push({
                        id: fc.id,
                        name: fc.name,
                        response: { result }
                    });
                }
                
                sessionPromise.then(session => {
                    session.sendToolResponse({ functionResponses: responses });
                });
            }

            // 2. User Input Transcription
            if (msg.serverContent?.inputTranscription) {
                currentInputTranscription += msg.serverContent.inputTranscription.text;
                
                if (!isModelSpeaking) {
                    onStatusChange('listening');
                }

                if (silenceTimer) clearTimeout(silenceTimer);
                
                silenceTimer = setTimeout(() => {
                    if (!isModelSpeaking && currentInputTranscription.trim().length > 0) {
                        onStatusChange('processing');
                    }
                }, 800);
            }

            // 3. Audio Output
            const base64Audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio) {
                if (silenceTimer) clearTimeout(silenceTimer);
                isModelSpeaking = true;
                onStatusChange('speaking');
                
                if (msg.serverContent?.outputTranscription) {
                    currentOutputTranscription += msg.serverContent.outputTranscription.text;
                }

                const audioBuffer = await decodeAudioData(
                    base64ToUint8Array(base64Audio), 
                    audioContext, 
                    24000, 
                    1
                );
                onAudioData(audioBuffer);
            }

            // 4. Turn Complete
            if (msg.serverContent?.turnComplete) {
                isModelSpeaking = false;
                if (silenceTimer) clearTimeout(silenceTimer);
                
                if (currentOutputTranscription.trim()) {
                    onTranscript('model', currentOutputTranscription);
                }
                
                currentInputTranscription = '';
                currentOutputTranscription = '';
                
                onStatusChange('idle');
            }
        },
        onclose: () => {
            console.log("JARVIS Live Connection Closed");
            onClose();
        },
        onerror: (err) => {
            console.error("JARVIS Live Error", err);
            onError(err instanceof Error ? err : new Error("Network connection error"));
            onClose();
        }
      },
      config: {
        responseModalities: [Modality.AUDIO],
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        tools: [{ functionDeclarations: tools }],
        speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Fenrir' } }
        },
        systemInstruction: SYSTEM_INSTRUCTION,
      }
    });

    const session = await sessionPromise;

    scriptProcessor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        const pcmBlob = createPcmBlob(inputData);
        session.sendRealtimeInput({ media: pcmBlob });
    };
    
    source.connect(scriptProcessor);
    scriptProcessor.connect(processorWorkaroundGain);
    processorWorkaroundGain.connect(audioContext.destination);

    return {
        disconnect: async () => {
            source.disconnect();
            scriptProcessor.disconnect();
            processorWorkaroundGain.disconnect();
            if (silenceTimer) clearTimeout(silenceTimer);
            await session.close();
        }
    };
  }
};