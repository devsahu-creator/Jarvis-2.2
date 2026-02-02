import React, { useEffect, useRef } from 'react';

interface Props {
  mode: 'idle' | 'listening' | 'speaking';
}

export const AudioVisualizer: React.FC<Props> = ({ mode }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Resize canvas to parent
    const resize = () => {
        const parent = canvas.parentElement;
        if (parent) {
            canvas.width = parent.clientWidth;
            canvas.height = parent.clientHeight;
        }
    };
    window.addEventListener('resize', resize);
    resize();

    let animationId: number;
    let offset = 0;

    const draw = () => {
      const width = canvas.width;
      const height = canvas.height;
      const centerY = height / 2;

      ctx.clearRect(0, 0, width, height);

      if (mode === 'idle') {
        // Idle State: Gentle pulse line
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(0, 168, 255, 0.3)';
        ctx.lineWidth = 1;
        ctx.moveTo(0, centerY);
        ctx.lineTo(width, centerY);
        ctx.stroke();
      } else if (mode === 'listening') {
        // Listening State: Active Input (White/Green focus)
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#ffffff'; // White for user input
        ctx.shadowBlur = 10;
        ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
        
        ctx.beginPath();
        ctx.moveTo(0, centerY);

        // Faster, sharper wave for voice input simulation
        for (let x = 0; x < width; x++) {
          const y = centerY + 
            Math.sin((x + offset * 1.5) * 0.05) * 25 * Math.sin(x * 0.01);
          
          ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (mode === 'speaking') {
        // Speaking State: Complex AI Output (Cyan)
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#00f3ff';
        ctx.shadowBlur = 15;
        ctx.shadowColor = '#00f3ff';
        
        ctx.beginPath();
        ctx.moveTo(0, centerY);

        for (let x = 0; x < width; x++) {
          // Superposition of sine waves for "voice-like" complexity
          const y = centerY + 
            Math.sin((x + offset) * 0.03) * 30 * Math.sin(x * 0.005) + // Carrier
            Math.sin((x - offset * 2) * 0.05) * 15;                   // Modulator
          
          ctx.lineTo(x, y);
        }
        ctx.stroke();
        
        // Mirror effect for "tech" look
        ctx.globalAlpha = 0.2;
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        for (let x = 0; x < width; x++) {
            const y = centerY - (
              Math.sin((x + offset) * 0.03) * 30 * Math.sin(x * 0.005) +
              Math.sin((x - offset * 2) * 0.05) * 15
            );
            ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.globalAlpha = 1.0;
        ctx.shadowBlur = 0;
      }

      offset += 8; // Speed of animation
      animationId = requestAnimationFrame(draw);
    };

    draw();

    return () => {
        cancelAnimationFrame(animationId);
        window.removeEventListener('resize', resize);
    };
  }, [mode]);

  return (
    <canvas 
      ref={canvasRef} 
      className="w-full h-full"
    />
  );
};