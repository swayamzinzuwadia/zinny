/**
 * The sum behind every Zinny invoice: list price, less discount, plus GST. Pure, so the
 * forms can show the charge as you type and the services use the very same numbers.
 * Money is integer paise.
 */

export function gstFor(basePaise: number, rateBp: number) {
  return Math.round((basePaise * rateBp) / 10_000);
}

/** Same state as Zinny → CGST + SGST, half each. Another state → IGST. */
export function splitGst(gstPaise: number, intraState: boolean) {
  if (!intraState) return { cgstPaise: 0, sgstPaise: 0, igstPaise: gstPaise };
  const cgstPaise = Math.floor(gstPaise / 2);
  return { cgstPaise, sgstPaise: gstPaise - cgstPaise, igstPaise: 0 };
}

export type Charge = {
  listPricePaise: number;
  discountPaise: number;
  /** Taxable amount: list price minus discount. */
  basePaise: number;
  gstPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
};

/** What a list price and a discount come to with GST. The one place the sum is done. */
export function chargeFor(listPricePaise: number, discountPaise: number, gstRateBp: number, intraState: boolean): Charge {
  const basePaise = listPricePaise - discountPaise;
  const gstPaise = gstFor(basePaise, gstRateBp);
  return { listPricePaise, discountPaise, basePaise, gstPaise, ...splitGst(gstPaise, intraState), totalPaise: basePaise + gstPaise };
}
