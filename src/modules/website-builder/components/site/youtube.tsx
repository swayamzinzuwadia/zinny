"use client";

import { useState } from "react";
import { youtubeEmbed, youtubeThumb } from "../../youtube";

/**
 * A YouTube video that loads YouTube only when someone presses play: the page stays fast and
 * visitors aren't tracked until they choose to watch. Uses youtube-nocookie.com.
 */
export function YouTubeLite({ id, title }: { id: string; title: string }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="relative aspect-video overflow-hidden rounded-[22px] bg-ink">
      {playing ? (
        <iframe
          src={youtubeEmbed(id)}
          title={title}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
          className="absolute inset-0 h-full w-full"
        />
      ) : (
        <button type="button" onClick={() => setPlaying(true)} className="group absolute inset-0 h-full w-full" aria-label={`Play: ${title}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={youtubeThumb(id)} alt="" loading="lazy" className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100" />
          <span className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-[var(--site-primary)] text-[var(--site-on-primary)] shadow-lg transition-transform group-hover:scale-105">
            <svg width="22" height="22" viewBox="0 0 22 22" aria-hidden>
              <path d="M7 4.5v13l11-6.5z" fill="currentColor" />
            </svg>
          </span>
        </button>
      )}
    </div>
  );
}
