"use client";

import gsap from "gsap";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { buttonClass, cx } from "@/components/ui";
import { addToCartAction } from "../actions";
import { CART_EVENT, type CartEventDetail } from "./cart-link";

/** The flight renders inside the marketplace wrapper, which carries the Playfair font variable. */
function portalTarget() {
  return document.getElementById("marketplace-root") ?? document.body;
}

/* ───────────── The basket: a real box in CSS 3D, wire sides, a handle and two wheels ───────────── */

const W = 132; // width of the basket opening
const D = 92; // depth, front to back
const H = 78; // height of the sides
const WIRE: CSSProperties = {
  backgroundColor: "rgb(250 246 234 / 0.1)",
  backgroundImage: "repeating-linear-gradient(90deg, rgb(212 167 42 / 0.95) 0 2px, transparent 2px 14px), repeating-linear-gradient(0deg, rgb(212 167 42 / 0.95) 0 2px, transparent 2px 13px)",
  border: "3px solid #d4a72a",
  borderRadius: 4,
};
const face = (w: number, h: number, transform: string, extra: CSSProperties = {}): CSSProperties => ({
  position: "absolute",
  left: "50%",
  top: "50%",
  width: w,
  height: h,
  marginLeft: -w / 2,
  marginTop: -h / 2,
  transform,
  ...WIRE,
  ...extra,
});

/** The basket, seen from a little above and to the side, so its depth reads. `slot` sits inside it, behind the front wires. */
function Basket({ slot }: { slot?: React.ReactNode }) {
  return (
    <div style={{ width: W + 40, height: H + 70, perspective: 700 }} className="relative">
      <div data-basket style={{ position: "absolute", inset: 0, transformStyle: "preserve-3d", transform: "rotateX(-22deg) rotateY(28deg)" }}>
        <div style={face(W, D, `translateY(${H / 2}px) rotateX(90deg)`, { backgroundColor: "rgb(6 58 47 / 0.85)" })} />
        <div style={face(W, H, `translateZ(${-D / 2}px)`)} />
        <div style={face(D, H, `translateX(${-W / 2}px) rotateY(90deg)`)} />
        <div data-slot style={{ position: "absolute", left: "50%", top: "50%", transformStyle: "preserve-3d" }}>
          {slot}
        </div>
        <div style={face(D, H, `translateX(${W / 2}px) rotateY(90deg)`)} />
        <div style={face(W, H, `translateZ(${D / 2}px)`, { backgroundColor: "rgb(250 246 234 / 0.06)" })} />
        {/* Handle */}
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: 46,
            height: 10,
            marginLeft: W / 2 - 6,
            marginTop: -H / 2 - 30,
            transform: `translateZ(${-D / 2}px) rotate(-28deg)`,
            background: "#063a2f",
            border: "3px solid #d4a72a",
            borderRadius: 8,
          }}
        />
        {/* Wheels */}
        {[-W / 2 + 18, W / 2 - 18].map((x) => (
          <div
            key={x}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: 18,
              height: 18,
              marginLeft: x - 9,
              marginTop: H / 2 + 8,
              transform: `translateZ(${D / 2}px)`,
              background: "#063a2f",
              border: "4px solid #d4a72a",
              borderRadius: 999,
            }}
          />
        ))}
      </div>
    </div>
  );
}

/* ───────────── The flight ───────────── */

type Flight = { book: DOMRect; html: string; count: number | null };

/**
 * "Add to cart": the book is lifted off the page, tumbles in an arc into a 3D basket that rolls
 * up from the bottom of the screen, the basket gives a little bounce, then shrinks and flies into
 * the cart in the header, whose count pops. The server call runs alongside, so nothing waits on
 * the animation; reduced motion skips straight to the count.
 */
export function AddToCart({ listingId, inCart: initiallyInCart }: { listingId: string; inCart: boolean }) {
  const router = useRouter();
  const [inCart, setInCart] = useState(initiallyInCart);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flight, setFlight] = useState<Flight | null>(null);

  async function add() {
    setError(null);
    setBusy(true);
    const book = document.getElementById("listing-book");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const saved = addToCartAction(listingId);
    if (book && !reduce) {
      setFlight({ book: book.getBoundingClientRect(), html: book.innerHTML, count: null });
      // The book leaves the page while it flies, and comes back once the basket is home.
      book.style.visibility = "hidden";
    }
    const res = await saved;
    if (!res.ok) {
      if (book) book.style.visibility = "";
      setFlight(null);
      setBusy(false);
      if (res.signIn) router.push(`/login?next=${encodeURIComponent(`/marketplace/${listingId}`)}`);
      else setError(res.error);
      return;
    }
    setInCart(true);
    setBusy(false);
    if (!book || reduce) announce(res.count);
    else setFlight((f) => (f ? { ...f, count: res.count } : f));
  }

  function landed(count: number) {
    setFlight(null);
    announce(count);
    const book = document.getElementById("listing-book");
    if (book) {
      book.style.visibility = "";
      book.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 450, easing: "cubic-bezier(0.22,1,0.36,1)" });
    }
  }

  function announce(count: number) {
    window.dispatchEvent(new CustomEvent<CartEventDetail>(CART_EVENT, { detail: { count } }));
  }

  return (
    <>
      {inCart && !flight ? (
        <Link href="/marketplace/cart" className={cx(buttonClass("secondary"), "w-full justify-center")}>
          In your cart · View cart
        </Link>
      ) : (
        <button type="button" onClick={add} disabled={busy || !!flight} className={cx(buttonClass("secondary"), "w-full justify-center")}>
          {busy ? "Adding…" : "Add to cart"}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {flight && <FlightLayer flight={flight} onDone={landed} />}
    </>
  );
}

function FlightLayer({ flight, onDone }: { flight: Flight; onDone: (count: number) => void }) {
  const root = useRef<HTMLDivElement>(null);
  const landing = useRef<gsap.core.Timeline | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  // Phase one: lift, arc, drop into the basket, bounce. Runs before the first paint.
  useLayoutEffect(() => {
    const el = root.current!;
    const book = el.querySelector<HTMLElement>("[data-flying-book]")!;
    const cart = el.querySelector<HTMLElement>("[data-cart]")!;
    const slot = el.querySelector<HTMLElement>("[data-slot]")!;
    const s = slot.getBoundingClientRect();
    const from = flight.book;
    const dx = s.left - (from.left + from.width / 2);
    const dy = s.top - (from.top + from.height / 2);
    const tl = gsap
      .timeline({ defaults: { ease: "power2.inOut" } })
      .fromTo(cart, { y: 220, rotate: -6, opacity: 0 }, { y: 0, rotate: 0, opacity: 1, duration: 0.55, ease: "back.out(1.4)" }, 0)
      .to(book, { y: -38, rotateX: 14, rotateY: -18, scale: 1.08, duration: 0.35, ease: "power2.out" }, 0)
      .to(book, { x: dx, duration: 0.75, ease: "power1.inOut" }, 0.35)
      .to(book, { y: dy - 70, duration: 0.42, ease: "power2.out" }, 0.35)
      .to(book, { y: dy + 6, duration: 0.33, ease: "power2.in" }, 0.77)
      .to(book, { rotateY: -200, rotateZ: 14, scale: 58 / from.width, duration: 0.75, ease: "power1.inOut" }, 0.35)
      .set(book, { opacity: 0 }, 1.1)
      .set(slot.firstElementChild, { opacity: 1 }, 1.1)
      .to(cart, { scaleY: 0.9, scaleX: 1.06, duration: 0.12, ease: "power1.out", transformOrigin: "50% 100%" }, 1.1)
      .to(cart, { scaleY: 1, scaleX: 1, duration: 0.45, ease: "elastic.out(1, 0.45)" }, 1.22);
    landing.current = tl;
    return () => {
      tl.kill();
    };
  }, [flight.book]);

  // Phase two, once the server has the book in the cart and the bounce is over: the basket
  // shrinks and flies into the header cart, then the badge takes the new count.
  useEffect(() => {
    const tl = landing.current;
    if (flight.count === null || !tl) return;
    const count = flight.count;
    const cart = root.current!.querySelector<HTMLElement>("[data-cart]")!;
    const flyHome = () => {
      const nav = document.getElementById("nav-cart")?.getBoundingClientRect();
      const c = cart.getBoundingClientRect();
      gsap
        .timeline({ delay: 0.12, onComplete: () => done.current(count) })
        .to(cart, {
          x: nav ? nav.left + nav.width / 2 - (c.left + c.width / 2) : 0,
          y: nav ? nav.top + nav.height / 2 - (c.top + c.height / 2) : -c.top,
          scale: 0.16,
          rotate: 18,
          duration: 0.7,
          ease: "power3.in",
        })
        .to(cart, { opacity: 0, duration: 0.15 }, ">-0.1");
    };
    if (tl.progress() === 1) flyHome();
    else tl.eventCallback("onComplete", flyHome);
  }, [flight.count]);

  return createPortal(
    <div ref={root} aria-hidden className="pointer-events-none fixed inset-0 z-50">
      <div
        data-flying-book
        style={{ position: "fixed", left: flight.book.left, top: flight.book.top, width: flight.book.width, height: flight.book.height, transformPerspective: 900 } as CSSProperties}
        dangerouslySetInnerHTML={{ __html: flight.html }}
      />
      <div data-cart className="fixed bottom-[9vh] left-1/2 -translate-x-1/2">
        <Basket
          slot={
            <div
              style={{ opacity: 0, width: 54, height: 72, marginLeft: -27, marginTop: -44, transform: "rotateY(-12deg) rotateZ(10deg)" }}
              dangerouslySetInnerHTML={{ __html: flight.html }}
            />
          }
        />
      </div>
    </div>,
    portalTarget(),
  );
}
