"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

/**
 * Muted, looping, inline gameplay trailer for the homepage hero. It starts
 * playing only after hydration and only when the visitor has not asked for
 * reduced motion; the poster stands in until then (and without JavaScript).
 * A visible control pauses or resumes it at any time.
 */
export function HeroTrailer({ video, poster }: { video: string; poster: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const pausedByVisitor = useRef(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.muted = true;
    element.defaultMuted = true;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => {
      if (motion.matches || pausedByVisitor.current) {
        element.autoplay = false;
        element.pause();
      } else {
        element.autoplay = true;
        void element.play().catch(() => undefined);
      }
    };
    sync();
    motion.addEventListener("change", sync);
    return () => motion.removeEventListener("change", sync);
  }, []);

  function toggle() {
    const element = ref.current;
    if (!element) return;
    if (element.paused) {
      pausedByVisitor.current = false;
      void element.play().catch(() => undefined);
    } else {
      pausedByVisitor.current = true;
      element.pause();
    }
  }

  return (
    <figure className="hero-trailer">
      <video
        ref={ref}
        muted
        loop
        playsInline
        preload="metadata"
        poster={poster}
        aria-label="RTS AI gameplay trailer"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      >
        <source src={video} type="video/mp4" />
      </video>
      <button type="button" onClick={toggle}>
        {playing ? <Pause size={14} /> : <Play size={14} />} {playing ? "Pause trailer" : "Play trailer"}
      </button>
      <a href={video} target="_blank" rel="noopener noreferrer">Watch full trailer with sound</a>
    </figure>
  );
}
