# How Zinny works: flowcharts

Eight flowcharts that follow the code as of November 2026. GitHub draws them as diagrams. The same charts, with notes, are on the shared flowchart page.

## 1. The platform at a glance

Four kinds of people come in through public pages or their own space. Every space calls the same services, and every service reaches the database only through its own institute's walls.

```mermaid
%%{init: {"theme": "base", "flowchart": {"useMaxWidth": false, "curve": "basis", "padding": 14}, "themeVariables": {"primaryColor": "#ffffff", "primaryBorderColor": "#7d8f89", "primaryTextColor": "#17221f", "lineColor": "#7d8f89", "clusterBkg": "#f1f5f3", "clusterBorder": "#c9d5d1", "edgeLabelBackground": "#ffffff", "titleColor": "#1f5d4c"}}}%%
flowchart TB
  classDef ok fill:#e6f0ec,stroke:#1f5d4c,color:#17221f
  classDef warn fill:#fbf3dc,stroke:#b8860b,color:#17221f
  classDef data fill:#eef2f1,stroke:#5b6b66,color:#17221f

  subgraph People["Who uses Zinny"]
    V["Visitor"]
    S["Student, parent, alumni"]
    I["Institute staff<br/>admin, board, accounts, HOD, faculty"]
    Z["Zinny team<br/>super admin, account manager, finance, support, content QA"]
  end

  subgraph Public["Public pages"]
    LP["Landing page /"]
    MK["Marketplace /marketplace"]
    WS["Institute websites /site/institute"]
    VF["Certificate check /verify"]
    SU["Sign up /signup and Book a demo"]
    PN["Privacy notice /privacy"]
  end

  subgraph Spaces["Signed-in spaces"]
    LA["Learner app /institute/learn"]
    AD["Institute admin /institute/admin"]
    PL["Zinny panel /platform"]
  end

  subgraph Core["Shared core"]
    AU["Sign-in, sessions, roles"]
    SV["Module services<br/>courses, batches, tests, live classes, assignments,<br/>certificates, XP, finance, website, reports, privacy"]
    EV["Events and notifications"]
    JB["Scheduled jobs"]
  end

  subgraph Data["Data and outside services"]
    DB[("PostgreSQL<br/>row-level security on all 127 tables")]
    FS[("File storage<br/>signed links")]
    RZ["Razorpay<br/>UPI, cards, netbanking"]
    MS["Email, SMS, WhatsApp"]
  end

  V --> LP & MK & WS & VF & SU
  S --> LA
  S --> MK
  I --> AD
  Z --> PL
  SU -->|"student"| LA
  SU -->|"institute, 3-day trial"| AD
  LA & AD & PL --> AU --> SV
  MK & WS & VF --> SV
  SV --> DB & FS
  SV --> EV --> MS
  SV <-->|"checkout and webhook"| RZ
  JB --> SV
  class DB,FS data
  class LA,AD,PL ok
  
```

## 2. What every request passes through

Every page load, form or API call goes through the same gates, from the browser down to the database. A request stops at the first gate it fails.

```mermaid
%%{init: {"theme": "base", "flowchart": {"useMaxWidth": false, "curve": "basis", "padding": 14}, "themeVariables": {"primaryColor": "#ffffff", "primaryBorderColor": "#7d8f89", "primaryTextColor": "#17221f", "lineColor": "#7d8f89", "clusterBkg": "#f1f5f3", "clusterBorder": "#c9d5d1", "edgeLabelBackground": "#ffffff", "titleColor": "#1f5d4c"}}}%%
flowchart TD
  classDef ok fill:#e6f0ec,stroke:#1f5d4c,color:#17221f
  classDef stop fill:#f8e9e5,stroke:#8a3b2e,color:#17221f
  classDef data fill:#eef2f1,stroke:#5b6b66,color:#17221f

  A["Browser sends a request"] --> B{"Production secrets set?<br/>AUTH_SECRET, CRON_SECRET, KYC key"}
  B -- no --> B1["Maintenance page 503"]:::stop
  B -- yes --> C["Security headers added<br/>CSP with a fresh nonce, HSTS, no framing, nosniff"]
  C --> D{"Changes data and comes<br/>from another site?"}
  D -- yes --> D1["Refused 403"]:::stop
  D -- no --> E{"What kind of request?"}
  E -- "public page" --> P["Landing, marketplace, institute site,<br/>verify, sign-up"]
  P --> PR{"Form over its rate limit?<br/>sign-up, enquiry, search, joining code"}
  PR -- yes --> PR1["Try again later"]:::stop
  PR -- no --> SVC["Service function<br/>see the next chart"]:::ok
  E -- "signed-in page or form" --> SIGNED["Signed-in checks<br/>see the next chart"]:::ok
  E -- "API route" --> API{"Which route?"}
  API -- "/api/jobs/run" --> J{"CRON_SECRET matches?"}
  J -- no --> J1["401"]:::stop
  J -- yes --> JOB["Jobs run per institute,<br/>as that institute"]:::ok
  API -- "/api/payments/razorpay" --> W{"Signature valid?"}
  W -- no --> W1["Rejected"]:::stop
  W -- yes --> WOK["Payment confirmed once,<br/>even if Razorpay retries"]:::ok
  API -- "/api/storage/file" --> F{"Signed link valid<br/>and not expired?"}
  F -- no --> F1["403"]:::stop
  F -- yes --> F2["File sent; HTML and SVG<br/>only as downloads"]:::ok
  
```

### Signed-in pages and forms

```mermaid
%%{init: {"theme": "base", "flowchart": {"useMaxWidth": false, "curve": "basis", "padding": 14}, "themeVariables": {"primaryColor": "#ffffff", "primaryBorderColor": "#7d8f89", "primaryTextColor": "#17221f", "lineColor": "#7d8f89", "clusterBkg": "#f1f5f3", "clusterBorder": "#c9d5d1", "edgeLabelBackground": "#ffffff", "titleColor": "#1f5d4c"}}}%%
flowchart TD
  classDef ok fill:#e6f0ec,stroke:#1f5d4c,color:#17221f
  classDef stop fill:#f8e9e5,stroke:#8a3b2e,color:#17221f
  classDef data fill:#eef2f1,stroke:#5b6b66,color:#17221f

  S{"Valid session cookie?"} -- no --> S1["Sent to /login"]:::stop
  S -- yes --> AC["Load the person's roles<br/>in this institute only"]
  AC --> PH{"Signed in by phone code<br/>at another institute?"}
  PH -- yes --> PH1["No roles here:<br/>treated as signed out"]:::stop
  PH -- no --> ST{"Institute status"}
  ST -- suspended --> ST1["Suspended page<br/>Zinny support can still enter"]:::stop
  ST -- frozen --> FZ{"Can choose a plan?"}
  FZ -- yes --> FZ1["Choose a plan and<br/>Documents only"]
  FZ -- no --> FZ2["Paused page,<br/>work is kept"]:::stop
  ST -- active --> VA{"Zinny team viewing as a<br/>student and changing something?"}
  VA -- yes --> VA1["Refused: view only"]:::stop
  VA -- no --> SVC["Service function"]
  SVC --> PERM{"Permission check<br/>assertCan or reach"}
  PERM -- denied --> PERM1["Forbidden"]:::stop
  PERM -- allowed --> TEN["withTenant: the institute is set<br/>for this transaction"]
  TEN --> DBQ[("Restricted app role:<br/>row-level security filters every row")]:::data
  DBQ --> WR{"Wrote anything?"}
  WR -- yes --> AUD["Audit log: who, what,<br/>before and after"]
  AUD --> EVT["Domain event, notifications"] --> R["Response"]:::ok
  WR -- no --> R
  
```

## 3. Institute lifecycle: from sign-up to renewal

An institute can join on its own, try Zinny for 3 days and pay to continue. The Zinny team can also create an institute directly, which skips the trial.

```mermaid
%%{init: {"theme": "base", "flowchart": {"useMaxWidth": false, "curve": "basis", "padding": 14}, "themeVariables": {"primaryColor": "#ffffff", "primaryBorderColor": "#7d8f89", "primaryTextColor": "#17221f", "lineColor": "#7d8f89", "clusterBkg": "#f1f5f3", "clusterBorder": "#c9d5d1", "edgeLabelBackground": "#ffffff", "titleColor": "#1f5d4c"}}}%%
flowchart TD
  classDef ok fill:#e6f0ec,stroke:#1f5d4c,color:#17221f
  classDef warn fill:#fbf3dc,stroke:#b8860b,color:#17221f
  classDef stop fill:#f8e9e5,stroke:#8a3b2e,color:#17221f

  A["Book a demo or Sign up as institute"] --> A1{"Prefer a call?"}
  A1 -- yes --> A2["Request a call form<br/>emailed to every Super Admin"]
  A1 -- no --> S1["Step 1: institute details<br/>name, legal name, type, city, state, address, web address"]
  S1 --> S1a{"Web address free<br/>and not reserved?"}
  S1a -- no --> S1
  S1a -- yes --> S2["Step 2: admin account<br/>contact, email, mobile, strong password"]
  S2 --> S2a{"Email already on Zinny?"}
  S2a -- yes --> S2
  S2a -- no --> S3{"Step 3: does GST apply<br/>when you sell a course?"}
  S3 -- yes --> S3a["GSTIN must match the state"]
  S3 -- no --> S3b["No GSTIN; invoices without tax"]
  S3a & S3b --> S4["Step 4: documents<br/>PAN required; GST certificate, deed, MOA, AOA, licence optional<br/>PDF, JPG or PNG up to 10 MB"]
  S4 --> S5["Consents: account and service required, news optional"]
  S5 --> S6{"Under 5 sign-ups an hour<br/>from this network?"}
  S6 -- no --> S6a["Try again later"]:::stop
  S6 -- yes --> C["Institute, admin and trial created<br/>trial ends on sign-up day + 3"]
  C --> C1["Admin signed in, lands on Documents"]
  C1 --> R["Zinny team reviews each document<br/>approve, or reject with a note"]

  C1 --> T["Trial days 1 to 3<br/>every module works, gold countdown banner"]:::warn
  T --> TJ{"Daily job, 00:15 India time<br/>trial ended and no licence?"}
  TJ -- no --> T
  TJ -- yes --> FR["Frozen<br/>admins: Choose a plan and Documents<br/>everyone else: paused page<br/>nothing deleted"]:::stop
  FR --> EXT{"Zinny extends the trial?<br/>1 to 60 days"}
  EXT -- yes --> T
  FR --> CP["Choose a plan<br/>price, GST and total shown"]
  T --> CP
  CP --> PAN{"Usable PAN on file?"}
  PAN -- no --> C1
  PAN -- yes --> PAY{"Payment gateway"}
  PAY -- "test mode" --> PD["Paid"]
  PAY -- "live keys" --> PL["Contact Zinny, pay by bank transfer"]:::warn
  PL --> PD
  PD --> LIC["Licence created from today<br/>Zinny GST invoice marked paid<br/>status active"]:::ok

  LIC --> USE["Licence active: caps, modules, term"]:::ok
  USE --> CAP{"Students or staff at 90% of a cap?"}
  CAP -- yes --> CAPW["Warning to the Zinny team<br/>caps warn, they don't block"]:::warn
  CAPW --> SP["Admin buys seat packs<br/>25 students or 5 staff, priced for days left"]
  SP --> USE
  USE --> ENDQ{"Days to licence end"}
  ENDQ -- "30, 14, 7, 1" --> REM["Email and notification to admins<br/>gold banner in their panel"]:::warn
  REM --> AR{"Auto-renew on?"}
  AR -- yes --> AP{"Plan still offered?"}
  AP -- yes --> RN["Renewed 15 days before the end<br/>at the plan's price that day, invoiced"]:::ok
  AP -- no --> BL["Renewal blocked warning<br/>team picks a plan"]:::warn
  AR -- no --> MAN["Team uses Renew now, or the licence ends"]
  RN --> USE
  MAN --> USE
  USE --> SUS{"Team suspends with a reason?"}
  SUS -- yes --> SS["Suspended: people kept out, work kept"]:::stop
  SS --> REA["Reactivate"] --> USE
  
```

## 4. Student journey

From creating an account to a verifiable certificate. Each step checks the student's own roles in their institute.

```mermaid
%%{init: {"theme": "base", "flowchart": {"useMaxWidth": false, "curve": "basis", "padding": 14}, "themeVariables": {"primaryColor": "#ffffff", "primaryBorderColor": "#7d8f89", "primaryTextColor": "#17221f", "lineColor": "#7d8f89", "clusterBkg": "#f1f5f3", "clusterBorder": "#c9d5d1", "edgeLabelBackground": "#ffffff", "titleColor": "#1f5d4c"}}}%%
flowchart TD
  classDef ok fill:#e6f0ec,stroke:#1f5d4c,color:#17221f
  classDef warn fill:#fbf3dc,stroke:#b8860b,color:#17221f
  classDef stop fill:#f8e9e5,stroke:#8a3b2e,color:#17221f

  A["Sign up as student<br/>name, email, password, optional mobile"] --> B{"Joining code entered?"}
  B -- yes --> B1{"Code valid?<br/>10 wrong tries an hour, then a pause"}
  B1 -- no --> B
  B1 -- yes --> B2{"Institute's joining mode"}
  B2 -- instant --> B3["Student role given"]
  B2 -- approval --> B4["Request waits<br/>admin or HOD accepts and picks departments"]
  B4 --> B3
  B -- no --> B5["Marketplace account only"]
  B3 & B5 --> AGE{"18 or older?"}
  AGE -- no --> G["Guardian gets a link, valid 7 days"]
  G --> G1{"Guardian confirms?"}
  G1 -- no --> G2["News, analytics and XP stay off<br/>gold card on the home page"]:::warn
  G1 -- yes --> CON["Guardian consent recorded"]
  AGE -- yes --> CON
  G2 --> HOME
  CON --> HOME["Learner home: today, timetable, courses"]
  HOME --> KYC{"Complete KYC? optional"}
  KYC -- yes --> KY["PAN encrypted, last 4 of Aadhaar only<br/>full Aadhaar refused"]:::ok
  HOME --> CAT["Courses of my departments"]
  CAT --> BAT["Pick a batch: days, times, faculty, seats left"]
  BAT --> FULL{"Full or closed?"}
  FULL -- yes --> CAT
  FULL -- no --> CL{"Clashes with another batch?"}
  CL -- yes --> CL1{"Enrol anyway?"}
  CL1 -- no --> CAT
  CL1 -- yes --> APR
  CL -- no --> APR{"Batch needs approval?"}
  APR -- yes --> AR["Request to faculty, HOD, admin"] --> AR1{"Accepted and a seat is free?"}
  AR1 -- no --> CAT
  AR1 -- yes --> EN
  APR -- no --> EN["Enrolled; classes join the timetable"]:::ok
  EN --> SW{"Want another batch<br/>of the same course?"}
  SW -- yes --> SW1["Switch request to the HOD<br/>moves only if a seat is free"] --> EN

  EN --> L["Lessons: video, PDF, text, links<br/>released by drip rules"]
  L --> PR["Progress = required lessons done"]
  EN --> T["Tests: full screen, server timer<br/>tab-switch limit, autosave"]
  T --> TM{"Objective questions?"}
  TM -- yes --> TA["Marked automatically"]
  TM -- no --> TG["Short answers to the grading queue"]
  EN --> LC["Live class: join from 15 minutes before<br/>late after 10, register locked after"]
  EN --> AS["Assignments: hand in until the due date<br/>late refused or penalised"]
  TA & TG & LC & AS & L --> XP{"XP rules match and<br/>tracking allowed?"}
  XP -- yes --> XP1["XP, badges, leaderboard"]
  PR --> DONE{"100% of required lessons?"}
  DONE -- yes --> CERT["Course complete<br/>certificate issued with a QR code"]:::ok
  CERT --> VER["Anyone can check it at /verify"]:::ok
  
```

## 5. Marketplace purchase and money

One cart can hold courses from several institutes. Each institute is paid through its own order and issues its own invoice.

```mermaid
%%{init: {"theme": "base", "flowchart": {"useMaxWidth": false, "curve": "basis", "padding": 14}, "themeVariables": {"primaryColor": "#ffffff", "primaryBorderColor": "#7d8f89", "primaryTextColor": "#17221f", "lineColor": "#7d8f89", "clusterBkg": "#f1f5f3", "clusterBorder": "#c9d5d1", "edgeLabelBackground": "#ffffff", "titleColor": "#1f5d4c"}}}%%
flowchart TD
  classDef ok fill:#e6f0ec,stroke:#1f5d4c,color:#17221f
  classDef warn fill:#fbf3dc,stroke:#b8860b,color:#17221f
  classDef stop fill:#f8e9e5,stroke:#8a3b2e,color:#17221f

  A["Browse recorded courses or live seats"] --> B["Add to cart or Buy now"]
  B --> C{"Already own it?"}
  C -- yes --> C1["Dropped from the cart"]
  C -- no --> D["Optional discount code<br/>never below ₹1"]
  D --> E["Checkout: one held order per item"]
  E --> F{"Live seat?"}
  F -- yes --> F1{"Seat free? clash noted"}
  F1 -- no --> F2["Batch full"]:::stop
  F1 -- yes --> F3["Seat held for 10 minutes"]
  F -- no --> G
  F3 --> G{"Selling institute charges GST?"}
  G -- yes --> G1["Course GST rate added<br/>CGST and SGST, or IGST"]
  G -- no --> G2["No GST added"]
  G1 & G2 --> P["Pay with Razorpay: UPI, card, netbanking"]
  P --> Q{"How is payment confirmed?"}
  Q -- "callback" --> OK
  Q -- "signed webhook" --> OK
  Q -- "both missed" --> RC["Hourly reconcile job checks Razorpay"]:::warn --> OK
  P --> X{"Failed or abandoned?"}
  X -- yes --> X1["Hold released, seat freed"]:::stop
  OK["Payment confirmed"] --> DUP{"Already owned?"}
  DUP -- yes --> RD["Marked refund due"]:::warn
  DUP -- no --> ENR["Enrolled: recorded library or live batch<br/>buyer joins as individual learner"]:::ok
  ENR --> INV["Invoice in the institute's name<br/>GST invoice with GSTIN, or plain invoice"]:::ok
  INV --> SEL["Seller sees the sale in Finance, Sales<br/>and earnings on Listings"]
  SEL --> RF{"Refund asked?"}
  RF -- yes --> RF1["Staff enter amount and reason<br/>never more than was paid"]
  RF1 --> RF2["Razorpay refund, student told"]
  RF2 --> RF3{"Full refund?"}
  RF3 -- yes --> RF4["Seat ends"]:::stop

  subgraph Offline["Fees paid at the institute"]
    O1["Record a fee: student, course, amount, mode"] --> O2["Paid, numbered invoice issued"]
    O3["Unpaid invoice past due"] --> O4["Send reminders: at most once a day each"]
  end
  
```

## 6. How the Zinny team works

The team runs the platform from /platform and never acts inside an institute without a logged reason.

```mermaid
%%{init: {"theme": "base", "flowchart": {"useMaxWidth": false, "curve": "basis", "padding": 14}, "themeVariables": {"primaryColor": "#ffffff", "primaryBorderColor": "#7d8f89", "primaryTextColor": "#17221f", "lineColor": "#7d8f89", "clusterBkg": "#f1f5f3", "clusterBorder": "#c9d5d1", "edgeLabelBackground": "#ffffff", "titleColor": "#1f5d4c"}}}%%
flowchart LR
  classDef ok fill:#e6f0ec,stroke:#1f5d4c,color:#17221f
  classDef warn fill:#fbf3dc,stroke:#b8860b,color:#17221f
  classDef stop fill:#f8e9e5,stroke:#8a3b2e,color:#17221f

  IN["Team member signs in"] --> NAV["Sidebar shows only what their role opens<br/>search with / or Ctrl K"]
  NAV --> OV["Overview: date filter, warnings,<br/>licences ending, overdue invoices"]
  NAV --> INS["Institutes: search, filter, detail"]
  NAV --> SUP["Support"]
  NAV --> CR["Content review"]
  NAV --> BILL["Plans, licences, invoices"]

  INS --> SG["Sign-ups: approve or reject documents<br/>extend a trial 1 to 60 days"]
  INS --> SUS["Suspend or reactivate, reason required"]

  SUP --> SM{"Which help?"}
  SM -- "support mode" --> SM1["Reason, 120 minutes as Institute Admin<br/>can't grant themselves a role"]
  SM -- "sign in as (Super Admin)" --> SM2["Act as the person, 2 hours at most<br/>can't change their phone, password or devices"]
  SM -- "view as (Super Admin)" --> SM3["Student's screens, read only"]
  SM1 & SM2 & SM3 --> LOG["Every action in the institute's activity log<br/>with the real staff member named"]:::ok

  CR --> CR1{"Course looks right?"}
  CR1 -- yes --> CR2["Mark reviewed"]:::ok
  CR1 -- no --> CR3["Flag with a category and note"]:::warn --> CR4["Institute fixes it, QA resolves"]

  BILL --> B1["New licence or term raises an invoice"]
  BILL --> B2["Mark paid with a UTR, or revise with history"]
  BILL --> B3["Seat packs: add, remove, set caps<br/>needs Edit seat packs and user caps"]
  
```

## 7. Privacy requests, erasure and breaches

Built for India's DPDP Act 2023 and Rules 2025. The institute answers for its learners; Zinny answers for marketplace learners and the people who sign institutes up.

```mermaid
%%{init: {"theme": "base", "flowchart": {"useMaxWidth": false, "curve": "basis", "padding": 14}, "themeVariables": {"primaryColor": "#ffffff", "primaryBorderColor": "#7d8f89", "primaryTextColor": "#17221f", "lineColor": "#7d8f89", "clusterBkg": "#f1f5f3", "clusterBorder": "#c9d5d1", "edgeLabelBackground": "#ffffff", "titleColor": "#1f5d4c"}}}%%
flowchart TD
  classDef ok fill:#e6f0ec,stroke:#1f5d4c,color:#17221f
  classDef warn fill:#fbf3dc,stroke:#b8860b,color:#17221f
  classDef stop fill:#f8e9e5,stroke:#8a3b2e,color:#17221f

  P["Person opens Your privacy"] --> K{"What do they want?"}
  K -- "my data" --> D1["JSON download at once<br/>PAN masked, logged as completed"]:::ok
  K -- "withdraw news or analytics" --> D2["One tap, recorded with the notice version"]:::ok
  K -- "correction or nominee" --> D3["Request due in 15 days"]
  K -- "erasure or complaint" --> D4["Request due in 30 days"]
  D3 & D4 --> WHO{"Whose records?"}
  WHO -- "an institute's" --> IA["Institute admin, Settings, Privacy"]
  WHO -- "Zinny's own" --> ZT["Zinny team, Privacy requests"]
  IA & ZT --> DEC{"Decision"}
  DEC -- refuse --> RF["Reason of at least 10 characters<br/>person may complain to the Board"]:::stop
  DEC -- complete --> ER{"Erasure?"}
  ER -- no --> DONE["Done, person told"]:::ok
  ER -- yes --> OTH{"Same sign-in used by<br/>another institute?"}
  OTH -- no --> AN["Name, email, phone, password anonymised"]
  OTH -- yes --> KEEP["Sign-in kept for the other institute"]
  AN & KEEP --> E2["KYC deleted, consents withdrawn,<br/>roles here ended, signed out everywhere"]
  E2 --> E3["GST invoices kept about 8 years<br/>consent and request log kept"]:::ok

  subgraph Retention["Retention, daily"]
    R1{"Inactive longer than the period?<br/>default 3 years"} -- yes --> R2["Flag and tell the learner"]
    R2 --> R3{"Signed in within 48 hours?"}
    R3 -- yes --> R4["Flag cleared"]:::ok
    R3 -- no --> R5{"Institute setting"}
    R5 -- flag --> R6["Admin keeps or anonymises"]
    R5 -- anonymise --> E2
  end

  subgraph Breach["Breach register"]
    BR1["Incident logged: when Zinny became aware"] --> BR2["Two 72-hour clocks start"]:::warn
    BR2 --> BR3["Report to the Data Protection Board"]
    BR2 --> BR4["Notice to every affected person"]
    BR3 & BR4 --> BR5["Contained, then closed"]:::ok
  end
  
```

## 8. Background jobs

Jobs run once per institute, as that institute, behind the cron secret. On Vercel's current plan only the daily run is scheduled; the hourly and every-minute runs need a scheduler.

```mermaid
%%{init: {"theme": "base", "flowchart": {"useMaxWidth": false, "curve": "basis", "padding": 14}, "themeVariables": {"primaryColor": "#ffffff", "primaryBorderColor": "#7d8f89", "primaryTextColor": "#17221f", "lineColor": "#7d8f89", "clusterBkg": "#f1f5f3", "clusterBorder": "#c9d5d1", "edgeLabelBackground": "#ffffff", "titleColor": "#1f5d4c"}}}%%
flowchart LR
  classDef ok fill:#e6f0ec,stroke:#1f5d4c,color:#17221f
  classDef warn fill:#fbf3dc,stroke:#b8860b,color:#17221f

  CRON["Vercel cron<br/>daily 00:15 India time"]:::ok --> DAY["/api/jobs/run?every=day"]
  SCH["Scheduler not set up yet"]:::warn --> HR["every=hour"]
  SCH --> MIN["every=minute"]

  DAY --> D1["Billing: renew licences due,<br/>payment reminders, licence-end emails"]
  DAY --> D2["Freeze trials that ended without a plan"]
  DAY --> D3["Privacy retention: flag or anonymise"]
  DAY --> D4["Housekeeping: expired holds, old sessions,<br/>visiting faculty ending in 14 days"]
  DAY --> D5["Certificates expiry and renewal reminders"]
  DAY --> D6["Assignment due-tomorrow reminders"]
  DAY --> D7["Weekly attendance alerts below 75%"]

  HR --> H1["Licence cap and end warnings"]
  HR --> H2["Payment reconcile with Razorpay"]
  HR --> H3["Polls opening, live sessions closing,<br/>challenges closing, courses completing"]

  MIN --> M1["Deliver email, SMS, WhatsApp<br/>quiet hours 9 pm to 8 am, retries"]
  MIN --> M2["Submit timed tests whose time ran out"]
  
```
