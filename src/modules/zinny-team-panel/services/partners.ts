/**
 * Partners (platform.partners): sponsors and corporate partners for the future
 * marketplace, with their contacts, status and running notes. Zinny's own records:
 * these tables hold no university data.
 */
import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import { roleAssignments, users } from "@/db/schema";
import { assertPlatform, type Actor } from "@/server/core";
import { NotFoundError, ValidationError } from "@/server/errors";
import { platPartnerContacts, platPartnerNotes, platPartners } from "../schema";
import { PARTNER_KINDS, PARTNER_STATUSES, type PartnerKind, type PartnerStatus } from "../lib/constants";
import { db, EMAIL_RE, isUuid, logAction } from "./shared";

export type PartnerInput = {
  name: string;
  kind: string;
  status: string;
  website?: string;
  industry?: string;
  city?: string;
  summary?: string;
  ownerUserId?: string;
};

function opt(v: string | undefined, max: number, label: string) {
  const s = v?.trim() || null;
  if (s && s.length > max) throw new ValidationError(`Keep the ${label} under ${max.toLocaleString("en-IN")} characters.`);
  return s;
}

async function validPartner(input: PartnerInput) {
  const name = input.name.trim();
  if (name.length < 2) throw new ValidationError("Enter the partner's name.");
  if (name.length > 160) throw new ValidationError("Keep the name under 160 characters.");
  if (!(PARTNER_KINDS as readonly string[]).includes(input.kind)) throw new ValidationError("Pick sponsor or corporate partner.");
  if (!(PARTNER_STATUSES as readonly string[]).includes(input.status)) throw new ValidationError("Pick a status.");
  let website = opt(input.website, 300, "website");
  if (website) {
    if (!/^https?:\/\//i.test(website)) website = `https://${website}`;
    try {
      const u = new URL(website);
      if (!u.hostname.includes(".")) throw new Error();
    } catch {
      throw new ValidationError("Enter the website as an address, like brightpath.in.");
    }
  }
  let ownerUserId: string | null = input.ownerUserId?.trim() || null;
  if (ownerUserId) {
    if (!isUuid(ownerUserId)) throw new ValidationError("Pick the owner from the Zinny team.");
    const [member] = await db()
      .select({ id: roleAssignments.userId })
      .from(roleAssignments)
      .where(and(eq(roleAssignments.userId, ownerUserId), eq(roleAssignments.scopeType, "platform"), sql`${roleAssignments.revokedAt} is null`))
      .limit(1);
    if (!member) throw new ValidationError("The owner must be on the Zinny team.");
  } else ownerUserId = null;
  return {
    name,
    kind: input.kind as PartnerKind,
    status: input.status as PartnerStatus,
    website,
    industry: opt(input.industry, 120, "industry"),
    city: opt(input.city, 120, "city"),
    summary: opt(input.summary, 2000, "summary"),
    ownerUserId,
  };
}

export async function listPartners(actor: Actor, filters: { kind?: string; status?: string; q?: string } = {}) {
  assertPlatform(actor, "platform.partners");
  const kind = (PARTNER_KINDS as readonly string[]).includes(filters.kind ?? "") ? (filters.kind as PartnerKind) : undefined;
  const status = (PARTNER_STATUSES as readonly string[]).includes(filters.status ?? "") ? (filters.status as PartnerStatus) : undefined;
  const q = filters.q?.trim().slice(0, 80);
  const like = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const rows = await db()
    .select({
      partner: platPartners,
      ownerName: users.name,
      primaryName: sql<string | null>`(select c.name from ${platPartnerContacts} c where c.partner_id = ${platPartners.id} order by c.is_primary desc, c.created_at asc limit 1)`,
      primaryEmail: sql<string | null>`(select c.email from ${platPartnerContacts} c where c.partner_id = ${platPartners.id} order by c.is_primary desc, c.created_at asc limit 1)`,
      lastNoteAt: sql<Date | null>`(select max(n.created_at) from ${platPartnerNotes} n where n.partner_id = ${platPartners.id})`.mapWith((v) => (v ? new Date(v) : null)),
    })
    .from(platPartners)
    .leftJoin(users, eq(users.id, platPartners.ownerUserId))
    .where(
      and(
        kind ? eq(platPartners.kind, kind) : undefined,
        status ? eq(platPartners.status, status) : undefined,
        like ? or(ilike(platPartners.name, like), ilike(platPartners.industry, like), ilike(platPartners.city, like)) : undefined,
      ),
    )
    .orderBy(asc(platPartners.name));
  const counts = await db()
    .select({ status: platPartners.status, n: sql<number>`count(*)`.mapWith(Number) })
    .from(platPartners)
    .groupBy(platPartners.status);
  return {
    partners: rows.map((r) => ({ ...r.partner, ownerName: r.ownerName, primaryName: r.primaryName, primaryEmail: r.primaryEmail, lastNoteAt: r.lastNoteAt })),
    byStatus: Object.fromEntries(counts.map((c) => [c.status, c.n])) as Partial<Record<PartnerStatus, number>>,
  };
}

export async function createPartner(actor: Actor, input: PartnerInput) {
  assertPlatform(actor, "platform.partners");
  const values = await validPartner({ ...input, ownerUserId: input.ownerUserId || actor.userId });
  return db().transaction(async (tx) => {
    const [p] = await tx
      .insert(platPartners)
      .values({ ...values, createdBy: actor.userId || null })
      .returning();
    await logAction(tx, actor, {}, "plat.partner.create", "plat_partner", p.id, { name: p.name, kind: p.kind, status: p.status });
    return p;
  });
}

export async function updatePartner(actor: Actor, partnerId: string, input: PartnerInput) {
  assertPlatform(actor, "platform.partners");
  if (!isUuid(partnerId)) throw new NotFoundError("Partner");
  const values = await validPartner(input);
  return db().transaction(async (tx) => {
    const [before] = await tx.select().from(platPartners).where(eq(platPartners.id, partnerId)).for("update");
    if (!before) throw new NotFoundError("Partner");
    const [p] = await tx
      .update(platPartners)
      .set({ ...values, updatedAt: new Date() })
      .where(eq(platPartners.id, partnerId))
      .returning();
    const changed = Object.fromEntries(
      (Object.keys(values) as (keyof typeof values)[]).filter((k) => before[k] !== values[k]).map((k) => [k, { from: before[k], to: values[k] }]),
    );
    await logAction(tx, actor, {}, "plat.partner.update", "plat_partner", p.id, { name: p.name, changed });
    return p;
  });
}

/** A partner with its contacts and notes, newest note first. */
export async function getPartner(actor: Actor, partnerId: string) {
  assertPlatform(actor, "platform.partners");
  if (!isUuid(partnerId)) throw new NotFoundError("Partner");
  const conn = db();
  const [row] = await conn
    .select({ partner: platPartners, ownerName: users.name })
    .from(platPartners)
    .leftJoin(users, eq(users.id, platPartners.ownerUserId))
    .where(eq(platPartners.id, partnerId));
  if (!row) throw new NotFoundError("Partner");
  const [contacts, notes] = await Promise.all([
    conn
      .select()
      .from(platPartnerContacts)
      .where(eq(platPartnerContacts.partnerId, partnerId))
      .orderBy(desc(platPartnerContacts.isPrimary), asc(platPartnerContacts.createdAt)),
    conn
      .select({ note: platPartnerNotes, authorName: users.name })
      .from(platPartnerNotes)
      .leftJoin(users, eq(users.id, platPartnerNotes.authorUserId))
      .where(eq(platPartnerNotes.partnerId, partnerId))
      .orderBy(desc(platPartnerNotes.createdAt)),
  ]);
  return { partner: row.partner, ownerName: row.ownerName, contacts, notes: notes.map((n) => ({ ...n.note, authorName: n.authorName })) };
}

export type ContactInput = { name: string; title?: string; email?: string; phone?: string; isPrimary?: boolean };

export async function addContact(actor: Actor, partnerId: string, input: ContactInput) {
  assertPlatform(actor, "platform.partners");
  if (!isUuid(partnerId)) throw new NotFoundError("Partner");
  const name = input.name.trim();
  if (name.length < 2) throw new ValidationError("Enter the contact's name.");
  if (name.length > 120) throw new ValidationError("Keep the name under 120 characters.");
  const email = input.email?.trim().toLowerCase() || null;
  if (email && !EMAIL_RE.test(email)) throw new ValidationError("Enter a valid email, or leave it empty.");
  const phone = input.phone?.trim() || null;
  if (phone && !/^\+?[0-9][0-9\s-]{6,18}$/.test(phone)) throw new ValidationError("Enter the phone number with digits only, like +91 98200 12345.");
  if (!email && !phone) throw new ValidationError("Add an email or a phone number, so the team can reach them.");
  const title = input.title?.trim() || null;
  if (title && title.length > 120) throw new ValidationError("Keep the job title under 120 characters.");
  return db().transaction(async (tx) => {
    const [p] = await tx.select({ id: platPartners.id, name: platPartners.name }).from(platPartners).where(eq(platPartners.id, partnerId)).for("update");
    if (!p) throw new NotFoundError("Partner");
    const [{ n }] = await tx
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(platPartnerContacts)
      .where(eq(platPartnerContacts.partnerId, partnerId));
    // The first contact is the primary one; asking for primary moves it.
    const primary = n === 0 || !!input.isPrimary;
    if (primary) await tx.update(platPartnerContacts).set({ isPrimary: false }).where(eq(platPartnerContacts.partnerId, partnerId));
    const [c] = await tx.insert(platPartnerContacts).values({ partnerId, name, title, email, phone, isPrimary: primary }).returning();
    await tx.update(platPartners).set({ updatedAt: new Date() }).where(eq(platPartners.id, partnerId));
    await logAction(tx, actor, {}, "plat.partner.contact_add", "plat_partner_contact", c.id, { partnerId, partner: p.name, name });
    return c;
  });
}

export async function makePrimaryContact(actor: Actor, contactId: string) {
  assertPlatform(actor, "platform.partners");
  if (!isUuid(contactId)) throw new NotFoundError("Contact");
  return db().transaction(async (tx) => {
    const [c] = await tx.select().from(platPartnerContacts).where(eq(platPartnerContacts.id, contactId)).for("update");
    if (!c) throw new NotFoundError("Contact");
    if (c.isPrimary) return c;
    await tx.update(platPartnerContacts).set({ isPrimary: false }).where(eq(platPartnerContacts.partnerId, c.partnerId));
    const [row] = await tx.update(platPartnerContacts).set({ isPrimary: true }).where(eq(platPartnerContacts.id, contactId)).returning();
    await logAction(tx, actor, {}, "plat.partner.update", "plat_partner", c.partnerId, { primaryContact: c.name });
    return row;
  });
}

export async function removeContact(actor: Actor, contactId: string) {
  assertPlatform(actor, "platform.partners");
  if (!isUuid(contactId)) throw new NotFoundError("Contact");
  return db().transaction(async (tx) => {
    const [c] = await tx.select().from(platPartnerContacts).where(eq(platPartnerContacts.id, contactId)).for("update");
    if (!c) throw new NotFoundError("Contact");
    await tx.delete(platPartnerContacts).where(eq(platPartnerContacts.id, contactId));
    if (c.isPrimary) {
      // Promote the longest-standing remaining contact.
      const [next] = await tx
        .select({ id: platPartnerContacts.id })
        .from(platPartnerContacts)
        .where(eq(platPartnerContacts.partnerId, c.partnerId))
        .orderBy(asc(platPartnerContacts.createdAt))
        .limit(1);
      if (next) await tx.update(platPartnerContacts).set({ isPrimary: true }).where(eq(platPartnerContacts.id, next.id));
    }
    await logAction(tx, actor, {}, "plat.partner.contact_remove", "plat_partner_contact", c.id, { partnerId: c.partnerId, name: c.name, email: c.email });
  });
}

export async function addNote(actor: Actor, partnerId: string, body: string) {
  assertPlatform(actor, "platform.partners");
  if (!isUuid(partnerId)) throw new NotFoundError("Partner");
  const text = body.trim();
  if (text.length < 2) throw new ValidationError("Write the note first.");
  if (text.length > 4000) throw new ValidationError("Keep the note under 4,000 characters.");
  return db().transaction(async (tx) => {
    const [p] = await tx.select({ id: platPartners.id }).from(platPartners).where(eq(platPartners.id, partnerId));
    if (!p) throw new NotFoundError("Partner");
    const [n] = await tx.insert(platPartnerNotes).values({ partnerId, body: text, authorUserId: actor.userId || null }).returning();
    await tx.update(platPartners).set({ updatedAt: new Date() }).where(eq(platPartners.id, partnerId));
    await logAction(tx, actor, {}, "plat.partner.note", "plat_partner_note", n.id, { partnerId });
    return n;
  });
}

/** Zinny team members who can own a partner relationship. */
export async function partnerOwners(actor: Actor) {
  assertPlatform(actor, "platform.partners");
  return db()
    .selectDistinct({ id: users.id, name: users.name })
    .from(users)
    .innerJoin(roleAssignments, eq(roleAssignments.userId, users.id))
    .where(and(eq(roleAssignments.scopeType, "platform"), sql`${roleAssignments.revokedAt} is null`))
    .orderBy(asc(users.name));
}
