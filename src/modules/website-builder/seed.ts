/**
 * Demo data for the Demo University's website, created through the real services as the real
 * people: Asha (Institute Admin) runs the website; Farah, Hema, Mehul and Neel write their own
 * faculty profiles; visitors send enquiries and reviews through the public functions.
 * Pictures are drawn locally (seed-images.ts); nothing is downloaded.
 */
import { asc, eq } from "drizzle-orm";
import type { SeedContext } from "@/contracts/module";
import { withTenant, type Actor } from "@/server/core";
import { createPost, publishPost, updatePost } from "./blog";
import { moveSection, publishPage, updateSection } from "./builder";
import { addGalleryPhotos, createTeamMember, createTestimonial, createVideo, updateGalleryCaption } from "./content";
import { addEnquiryNote, assignEnquiry, setEnquiryStatus, submitEnquiry } from "./enquiries";
import { approveFacultyProfile, saveFacultyProfile } from "./faculty";
import { uploadImage } from "./media";
import { saveProfile } from "./profile";
import { moderateReview, submitReview } from "./reviews";
import { siteEnquiries, siteEnquiryNotes, sitePosts, siteReviews } from "./schema";
import { campusSvg, coverSvg, crestSvg, portraitSvg, sceneSvg, toPng } from "./seed-images";
import type { MediaKind } from "./schema";
import type { SectionType } from "./sections";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

async function image(actor: Actor, kind: MediaKind, markup: string, alt = "") {
  return (await uploadImage(actor, { kind, bytes: await toPng(markup), alt })).id;
}

export async function seed(ctx: SeedContext) {
  const asha = await ctx.actorFor("asha@demo.edu");
  const courses = ctx.ids.courses;

  /* ── Institute profile ── */
  console.log("  website: profile and pictures…");
  const logo = await image(asha, "logo", crestSvg(), "Demo University crest");
  const cover = await image(asha, "cover", campusSvg(), "The main hall and clock tower");
  await saveProfile(asha, {
    tagline: "Practical degrees and certificate courses in Navi Mumbai since 1998",
    about: [
      "Demo University started in 1998 as a small evening institute in Vashi, teaching accounting to people who worked during the day. We still believe what we believed then: the best way to learn a skill is from someone who uses it at work, in a small group, at a time you can actually attend.",
      "Today about 2,400 students study with us each year across computer science and marketing. Every course runs in batches of 30 or fewer, with a fixed weekly timetable, live classes and a faculty member who knows your name.",
      "Our graduates work as analysts, developers and marketers at banks, start-ups and agencies across India. Many come back to teach.",
    ].join("\n\n"),
    foundedYear: 1998,
    address: "Plot 14, Sector 5, Vashi\nNavi Mumbai, Maharashtra 400703",
    city: "Navi Mumbai",
    mapUrl: "https://maps.google.com/?q=Sector+5+Vashi+Navi+Mumbai",
    phone: "+91 22 4000 1234",
    whatsapp: "+91 98200 12345",
    email: "admissions@demo.edu",
    social: {
      website: "https://www.demo.edu",
      instagram: "https://instagram.com/demouniversity",
      linkedin: "https://www.linkedin.com/school/demo-university",
      youtube: "https://www.youtube.com/@demouniversity",
    },
    primaryColor: "#17365d",
    logoMediaId: logo,
    coverMediaId: cover,
  });

  /* ── Faculty write their own profiles; Asha approves most of them ── */
  console.log("  website: faculty profiles…");
  const faculty: { email: string; seed: number; headline: string; bio: string; subjects: string[]; approve: boolean }[] = [
    {
      email: "farah@demo.edu",
      seed: 11,
      headline: "Senior Lecturer, Data Science",
      bio: "Farah spent eight years as an analyst at a Mumbai retail bank, building the credit-risk dashboards its branch managers still use. She teaches Data Analytics, Python Basics and Machine Learning Foundations.\n\nHer classes start with a real business question and end with a working answer. Students say she never moves on until everyone in the room can explain the result in their own words.",
      subjects: ["Python", "SQL", "Machine learning", "Statistics", "Power BI"],
      approve: true,
    },
    {
      email: "hema@demo.edu",
      seed: 3,
      headline: "Head of Computer Science",
      bio: "Hema leads the Computer Science department and designs its course structure with input from the companies that hire our graduates. Before joining us in 2012 she was a software engineer and later an engineering manager in Pune.\n\nShe still teaches a weekend database class every term, because it keeps her close to what students find hard.",
      subjects: ["Databases", "Software engineering", "Curriculum design"],
      approve: true,
    },
    {
      email: "mehul@demo.edu",
      seed: 8,
      headline: "Head of Marketing",
      bio: "Mehul ran performance marketing for two consumer brands before he started teaching. He heads the Marketing department and makes sure every batch works on live campaigns for real local businesses.",
      subjects: ["Brand strategy", "Performance marketing", "Analytics"],
      approve: true,
    },
    {
      email: "neel@demo.edu",
      seed: 6,
      headline: "Lecturer, Digital Marketing",
      bio: "Neel teaches the Digital Marketing evening batch and the Saturday intensive. He has managed paid search and social budgets for D2C brands for six years and still consults for a few of them.",
      subjects: ["Google Ads", "Meta ads", "Content", "SEO"],
      approve: false,
    },
  ];
  for (const f of faculty) {
    const actor = await ctx.actorFor(f.email);
    const photo = await image(actor, "faculty", portraitSvg(f.seed));
    const saved = await saveFacultyProfile(actor, actor.userId, { headline: f.headline, bio: f.bio, subjects: f.subjects, photoMediaId: photo }, { submit: true });
    if (f.approve) await approveFacultyProfile(asha, saved.id);
  }

  /* ── Testimonials ── */
  console.log("  website: testimonials, team, gallery and videos…");
  const testimonials = [
    {
      name: "Priya Menon",
      byline: "Data Analytics, class of 2025",
      quote: "I came in knowing Excel and left building dashboards that my manager now uses every Monday. The weekend batch meant I never had to choose between my job and the course.",
      seed: 21,
    },
    {
      name: "Arjun Kulkarni",
      byline: "Python Basics, now a backend developer",
      quote: "The small projects every weekend are what got me hired. In my interview I walked through a scraper I wrote in week six.",
      seed: 22,
    },
    {
      name: "Sana Shaikh",
      byline: "Digital Marketing, class of 2024",
      quote: "Our classes ran like a real agency. We managed live ad budgets for two local brands before we graduated.",
      seed: 23,
    },
    {
      name: "Rahul Iyer",
      byline: "Machine Learning Foundations",
      quote: "Clear, patient teaching, and homework that felt like work I would actually do in a job.",
      seed: 24,
    },
  ];
  for (const t of testimonials) {
    await createTestimonial(asha, { name: t.name, byline: t.byline, quote: t.quote, photoMediaId: await image(asha, "testimonial", portraitSvg(t.seed, 600)) });
  }

  /* ── Team ── */
  const team = [
    { name: "Dr. Kavita Deshpande", title: "Vice Chancellor", bio: "An economist by training, Kavita has led Demo University since 2015 and chairs its academic council.", seed: 31 },
    { name: "Prof. Sameer Joshi", title: "Dean of Academics", bio: "Sameer oversees course quality, assessment and faculty development across both departments.", seed: 32 },
    { name: "Anita D'Souza", title: "Registrar", bio: "Anita looks after admissions records, certificates and everything to do with your student file.", seed: 33 },
    { name: "Rohit Bansal", title: "Head of Admissions", bio: "Rohit and his team answer enquiries, help you pick a batch and explain fees and instalments.", seed: 34 },
    { name: "Meenal Shah", title: "Head of Placements", bio: "Meenal works with more than 120 hiring partners and runs mock interviews every term.", seed: 35 },
  ];
  for (const m of team) {
    await createTeamMember(asha, { name: m.name, title: m.title, bio: m.bio, photoMediaId: await image(asha, "team", portraitSvg(m.seed)) });
  }

  /* ── Gallery ── */
  const gallery: [Parameters<typeof sceneSvg>[0], string][] = [
    ["lawn", "The central lawn between classes"],
    ["library", "The library reading room, open until 9 pm on weekdays"],
    ["lab", "The data lab: 40 workstations with the tools you will use at work"],
    ["convocation", "Convocation 2025"],
    ["seminar", "A guest lecture in the seminar hall"],
    ["hackathon", "Weekend hackathon, Python Basics batch"],
  ];
  const photoIds: string[] = [];
  for (const [scene, caption] of gallery) photoIds.push(await image(asha, "gallery", sceneSvg(scene), caption));
  const rows = await addGalleryPhotos(asha, photoIds);
  for (const [i, row] of rows.entries()) await updateGalleryCaption(asha, row.id, gallery[i][1]);

  /* ── Videos (recommended viewing) ── */
  await createVideo(asha, {
    title: "What is a neural network? (3Blue1Brown)",
    url: "https://www.youtube.com/watch?v=aircAruvnKk",
    description: "A visual introduction to the ideas behind Machine Learning Foundations.",
  });
  await createVideo(asha, {
    title: "How neural networks learn (3Blue1Brown)",
    url: "https://youtu.be/IHZwWFHWa-w",
    description: "Gradient descent, explained without a single slide of formulas.",
  });
  await createVideo(asha, {
    title: "Learn Python from scratch (freeCodeCamp)",
    url: "https://www.youtube.com/watch?v=rfscVS0vtbw",
    description: "A full beginner's course: a good warm-up before Python Basics starts.",
  });

  /* ── Blog ── */
  console.log("  website: blog posts…");
  const posts = [
    {
      author: "asha@demo.edu",
      title: "Placements 2026: where our graduates went",
      slug: "placements-2026",
      cover: coverSvg("placements"),
      daysAgo: 4,
      excerpt: "92% of last year's graduates were working within six months. Here is who hired them, what they earn, and what helped most.",
      body: `<p>Every year we follow up with each graduating batch six months after their last class. This year 412 of the 448 students who finished a course in 2025 answered, and the results are the best we have recorded.</p>
<h2>The headline numbers</h2>
<ul><li><p><strong>92%</strong> were working, studying further or running their own business within six months.</p></li><li><p>The median starting salary for Data Analytics graduates was <strong>₹6.2 lakh</strong> a year.</p></li><li><p>One in four were hired by a company that had hired from us before.</p></li></ul>
<h2>Who hired</h2>
<p>Banks and financial services hired the most analysts, followed by e-commerce and consulting firms. Our marketing graduates went mostly to agencies and direct-to-consumer brands, several of them the same brands they ran campaigns for during the course.</p>
<blockquote><p>The interviewer asked about my capstone project for twenty minutes. I had the dashboard open on my phone.</p></blockquote>
<h2>What helped most</h2>
<p>When we asked graduates what made the difference, three answers came up again and again: the portfolio projects, the mock interviews with our placements team, and introductions from faculty who still work in industry.</p>
<p>If you would like the full report, <a href="mailto:admissions@demo.edu">write to the admissions office</a> and we will send it to you.</p>`,
    },
    {
      author: "farah@demo.edu",
      title: "Five SQL habits that make analysts faster",
      slug: "five-sql-habits",
      cover: coverSvg("sql"),
      daysAgo: 12,
      excerpt: "Small habits we teach in the first month of Data Analytics that save hours every week once you are on the job.",
      body: `<p>Most of the SQL our students write in their first job is not clever. It is clear, checked and easy for the next person to change. These are the habits we drill in the first month of Data Analytics.</p>
<h2>1. Name every column you select</h2>
<p>Avoid <code>select *</code> outside quick exploration. Naming columns documents your intent and protects your report when someone adds a column upstream.</p>
<h2>2. Count before and after every join</h2>
<p>A join that silently multiplies rows is the most common bug we see. Check the row count before and after:</p>
<pre><code>select count(*) from orders;
select count(*) from orders o join customers c on c.id = o.customer_id;</code></pre>
<h2>3. Build queries in steps</h2>
<p>Use common table expressions to give each step a name. Your future self, and your reviewer, will thank you.</p>
<h2>4. Keep dates as dates</h2>
<p>Filter with real date ranges, not text. It is faster and it avoids the classic “why is March missing?” bug.</p>
<h2>5. Write the question at the top</h2>
<p>A one-line comment saying what business question the query answers is the cheapest documentation there is.</p>`,
    },
    {
      author: "mehul@demo.edu",
      title: "Weekend batches: how to study while you work",
      slug: "studying-while-working",
      cover: coverSvg("weekend"),
      daysAgo: 23,
      excerpt: "More than half our students work full time. Here is what the ones who finish strong do differently.",
      body: `<p>More than half the people in our weekend and evening batches have a full-time job. Most finish their course; the ones who do best tend to share a few habits.</p>
<h2>Protect two short slots in the week</h2>
<p>Weekend classes carry most of the teaching, but the practice happens in between. Two slots of 45 minutes on weekdays are enough if you keep them.</p>
<h2>Tell your manager</h2>
<p>Many employers will give you a real problem to work on, and some will pay part of the fee. It is worth asking.</p>
<h2>Use the recordings, but not instead of class</h2>
<p>Every live class is recorded. Students who watch recordings to revise do well; students who rely on them instead of attending usually fall behind by week four.</p>
<h2>Pick the batch that fits your real week</h2>
<p>Our batches have fixed timings so you can plan. If your shifts change, you can ask to switch batch once a term, as long as the new batch has a free seat.</p>`,
    },
  ];
  for (const p of posts) {
    const author = await ctx.actorFor(p.author);
    const created = await createPost(asha, { title: p.title });
    const coverId = await image(asha, "post", p.cover, p.title);
    await updatePost(asha, created.id, { title: p.title, slug: p.slug, excerpt: p.excerpt, bodyHtml: p.body, coverMediaId: coverId, authorUserId: author.userId });
    await publishPost(asha, created.id);
    await withTenant(asha, (tx) =>
      tx
        .update(sitePosts)
        .set({ publishedAt: new Date(Date.now() - p.daysAgo * DAY), updatedAt: new Date(Date.now() - p.daysAgo * DAY + 2 * HOUR) })
        .where(eq(sitePosts.id, created.id)),
    );
  }
  // A draft that isn't on the site.
  const draft = await createPost(asha, { title: "Admissions open for the January term" });
  await updatePost(asha, draft.id, {
    title: "Admissions open for the January term",
    slug: "admissions-january-term",
    excerpt: "Dates, batches and fees for courses starting in January.",
    bodyHtml: "<p>Applications for the January term open on 1 December. Here is what is starting and when.</p>",
  });

  /* ── Home page: order, wording, then publish ── */
  console.log("  website: home page…");
  const edits: [SectionType, Parameters<typeof updateSection>[2]][] = [
    ["hero", { heading: "Learn the skills employers hire for, from people who use them every day", intro: "Degree and certificate courses in data, programming and marketing. Small batches, live classes, and timings that fit around college or work.", showNextBatch: true, imageMediaId: null }],
    [
      "about",
      {
        heading: "Almost thirty years of teaching that works",
        intro: "",
        body: "",
        highlights: [
          { value: "1998", label: "Founded in Vashi" },
          { value: "12,000+", label: "Alumni working across India" },
          { value: "92%", label: "Of 2025 graduates working within six months" },
          { value: "1 : 18", label: "Faculty to students" },
        ],
      },
    ],
    ["courses", { heading: "Courses starting soon", intro: "Pick a course, then choose the batch that fits your week. Every batch has a fixed timetable and a limited number of seats.", limit: 0 }],
    ["faculty", { heading: "Learn from practitioners", intro: "Our faculty work in the fields they teach, and bring this week's problems to class." }],
    ["testimonials", { heading: "What our students say", intro: "" }],
    ["gallery", { heading: "Life on campus", intro: "", limit: 9 }],
    ["reviews", { heading: "Reviews", intro: "From students who finished a course with us.", allowSubmissions: true }],
    ["videos", { heading: "Watch and learn", intro: "A taste of what our courses cover, from some of our favourite teachers on the internet." }],
    ["blog", { heading: "From our blog", intro: "", limit: 3 }],
    ["team", { heading: "Leadership", intro: "The people responsible for academics, admissions and student life." }],
    ["enquiry", { heading: "Ask us anything", intro: "Tell us what you would like to study. Our admissions team replies within one working day." }],
    ["contact", { heading: "Visit or call us", intro: "The admissions office is open Monday to Saturday, 9:30 am to 6 pm." }],
  ];
  for (const [type, input] of edits) await updateSection(asha, type, input);
  // Default order is hero, about, courses, faculty, testimonials, reviews, gallery…: put the gallery before reviews.
  await moveSection(asha, "gallery", "up");
  await publishPage(asha);

  /* ── Reviews from visitors, then moderated ── */
  console.log("  website: reviews and enquiries…");
  const reviews: { name: string; rating: number; body: string; course?: string; decision?: "approve" | "hide"; daysAgo: number }[] = [
    { name: "Aakash Pillai", rating: 5, course: "Data Analytics", decision: "approve", daysAgo: 40, body: "The best part was the capstone: a real dataset from a retail chain and a presentation to their team. I got my job because of it." },
    { name: "Shreya Nair", rating: 5, course: "Python Basics", decision: "approve", daysAgo: 33, body: "I had never written code before. The weekend projects were small enough to finish and big enough to be proud of." },
    { name: "Manoj Verma", rating: 4, course: "Digital Marketing", decision: "approve", daysAgo: 27, body: "Very practical, lots of live campaign work. I would have liked one more class on analytics, but the faculty stayed late to help." },
    { name: "Divya Krishnan", rating: 5, course: "Machine Learning Foundations", decision: "approve", daysAgo: 19, body: "Tough course, excellent teaching. Farah ma'am explains each model with a picture first and the maths second." },
    { name: "Harsh Patel", rating: 4, course: "Data Analytics", decision: "approve", daysAgo: 9, body: "Good structure and a friendly batch. The evening timing worked well with my office hours." },
    { name: "Tanvi Joshi", rating: 5, course: "Python Basics", daysAgo: 1, body: "Halfway through the course and already automating reports at work. The doubt-clearing sessions are really useful." },
    { name: "Kunal S", rating: 3, daysAgo: 0.2, body: "Course content is good but the parking near the campus is difficult on Saturdays. Please add more signage." },
    { name: "Best Offers", rating: 1, decision: "hide", daysAgo: 6, body: "Earn money from home, guaranteed returns every week, message us now for details." },
  ];
  for (const [i, r] of reviews.entries()) {
    const res = await submitReview(
      ctx.universityId,
      { name: r.name, email: `${r.name.toLowerCase().replace(/[^a-z]+/g, ".")}@example.com`, rating: r.rating, body: r.body, courseId: r.course ? courses[r.course] : null },
      { ip: `203.0.113.${10 + i}`, slug: ctx.universitySlug },
    );
    if (res.status !== "saved") continue;
    if (r.decision) await moderateReview(asha, res.id, r.decision);
    await withTenant(asha, (tx) => tx.update(siteReviews).set({ createdAt: new Date(Date.now() - r.daysAgo * DAY) }).where(eq(siteReviews.id, res.id)));
  }

  /* ── Enquiries from the website ── */
  const enquiries: {
    name: string;
    email: string;
    phone?: string;
    course?: string;
    message: string;
    hoursAgo: number;
    status?: "contacted" | "closed";
    assign?: boolean;
    notes?: string[];
  }[] = [
    { name: "Karan Malhotra", email: "karan.malhotra@example.com", phone: "+91 98765 11111", course: "Data Analytics", hoursAgo: 3, message: "Is there an instalment option for the fee? I work on weekdays, so I would want the weekend batch." },
    { name: "Vivek Rao", email: "vivek.rao@example.com", phone: "+91 99200 22222", course: "Machine Learning Foundations", hoursAgo: 20, message: "What maths do I need for this course? I did a B.Com and have not studied maths since class 12." },
    { name: "Imran Qureshi", email: "imran@example.com", hoursAgo: 30, assign: true, message: "Do you run corporate training? We have a team of 15 analysts who need SQL and Power BI." },
    {
      name: "Fatima Sheikh",
      email: "fatima.sheikh@example.com",
      phone: "+91 90040 33333",
      course: "Python Basics",
      hoursAgo: 72,
      status: "contacted",
      assign: true,
      message: "My son is in class 12. Can he join the weekend batch, and does he need to know any coding first?",
      notes: ["Called on Monday. Sent the syllabus; no coding needed. They will visit the campus on Saturday."],
    },
    {
      name: "Neha Gupta",
      email: "neha.g@example.com",
      course: "Digital Marketing",
      hoursAgo: 240,
      status: "closed",
      assign: true,
      message: "Do you help with internships after the course?",
      notes: ["Explained the placements programme and the live campaign projects.", "Enrolled in the Saturday intensive."],
    },
  ];
  for (const [i, e] of enquiries.entries()) {
    const res = await submitEnquiry(
      ctx.universityId,
      { name: e.name, email: e.email, phone: e.phone, message: e.message, courseId: e.course ? courses[e.course] : null, source: e.course ? "course" : "home" },
      { ip: `198.51.100.${20 + i}`, slug: ctx.universitySlug },
    );
    if (res.status !== "saved") continue;
    if (e.assign) await assignEnquiry(asha, res.id, asha.userId);
    for (const n of e.notes ?? []) await addEnquiryNote(asha, res.id, n);
    if (e.status) await setEnquiryStatus(asha, res.id, e.status);
    const at = new Date(Date.now() - e.hoursAgo * HOUR);
    await withTenant(asha, async (tx) => {
      await tx.update(siteEnquiries).set({ createdAt: at, updatedAt: at }).where(eq(siteEnquiries.id, res.id));
      const notes = await tx
        .select({ id: siteEnquiryNotes.id })
        .from(siteEnquiryNotes)
        .where(eq(siteEnquiryNotes.enquiryId, res.id))
        .orderBy(asc(siteEnquiryNotes.createdAt), asc(siteEnquiryNotes.id));
      for (const [k, n] of notes.entries()) {
        await tx.update(siteEnquiryNotes).set({ createdAt: new Date(at.getTime() + (k + 1) * 5 * HOUR) }).where(eq(siteEnquiryNotes.id, n.id));
      }
    });
  }
}
