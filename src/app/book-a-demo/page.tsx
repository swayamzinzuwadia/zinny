import type { Metadata } from "next";
import { DemoRequestForm } from "@/modules/marketing/components/DemoRequestForm";
import { Footer } from "@/modules/marketing/components/Footer";
import { Nav } from "@/modules/marketing/components/Nav";
import { display } from "@/modules/marketing/fonts";
import { requestDemoAction } from "./actions";

export const metadata: Metadata = {
  title: "Book a demo",
  description: "Tell us about your institute and the Zinny team will set up a demo of courses, batches, live classes, tests, fees and the marketplace.",
};

/** "Book a demo" from the landing page and the marketplace: a short form that reaches the Zinny team. */
export default function BookADemo() {
  return (
    <div className={`display-headings flex min-h-dvh flex-col bg-canvas text-ink ${display.variable}`}>
      <Nav />
      <main className="mx-auto grid w-full max-w-[1240px] flex-1 gap-12 px-5 pt-28 pb-20 sm:px-8 sm:pt-36 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
        <div>
          <h1 className="text-[clamp(2.4rem,5vw,4rem)] leading-[1.05] tracking-[-0.02em]">
            Book a demo
          </h1>
          <p className="mt-5 max-w-[32rem] text-[17px] leading-relaxed text-ink/75">
            See how Zinny would run your institute: courses and batches, live classes, tests, fees with GST invoices, your website, and selling recordings on the marketplace.
          </p>
          <p className="mt-4 max-w-[32rem] text-[17px] leading-relaxed text-ink/75">
            Fill in the form and someone from the Zinny team will call or email you to find a time.
          </p>
        </div>
        <section aria-label="Your details" className="self-start rounded-[22px] bg-surface p-5 shadow-[0_24px_50px_-28px_rgb(6_58_47/0.45)] ring-1 ring-line sm:p-8">
          <DemoRequestForm action={requestDemoAction} />
        </section>
      </main>
      <Footer />
    </div>
  );
}
