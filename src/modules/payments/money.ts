/**
 * Money helpers for payments. Pure functions: no database, no network. Money is integer paise.
 */

/** "₹1,23,456.50" in Indian digit grouping; whole rupees drop the ".00". */
export function inr(paise: number, opts: { alwaysPaise?: boolean } = {}) {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const p = abs % 100;
  const grouped = new Intl.NumberFormat("en-IN").format(rupees);
  const tail = p || opts.alwaysPaise ? `.${String(p).padStart(2, "0")}` : "";
  return `${neg ? "-" : ""}₹${grouped}${tail}`;
}

/** Plain number with two decimals and Indian grouping, for invoice tables and CSV: "1,23,456.50". */
export function amount(paise: number) {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  return `${neg ? "-" : ""}${new Intl.NumberFormat("en-IN").format(Math.floor(abs / 100))}.${String(abs % 100).padStart(2, "0")}`;
}

/** Rupees typed by a person ("1,200.50", "₹ 500") → paise. Returns null when it isn't a valid amount. */
export function parseRupees(input: string): number | null {
  const clean = input.replace(/[₹,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  const [r, p = ""] = clean.split(".");
  const paise = Number(r) * 100 + Number(p.padEnd(2, "0"));
  return Number.isSafeInteger(paise) ? paise : null;
}

const ONES = [
  "",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number) {
  if (n < 20) return ONES[n];
  return [TENS[Math.floor(n / 10)], ONES[n % 10]].filter(Boolean).join(" ");
}

function belowThousand(n: number) {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

/** Whole number in the Indian system: crore, lakh, thousand. 1234567 → "Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven". */
export function numberInWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("numberInWords needs a whole number of zero or more.");
  if (n === 0) return "Zero";
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  if (crore) parts.push(`${numberInWords(crore)} Crore`);
  let rest = n % 10_000_000;
  const lakh = Math.floor(rest / 100_000);
  if (lakh) parts.push(`${belowHundred(lakh)} Lakh`);
  rest %= 100_000;
  const thousand = Math.floor(rest / 1000);
  if (thousand) parts.push(`${belowHundred(thousand)} Thousand`);
  rest %= 1000;
  if (rest) parts.push(belowThousand(rest));
  return parts.join(" ");
}

/** The total on an invoice in words: "Indian Rupees Fourteen Thousand One Hundred Sixty and Fifty Paise Only". */
export function rupeesInWords(paise: number): string {
  if (!Number.isSafeInteger(paise) || paise < 0) throw new Error("rupeesInWords needs a whole number of paise.");
  const r = Math.floor(paise / 100);
  const p = paise % 100;
  return `Indian Rupees ${numberInWords(r)}${p ? ` and ${belowHundred(p)} Paise` : ""} Only`;
}

/** GST state codes (first two digits of a GSTIN) → state or union territory, for "place of supply". */
export const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
};

export function stateLabel(code: string) {
  const name = GST_STATES[code];
  return name ? `${name} (${code})` : code;
}
