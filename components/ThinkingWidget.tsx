import React from 'react';

export const ThinkingWidget: React.FC = () => {
  return (
    <div className="w-full h-full flex items-center justify-center relative">
      {/* Background Glow */}
      <div className="absolute inset-0 bg-purple-500/10 blur-xl rounded-full animate-pulse"></div>

      {/* Rotating Outer Ring */}
      <div className="absolute inset-2 border-t-2 border-r-2 border-purple-400/50 rounded-full animate-spin-slow"></div>
      
      {/* Counter-Rotating Inner Ring */}
      <div className="absolute inset-8 border-b-2 border-l-2 border-cyan-400/50 rounded-full animate-[spin_2s_linear_infinite_reverse]"></div>

      {/* Core Processing Unit */}
      <div className="relative z-10 flex flex-col items-center">
         <div className="flex space-x-1 mb-2">
            <div className="w-1 h-4 bg-purple-400 animate-[bounce_1s_infinite]"></div>
            <div className="w-1 h-6 bg-cyan-400 animate-[bounce_1s_infinite_0.2s]"></div>
            <div className="w-1 h-4 bg-purple-400 animate-[bounce_1s_infinite_0.4s]"></div>
         </div>
         <span className="text-[10px] tracking-[0.2em] text-purple-300 font-mono animate-pulse">PROCESSING</span>
      </div>
    </div>
  );
};