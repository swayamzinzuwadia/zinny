/** Titles that come before a name and aren't how anyone is greeted. */
const TITLES = new Set(["dr", "prof", "mr", "mrs", "ms", "miss", "shri", "sri", "smt", "kum", "kumari"]);

/** The name to greet someone by: "Dr. Meera Iyer" → "Meera", "Riya Sharma" → "Riya". */
export function firstName(name: string) {
  const words = name.trim().split(/\s+/);
  const first = words.find((w) => !TITLES.has(w.toLowerCase().replace(/\.$/, "")));
  return first ?? words[0] ?? name;
}
