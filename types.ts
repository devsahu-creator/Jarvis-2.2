export enum AppMode {
  NORMAL = 'NORMAL',
  LIVE = 'LIVE',
  VISION = 'VISION',
  THINK = 'THINK',
}

export interface Message {
  role: 'user' | 'model' | 'system';
  content: string;
  timestamp: Date;
  isThinking?: boolean;
  groundingUrls?: Array<{ title: string; uri: string }>;
}

export interface AudioVisualizerProps {
  stream?: MediaStream;
  isActive: boolean;
}

export interface ProcessingState {
  isProcessing: boolean;
  statusText: string;
}

// Minimal type for grounding chunks based on Gemini API
export interface GroundingChunk {
  web?: {
    uri: string;
    title: string;
  };
}
