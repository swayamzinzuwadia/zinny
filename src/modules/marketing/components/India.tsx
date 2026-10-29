import { display } from "../fonts";
import css from "../landing.module.css";
import { Reveal } from "./Reveal";

const ITEMS = [
  { title: "GST, done right", body: "CGST and SGST, or IGST, worked out on every invoice, so accounts never splits tax by hand." },
  { title: "UPI first", body: "Razorpay checkout with UPI, cards and netbanking. Every payment is checked with Razorpay before a seat is confirmed." },
  { title: "Rupees to the paisa", body: "Prices, taxes and refunds are stored exactly, so the totals in every report add up." },
  { title: "Messages that arrive", body: "Email, SMS and WhatsApp through MSG91, with DLT templates, and an unsubscribe that is honoured." },
];

export function India() {
  return (
    <section aria-labelledby="india-title" className="border-t border-line px-4 py-28 md:py-36">
      <div className="mx-auto grid max-w-6xl gap-14 lg:grid-cols-[0.9fr_1.1fr] lg:gap-20">
        <Reveal>
          <p className="text-[14px] text-brand">Made for India</p>
          <h2
            id="india-title"
            className={`${display.className} mt-4 text-[clamp(2.5rem,5vw,4rem)] leading-[0.98] tracking-[-0.02em] ${css.balance}`}
          >
            Built for how institutes here actually run.
          </h2>
        </Reveal>
        <ul className="grid gap-x-10 gap-y-10 sm:grid-cols-2">
          {ITEMS.map((item, i) => (
            <li key={item.title}>
              <Reveal delay={i * 0.08}>
                <p className="text-[16px] font-medium">{item.title}</p>
                <p className={`mt-2 text-[15px] leading-relaxed text-muted ${css.pretty}`}>{item.body}</p>
              </Reveal>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
