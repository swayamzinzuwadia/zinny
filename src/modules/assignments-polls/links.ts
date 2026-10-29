/** URLs of this module's pages and file routes. */
export const staffBase = (uni: string) => `/${uni}/admin/products/assignments`;
export const learnBase = (uni: string) => `/${uni}/learn/assignments`;
export const pollsBase = (uni: string) => `/${uni}/learn/polls`;

export const staffAssignment = (uni: string, id: string, q: { batch?: string; student?: string } = {}) => {
  const p = new URLSearchParams(Object.entries(q).filter(([, v]) => !!v) as [string, string][]);
  return `${staffBase(uni)}/${id}${p.size ? `?${p}` : ""}`;
};
export const learnAssignment = (uni: string, id: string) => `${learnBase(uni)}/${id}`;

/** A file link that checks access and redirects to a short-lived signed URL. */
export const fileHref = (uni: string, fileId: string, area: "admin" | "learn") =>
  `${area === "admin" ? staffBase(uni) : learnBase(uni)}/files/${fileId}`;
export const uploadHref = (uni: string, area: "admin" | "learn") => `${area === "admin" ? staffBase(uni) : learnBase(uni)}/upload`;

export const courseTab = (uni: string, courseId: string, tab: "assignments" | "polls") => `/${uni}/admin/products/courses/${courseId}?tab=${tab}`;
