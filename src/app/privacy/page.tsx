import Link from "next/link";
import { ButtonLink, cx } from "@/components/ui";
import { PublicShell } from "@/modules/privacy/components/public-shell";
import { CookieSettingsButton } from "@/modules/privacy/components/cookie-banner";
import { DATA_ITEMS, RIGHTS, grievanceOfficer } from "@/modules/privacy/lib/notice";
import { ERASURE_NOTICE_HOURS, GUARDIAN_LINK_DAYS, INVOICE_RETENTION_YEARS, LOG_RETENTION_DAYS, MAX_RESPONSE_DAYS, NOTICE_DATE, NOTICE_VERSION } from "@/modules/privacy/lib/rules";

export const metadata = { title: "Privacy notice", description: "What Zinny collects, why, how long we keep it, and how to use your rights under India's DPDP Act." };

const date = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${NOTICE_DATE}T00:00:00Z`));

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-8 border-t border-line pt-8">
      <h2 className="text-[clamp(1.5rem,4vw,1.9rem)] leading-tight font-medium">{title}</h2>
      <div className="mt-3 space-y-3 text-[16px] leading-relaxed text-ink/90">{children}</div>
    </section>
  );
}

/**
 * The privacy notice (DPDP Act s.5, Rules 3 and 9): plain words, itemised, versioned. In
 * English, with a Hindi version of the essentials at ?lang=hi; other Eighth Schedule languages on request.
 */
export default async function PrivacyNoticePage({ searchParams }: { searchParams: Promise<{ lang?: string }> }) {
  const hindi = (await searchParams).lang === "hi";
  const g = grievanceOfficer();
  return (
    <PublicShell>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted">
          Version {NOTICE_VERSION} · {date}
        </p>
        <nav aria-label="Language" className="inline-flex rounded-full border border-line bg-surface p-1 text-[13px]">
          {[
            { href: "/privacy", label: "English", on: !hindi },
            { href: "/privacy?lang=hi", label: "हिन्दी", on: hindi },
          ].map((l) => (
            <Link key={l.href} href={l.href} aria-current={l.on ? "page" : undefined} className={cx("rounded-full px-3 py-1 transition-colors", l.on ? "bg-brand text-canvas" : "text-muted hover:text-ink")}>
              {l.label}
            </Link>
          ))}
        </nav>
      </div>

      {hindi ? <Hindi /> : null}

      <div lang="en" className={cx("space-y-8", hindi && "mt-12")}>
        <div>
          <h1 className="text-[clamp(2.1rem,6vw,3.2rem)] leading-[1.05] font-medium tracking-[-0.02em]">{hindi ? "Privacy notice (English)" : "Privacy notice"}</h1>
          <p className="mt-4 text-[17px] leading-relaxed text-muted">
            This notice says what personal data Zinny collects, why, how long we keep it, and how you can see it, correct it, erase it or complain. It follows India&apos;s Digital Personal
            Data Protection Act, 2023 and the DPDP Rules, 2025.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <ButtonLink href="/privacy/my" icon="settings">
              Manage your privacy
            </ButtonLink>
            <ButtonLink href="#grievance" variant="secondary" icon="forward">
              Contact the grievance officer
            </ButtonLink>
          </div>
        </div>

        <Section id="who" title="Who decides what happens to your data">
          <p>
            <strong className="font-medium">If you study at an institute on Zinny,</strong> your institute is the Data Fiduciary: it decides how your data is used. Zinny is its Data
            Processor, and only processes your data to run Zinny for the institute, under contract with it.
          </p>
          <p>
            <strong className="font-medium">If you buy from the Zinny marketplace, or sign an institute up,</strong> {g.fiduciary} (&ldquo;Zinny&rdquo;) is the Data Fiduciary for your
            account.
          </p>
          <p>Either way, you use your rights in the same place: your privacy settings. Requests reach whoever holds the data.</p>
        </Section>

        <Section id="data" title="What we collect, why, and how long we keep it">
          <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {DATA_ITEMS.map((d) => (
              <li key={d.what} className="grid gap-1 px-4 py-3.5 sm:grid-cols-[1.1fr_1.3fr_1fr] sm:gap-4">
                <span className="text-[15px] font-medium">{d.what}</span>
                <span className="text-[14px] text-muted">{d.why}</span>
                <span className="text-[13px] text-muted">
                  <span className="sm:hidden">Kept: </span>
                  {d.kept}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[14px] text-muted">
            We never take your full Aadhaar number. We don&apos;t sell personal data or use it for advertising. We don&apos;t track learners under 18 or show them targeted ads.
          </p>
        </Section>

        <Section id="withdraw" title="Your consent, and how to withdraw it">
          <p>
            We ask for each purpose separately. Your account and the courses you take need some data to work at all. News and offers, and usage analytics, are optional and switched off
            until you switch them on.
          </p>
          <p>
            Withdrawing is as easy as giving: open <Link href="/privacy/my" className="text-brand underline underline-offset-2">your privacy settings</Link> and tap Withdraw next to
            it. It takes effect at once and doesn&apos;t change anything done before. To stop everything, ask for your account to be erased.
          </p>
        </Section>

        <Section id="rights" title="Your rights">
          <ul className="grid gap-3 sm:grid-cols-2">
            {RIGHTS.map((r) => (
              <li key={r.title} className="rounded-2xl border border-line bg-surface p-4">
                <p className="font-medium">{r.title}</p>
                <p className="mt-1 text-[14px] text-muted">{r.body}</p>
              </li>
            ))}
          </ul>
          <p>
            Use them from <Link href="/privacy/my" className="text-brand underline underline-offset-2">your privacy settings</Link>, or by writing to the grievance officer below. We
            reply within {g.responseDays} days and never later than {MAX_RESPONSE_DAYS}.
          </p>
        </Section>

        <Section id="children" title="Learners under 18">
          <p>
            We ask every new learner whether they are 18 or older. For a learner under 18 we need a parent or legal guardian&apos;s consent: we send them a link by email or SMS that
            works for {GUARDIAN_LINK_DAYS} days, and record their confirmation. Until then, optional purposes and anything that tracks how the learner behaves stay off.
          </p>
        </Section>

        <Section id="cookies" title="Cookies">
          <p>
            We use essential cookies only: to keep you signed in, protect your account, and remember your cookie choice. An analytics cookie is used only if you switch it on, and you can
            switch it off again here.
          </p>
          <CookieSettingsButton />
        </Section>

        <Section id="retention" title="How long we keep data">
          <p>
            We keep data only while it is needed for the purpose you gave it for. An account nobody has used for 3 years (institutes can choose a shorter period) is erased. We tell you at
            least {ERASURE_NOTICE_HOURS} hours before, so you can sign in to keep it.
          </p>
          <p>
            Two things stay longer because the law requires it: GST invoices for {INVOICE_RETENTION_YEARS} years, and records of consents, sign-ins and processing for at least{" "}
            {LOG_RETENTION_DAYS} days.
          </p>
        </Section>

        <Section id="sharing" title="Who else handles your data">
          <p>
            Only service providers that help us run Zinny, under contract and for that purpose alone: our hosting and database (in India, Mumbai region), payments (Razorpay), and email and
            SMS delivery. Your institute sees the data of its own learners. We share data with authorities only when the law requires it.
          </p>
        </Section>

        <Section id="breaches" title="If something goes wrong">
          <p>
            If your personal data is exposed in a breach, we tell you without delay: what happened, what it means for you, what we have done, and what you can do. We report it to the Data
            Protection Board of India within 72 hours.
          </p>
        </Section>

        <Section id="grievance" title="Grievance officer">
          <div className="rounded-2xl border border-line bg-surface p-5">
            <p className="text-[17px] font-medium">{g.name}</p>
            <p className="mt-1">
              <a href={`mailto:${g.email}`} className="text-brand underline underline-offset-2">
                {g.email}
              </a>
              {g.phone && <> · {g.phone}</>}
            </p>
            {g.address && <p className="mt-1 text-[14px] text-muted">{g.address}</p>}
            <p className="mt-3 text-[14px] text-muted">
              We answer every complaint within {g.responseDays} days. Institutes may name their own contact; you&apos;ll see it in your privacy
              settings.
            </p>
          </div>
          <p>
            If you are not satisfied with our answer, you can complain to the Data Protection Board of India once you have used this route. You can also nominate someone to use these rights
            for you.
          </p>
        </Section>

        <Section id="languages" title="Other languages">
          <p>
            This notice is in English and Hindi here. Write to the grievance officer for it in any language listed in the Eighth Schedule to the Constitution of India, and we&apos;ll send it.
          </p>
        </Section>
      </div>
    </PublicShell>
  );
}

/** The essentials in Hindi. */
function Hindi() {
  const g = grievanceOfficer();
  return (
    <div lang="hi" className="mt-6 space-y-5 rounded-[22px] border border-line bg-surface p-5 sm:p-7">
      <h1 className="text-[clamp(1.9rem,5vw,2.6rem)] leading-tight font-medium">गोपनीयता सूचना</h1>
      <p className="text-[16px] leading-relaxed">
        यह सूचना बताती है कि Zinny कौन-सा व्यक्तिगत डेटा लेता है, क्यों, कितने समय तक रखता है, और आप उसे कैसे देख, सुधार या मिटवा सकते हैं। यह डिजिटल व्यक्तिगत डेटा संरक्षण अधिनियम, 2023 और नियम, 2025 के अनुसार है।
      </p>
      <h2 className="text-[1.4rem] font-medium">हम क्या लेते हैं और क्यों</h2>
      <ul className="list-disc space-y-1.5 pl-5 text-[15px]">
        <li>नाम, ईमेल और मोबाइल नंबर: आपका खाता बनाने और साइन इन के लिए।</li>
        <li>कोर्स, उपस्थिति, टेस्ट और प्रमाणपत्र: आपका संस्थान आपको पढ़ा सके, इसके लिए।</li>
        <li>भुगतान और GST इनवॉइस: कानून के अनुसार {INVOICE_RETENTION_YEARS} साल तक रखे जाते हैं।</li>
        <li>PAN (एन्क्रिप्टेड) और आधार के केवल अंतिम 4 अंक: संस्थान के KYC के लिए। पूरा आधार नंबर हम कभी नहीं लेते।</li>
      </ul>
      <h2 className="text-[1.4rem] font-medium">आपके अधिकार</h2>
      <p className="text-[15px] leading-relaxed">
        आप अपना डेटा डाउनलोड कर सकते हैं, सुधार या मिटाने का अनुरोध कर सकते हैं, सहमति वापस ले सकते हैं (देने जितना ही आसान), और किसी व्यक्ति को नामित कर सकते हैं। 18 साल से कम उम्र के शिक्षार्थियों के लिए माता-पिता या अभिभावक की सहमति ज़रूरी है।
      </p>
      <h2 className="text-[1.4rem] font-medium">शिकायत अधिकारी</h2>
      <p className="text-[15px] leading-relaxed">
        {g.name}, <a href={`mailto:${g.email}`} className="text-brand underline underline-offset-2">{g.email}</a>। हम {g.responseDays} दिनों में जवाब देते हैं। संतुष्ट न होने पर आप भारत के डेटा संरक्षण बोर्ड में शिकायत कर सकते हैं।
      </p>
      <ButtonLink href="/privacy/my" icon="settings">
        अपनी गोपनीयता सेटिंग खोलें
      </ButtonLink>
    </div>
  );
}
