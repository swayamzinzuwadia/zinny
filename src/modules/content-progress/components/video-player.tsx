"use client";

/**
 * Plays a lesson video and reports the parts watched, so the lesson completes at 90%.
 *   - Uploaded files: an HTML5 <video> (signed URL through the lesson's file route).
 *   - YouTube: the IFrame API (loaded from youtube.com).
 *   - Vimeo: the player's postMessage API.
 * Every 10 seconds of playback (and on pause, end and leaving the page) it posts the
 * ranges it played since the last report; the server adds them up.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { buttonClass, cx } from "@/components/ui";
import { embedUrl, type ExternalVideo, type WatchedRange } from "../lib/kinds";
import { ProgressBar } from "./bits";

type Source = { source: "upload"; src: string } | ExternalVideo;
type Initial = { completed: boolean; percent: number; position: number };

/** Collects watched ranges from a stream of playback positions. */
class Tracker {
  ranges: WatchedRange[] = [];
  private start: number | null = null;
  private last: number | null = null;

  tick(t: number, playing: boolean) {
    if (!playing || !Number.isFinite(t)) {
      this.close();
      return;
    }
    // A jump (seek) of more than 3 s, or going backwards, starts a new range.
    if (this.last !== null && (t < this.last - 0.5 || t > this.last + 3)) this.close();
    if (this.start === null) this.start = t;
    this.last = t;
  }

  close() {
    if (this.start !== null && this.last !== null && this.last > this.start) this.ranges.push([this.start, this.last]);
    this.start = null;
    this.last = null;
  }

  /** Ranges since the last take, including the one in progress (which continues). */
  take(): WatchedRange[] {
    const open = this.start !== null && this.last !== null && this.last > this.start ? ([[this.start, this.last]] as WatchedRange[]) : [];
    const out = [...this.ranges, ...open];
    this.ranges = [];
    if (this.last !== null) this.start = this.last;
    return out;
  }
}

declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement | string, opts: Record<string, unknown>) => YTPlayer; PlayerState: { PLAYING: number; ENDED: number; PAUSED: number } };
    onYouTubeIframeAPIReady?: () => void;
  }
}
type YTPlayer = { getCurrentTime(): number; getDuration(): number; getPlayerState(): number; seekTo(s: number, allow: boolean): void; destroy(): void };

let ytReady: Promise<void> | null = null;
function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve();
  ytReady ??= new Promise<void>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve();
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    document.head.appendChild(s);
  });
  return ytReady;
}

export function VideoPlayer({
  video,
  title,
  progressUrl,
  initial,
  nextHref,
}: {
  video: Source;
  title: string;
  progressUrl: string;
  initial: Initial;
  nextHref: string | null;
}) {
  const router = useRouter();
  const tracker = useRef(new Tracker());
  const duration = useRef(0);
  const position = useRef(initial.position);
  const sending = useRef(false);
  const [percent, setPercent] = useState(initial.percent);
  const [completed, setCompleted] = useState(initial.completed);
  const [courseDone, setCourseDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = useRef(initial.completed);

  const report = useCallback(
    async (opts: { beacon?: boolean } = {}) => {
      const ranges = tracker.current.take();
      if (!duration.current || (ranges.length === 0 && !opts.beacon)) return;
      const body = JSON.stringify({ ranges, duration: duration.current, position: position.current });
      if (opts.beacon && navigator.sendBeacon) {
        navigator.sendBeacon(progressUrl, new Blob([body], { type: "application/json" }));
        return;
      }
      if (sending.current) {
        tracker.current.ranges.unshift(...ranges);
        return;
      }
      sending.current = true;
      try {
        const res = await fetch(progressUrl, { method: "POST", headers: { "content-type": "application/json" }, body, credentials: "same-origin", keepalive: true });
        const r = (await res.json().catch(() => ({}))) as { percent?: number; completed?: boolean; courseCompleted?: boolean; error?: string };
        if (!res.ok) {
          setError(r.error ?? "Your progress couldn't be saved. Check your connection.");
          if (res.status >= 500) tracker.current.ranges.unshift(...ranges);
          return;
        }
        setError(null);
        if (typeof r.percent === "number") setPercent(r.percent);
        if (r.completed && !done.current) {
          done.current = true;
          setCompleted(true);
          if (r.courseCompleted) setCourseDone(true);
          router.refresh();
        }
      } catch {
        tracker.current.ranges.unshift(...ranges);
        setError("Your progress couldn't be saved. Check your connection; it will be saved when you're back online.");
      } finally {
        sending.current = false;
      }
    },
    [progressUrl, router],
  );

  // Report every 10 s while playing, and when leaving the page.
  useEffect(() => {
    const t = tracker.current;
    const every = setInterval(() => void report(), 10_000);
    const hide = () => {
      if (document.visibilityState === "hidden") {
        t.close();
        void report({ beacon: true });
      }
    };
    document.addEventListener("visibilitychange", hide);
    return () => {
      clearInterval(every);
      document.removeEventListener("visibilitychange", hide);
      t.close();
      void report({ beacon: true });
    };
  }, [report]);

  return (
    <div>
      <div className="relative aspect-video w-full overflow-hidden rounded-[18px] bg-brand-deep sm:rounded-[22px]">
        {video.source === "upload" ? (
          <FileVideo src={video.src} title={title} start={initial.completed ? 0 : initial.position} tracker={tracker.current} duration={duration} position={position} onPause={() => void report()} />
        ) : video.source === "youtube" ? (
          <YouTubeVideo video={video} title={title} start={initial.completed ? 0 : initial.position} tracker={tracker.current} duration={duration} position={position} onPause={() => void report()} />
        ) : (
          <VimeoVideo video={video} title={title} start={initial.completed ? 0 : initial.position} tracker={tracker.current} duration={duration} position={position} onPause={() => void report()} />
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {completed ? (
          <span className="inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1 text-[13px] font-medium text-brand-strong">Lesson complete</span>
        ) : (
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <ProgressBar percent={percent} className="max-w-56 flex-1" label={`${percent}% watched`} />
            <span className="text-[13px] text-muted">{percent}% watched. Completes at 90%.</span>
          </div>
        )}
        {completed && nextHref && (
          <Link href={nextHref} className={cx(buttonClass("primary", "sm"), "ml-auto")}>
            Next lesson
          </Link>
        )}
      </div>
      {courseDone && <p className="mt-3 rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand-strong">You&apos;ve finished every required lesson, so the course is complete.</p>}
      {error && (
        <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

type PlayerProps = {
  title: string;
  start: number;
  tracker: Tracker;
  duration: React.RefObject<number>;
  position: React.RefObject<number>;
  onPause: () => void;
};

function FileVideo({ src, title, start, tracker, duration, position, onPause }: PlayerProps & { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const tick = () => {
      position.current = v.currentTime;
      tracker.tick(v.currentTime, !v.paused && !v.ended && !v.seeking);
    };
    const meta = () => {
      duration.current = v.duration;
      if (start > 5 && start < v.duration - 5) v.currentTime = start;
    };
    const stop = () => {
      tick();
      tracker.close();
      onPause();
    };
    v.addEventListener("timeupdate", tick);
    v.addEventListener("loadedmetadata", meta);
    v.addEventListener("pause", stop);
    v.addEventListener("ended", stop);
    v.addEventListener("seeking", () => tracker.close());
    if (v.readyState >= 1) meta();
    return () => {
      v.removeEventListener("timeupdate", tick);
      v.removeEventListener("loadedmetadata", meta);
      v.removeEventListener("pause", stop);
      v.removeEventListener("ended", stop);
    };
  }, [tracker, duration, position, start, onPause]);
  if (failed) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-[14px] text-canvas/80">
        The video couldn&apos;t load. Refresh the page to try again.
      </div>
    );
  }
  return (
    <video
      ref={ref}
      src={src}
      title={title}
      controls
      playsInline
      preload="metadata"
      controlsList="nodownload"
      onError={() => setFailed(true)}
      className="h-full w-full bg-brand-deep"
    />
  );
}

function YouTubeVideo({ video, title, start, tracker, duration, position, onPause }: PlayerProps & { video: ExternalVideo }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let player: YTPlayer | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    let cancelled = false;
    void loadYouTubeApi().then(() => {
      if (cancelled || !host.current || !window.YT) return;
      const el = document.createElement("div");
      host.current.replaceChildren(el);
      player = new window.YT.Player(el, {
        host: "https://www.youtube-nocookie.com",
        videoId: video.videoId,
        width: "100%",
        height: "100%",
        playerVars: { rel: 0, playsinline: 1, modestbranding: 1, start: Math.floor(start > 5 ? start : 0) },
        events: {
          onReady: () => {
            duration.current = player?.getDuration() ?? 0;
            timer = setInterval(() => {
              if (!player) return;
              const playing = player.getPlayerState() === window.YT!.PlayerState.PLAYING;
              duration.current = player.getDuration() || duration.current;
              position.current = player.getCurrentTime();
              tracker.tick(position.current, playing);
            }, 1000);
          },
          onStateChange: (e: { data: number }) => {
            if (e.data === window.YT!.PlayerState.PAUSED || e.data === window.YT!.PlayerState.ENDED) {
              if (player) tracker.tick(player.getCurrentTime(), true);
              tracker.close();
              onPause();
            }
          },
        },
      });
    });
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      player?.destroy();
    };
  }, [video.videoId, start, tracker, duration, position, onPause]);
  return <div ref={host} className="h-full w-full [&>iframe]:h-full [&>iframe]:w-full" title={title} />;
}

function VimeoVideo({ video, title, start, tracker, duration, position, onPause }: PlayerProps & { video: ExternalVideo }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const post = (method: string, value?: unknown) => frame.current?.contentWindow?.postMessage(JSON.stringify(value === undefined ? { method } : { method, value }), "https://player.vimeo.com");
    let playing = false;
    let seeked = false;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== "https://player.vimeo.com" || e.source !== frame.current?.contentWindow) return;
      let msg: { event?: string; method?: string; value?: unknown; data?: { seconds?: number; duration?: number } };
      try {
        msg = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
      } catch {
        return;
      }
      if (msg.event === "ready") {
        for (const ev of ["play", "pause", "ended", "timeupdate", "seeked"]) post("addEventListener", ev);
        post("getDuration");
      }
      if (msg.method === "getDuration" && typeof msg.value === "number") {
        duration.current = msg.value;
        if (!seeked && start > 5 && start < msg.value - 5) {
          seeked = true;
          post("setCurrentTime", start);
        }
      }
      if (msg.event === "play") playing = true;
      if (msg.event === "timeupdate" && msg.data) {
        if (msg.data.duration) duration.current = msg.data.duration;
        position.current = msg.data.seconds ?? position.current;
        tracker.tick(position.current, playing);
      }
      if (msg.event === "seeked") tracker.close();
      if (msg.event === "pause" || msg.event === "ended") {
        playing = false;
        tracker.close();
        onPause();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [start, tracker, duration, position, onPause]);
  return (
    <iframe
      ref={frame}
      src={`${embedUrl(video)}&api=1`}
      title={title}
      className="h-full w-full"
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}
