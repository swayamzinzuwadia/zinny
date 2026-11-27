# Zinny and India's Digital Personal Data Protection law

A checklist for Zinny's clients and for Zinny itself. It maps each obligation in the **Digital Personal Data Protection Act, 2023** ("the Act") and the **DPDP Rules, 2025** ("the Rules", notified 13–14 November 2025) to where Zinny handles it, and lists what still needs legal or process work.

This is a product document, not legal advice. Section and rule numbers are as we read the notified texts; please have counsel confirm them against the Gazette before relying on them.

## Who is who

| Situation | Data Fiduciary (decides) | Data Processor (acts for it) |
| --- | --- | --- |
| A student, parent or staff member of an institute | The institute | Zinny |
| A marketplace learner (signed up without an institute) | Zinny | Payment, hosting, email and SMS providers |
| The person who signs an institute up | Zinny | Same |

In the app, records with an institute (`university_id` set) belong to that institute; records without one are Zinny's own.

## When the Rules apply

- Rules 1, 2 and 17–21 (the Board): from notification, November 2025.
- Rule 4 (consent managers): one year after notification, around **November 2026**.
- Everything else, including notice, consent, security, breaches, retention, children and rights (Rules 3, 5–16, 22, 23): 18 months after notification, around **May 2027**.

## Checklist

Legend: **Done** = built and tested in Zinny. **Partly** = built, with a gap noted. **Process** = needs a person, a contract or a policy, not code.

### Notice and consent

| Obligation | Where | Status |
| --- | --- | --- |
| Notice before or with the consent request, itemised: what data, which purpose (Act s.5(1); Rule 3(a), (b)) | `/privacy`, each item with its purpose and how long it is kept (`src/modules/privacy/lib/notice.ts`) | Done |
| Notice says how to withdraw consent, use rights and complain to the Board (Rule 3(c)) | `/privacy#withdraw`, `#rights`, `#grievance` | Done |
| Notice stands on its own and is in clear, plain language (Rule 3) | `/privacy` | Done |
| Notice available in English or any Eighth Schedule language (Act s.5(3)) | English and Hindi (`/privacy?lang=hi`, essentials); others on request to the grievance officer | Partly: full Hindi text and other languages need translation |
| Notice versioned, so we know which version someone agreed to | `NOTICE_VERSION` stored on every consent | Done |
| Consent free, specific, informed, unambiguous, with a clear affirmative action, per purpose (s.6(1)) | Separate tick boxes at institute sign-up, student sign-up and KYC; news unticked by default; each purpose a row in `dpdp_consents` with time, source, notice version and a salted IP hash | Done |
| Withdrawing as easy as giving (s.6(4)) | One-tap "Withdraw" on `/[uni]/profile/privacy` and `/privacy/my` | Done |
| After withdrawal, stop processing within a reasonable time, and have processors stop (s.6(6)) | Consent checked from the record; news must only go to learners with "News and offers" on | Partly: other modules' emails don't yet check the consent (see handoff requests) |
| Prove consent was given (s.6(10)) | `dpdp_consents` + the audit log | Done |
| Legitimate uses without consent (s.7), e.g. what a student gives an institute for their course | Account and service consents are recorded anyway; they can only end through erasure | Done |
| Consent managers (s.6(7)–(9); Rule 4, First Schedule) | Not integrated | Process: decide whether to accept consent-manager-routed requests; no registered managers to integrate with yet |
| Cookies and tracking | Banner on public pages; essential cookies only by default; analytics switch; choice remembered 180 days; reopen from `/privacy#cookies` | Done (Zinny has no analytics script today; the switch is ready for one) |

### Fiduciary duties

| Obligation | Where | Status |
| --- | --- | --- |
| Use a processor only under a valid contract (s.8(2)) | Institute settings → Privacy → Data processing explains Zinny's role | Process: a data processing agreement must be part of every institute contract; sub-processor contracts with hosting, Razorpay, email and SMS providers |
| Accuracy where data is used for decisions or shared (s.8(3)) | Profile edits; correction requests | Done |
| Reasonable security safeguards (s.8(5); Rule 6) | Row-level security per institute; PAN encrypted (AES-256-GCM) and shown masked; only the last 4 Aadhaar digits; passwords hashed; every write audited; support mode time-boxed and logged | Partly: formal security policy, access reviews, encryption at rest on the database host, backups, and a written incident runbook are process |
| Keep personal data, traffic data and processing logs for at least one year (Rule 8(3); Rule 6 also requires logs for detecting misuse) | Consents and requests are never deleted (erasure keeps them); audit log is append-only | Partly: no automatic purge exists, so nothing is deleted early; a purge after the retention period needs a decision |
| Breach: tell the Board and every affected person (s.8(6); Rule 7) | `/platform/privacy/breaches`: log an incident, first intimation, the detailed report within 72 hours, notice to people, with live countdowns | Done for tracking. Process: the actual notices (Board's portal or form, the email or SMS to people) are written and sent by a person |
| Erase when the purpose is served or consent is withdrawn, unless law requires keeping (s.8(7)) | Erasure requests; retention job | Done |
| Erase after the Third Schedule period of inactivity, telling the person 48 hours first (Rule 8(1), (2)) | Daily job `privacy.retention`: flags (or, if the institute chose, anonymises) learners inactive past the period (default 3 years, institute can choose 6 months to 10 years); tells them by notification and email; anonymises only 48 hours after flagging; signing in again clears the flag | Done. Note: the Third Schedule names e-commerce, gaming and social media platforms; education isn't listed, so 3 years is our chosen default |
| Publish the contact of a DPO or a person who answers questions (s.8(9); Rule 9) | `/privacy#grievance` (from `PRIVACY_GRIEVANCE_*` settings); institutes can set their own | Process: appoint and name the person |
| Effective grievance redressal (s.8(10); Rule 14(3): within 90 days) | Requests with due dates (grievance 30 days, correction and nomination 15, erasure 30); overdue shown in red; the institute dashboard shows open requests | Done |

### Rights of the person

| Right | Where | Status |
| --- | --- | --- |
| Access: a summary of data and processing, and who it was shared with (s.11) | "Download my data": JSON of profile, roles, enrolments, orders and invoices, KYC status (PAN masked), consents and requests; logged as an answered request | Partly: the list of processors it was shared with is in the notice, not the file |
| Correction, completion, updating (s.12(1), (2)) | Profile (name, mobile, photo); correction requests for everything else | Done |
| Erasure (s.12(3)) | Erasure requests: name, email, mobile and password removed (unless the same sign-in is still used at another institute), KYC deleted, consents withdrawn, roles ended, signed out everywhere. GST invoices and the consent log stay and the reply says why | Done |
| Grievance redressal (s.13) | Requests of kind "grievance" | Done |
| Nominate someone (s.14; Rule 14(4)) | Requests of kind "nomination" with name, relation and contact | Partly: the nominee can't yet act through the app; they contact the grievance officer |
| Complain to the Data Protection Board after using the grievance route (s.13(3)) | Said in the notice and on every privacy page | Done |
| Publish how to make requests (Rule 14(1)) | `/privacy#rights` | Done |

### Children

| Obligation | Where | Status |
| --- | --- | --- |
| Verifiable consent of a parent or guardian before processing a child's data (s.9(1); Rule 10) | Zinny had no date of birth anywhere, so student sign-up now asks for age (optional date of birth); for under 18 it takes a guardian's name and email or mobile and sends a 7-day link. The guardian reads what we process and confirms; the confirmation is stored as a "guardian" consent | Partly: the link to the guardian's own email or phone is our verification (Rule 10(1)(b)); identity-backed verification (DigiLocker or a virtual token) isn't built |
| No tracking, behavioural monitoring or targeted advertising of children (s.9(3)) | Until the guardian confirms: news and analytics can't be switched on, and `trackingAllowed(userId)` is false | Partly: gamification and leaderboards don't check `trackingAllowed` yet (handoff request) |
| Educational institutions are exempt from some of this for education itself (s.9(4); Rule 12, Fourth Schedule) | Institutes keep teaching minors; the block only covers optional purposes and tracking | Process: confirm with counsel which institute features fall inside the exemption |
| People with disabilities and their lawful guardians (s.9(1); Rule 11) | Not built | Gap |

### Significant Data Fiduciary and transfers

| Obligation | Status |
| --- | --- |
| If notified as a Significant Data Fiduciary (s.10; Rule 13): a DPO based in India, an independent data auditor, a yearly DPIA and audit, checks on algorithms | Process: not notified today. Watch volume and children's data; if notified, appoint a DPO and auditor |
| Transfers outside India (s.16; Rule 15) | Database is hosted in India (Mumbai). Process: confirm every sub-processor's data location (email, SMS, Vercel edge, logs) |
| Penalties (s.33, Schedule): up to ₹250 crore for security failures, ₹200 crore for breach-notice and children failures | Reason to close the gaps above |

## Gaps that need legal or process work

1. **Grievance officer / DPO.** Name a real person, set `PRIVACY_GRIEVANCE_NAME`, `PRIVACY_GRIEVANCE_EMAIL` (and phone, address). A DPO in India is mandatory only if Zinny is notified as a Significant Data Fiduciary.
2. **Institute contracts.** Add a data processing agreement to every institute contract: Zinny processes only on the institute's instructions, keeps data in India, uses named sub-processors, helps answer requests, tells the institute of breaches without delay, and returns or erases data at the end.
3. **Sub-processor contracts** with hosting, database, Razorpay, email and SMS providers, with security and breach terms.
4. **Breach runbook.** Who decides something is a breach, who files with the Board, the wording of notices to people. The register tracks this; it doesn't send.
5. **Consent managers.** Decide whether to accept requests through registered consent managers once they exist (Rule 4 applies from about November 2026).
6. **Translations** of the full notice into Hindi and the languages institutes ask for.
7. **Children's verification.** Decide whether the email or SMS link is enough or whether to add DigiLocker-based age and identity checks, and confirm the education exemption's reach.
8. **Log retention policy.** Write down how long consent, request, audit and sign-in logs are kept beyond the one-year minimum, and add a purge if needed.
9. **Security programme.** Written policy, access reviews, backups and restore tests, and penetration tests (Rule 6).
10. **Persons with disabilities** (Rule 11): a way for a lawful guardian to act.
