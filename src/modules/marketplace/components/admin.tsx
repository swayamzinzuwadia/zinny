import { Field, Input, Textarea } from "@/components/ui";
export { KIND_LABEL } from "./price";

/** Title, description, price and compare-at price: the same fields for every kind of listing. */
export function ListingFieldsInputs({
  title,
  description,
  pricePaise,
  compareAtPaise,
  titlePlaceholder,
}: {
  title?: string;
  description?: string;
  pricePaise?: number;
  compareAtPaise?: number | null;
  titlePlaceholder?: string;
}) {
  return (
    <>
      <Field label="Title on the marketplace">
        <Input name="title" required minLength={3} maxLength={120} defaultValue={title} placeholder={titlePlaceholder} />
      </Field>
      <Field label="Description" hint="What buyers will learn, and who it's for.">
        <Textarea name="description" maxLength={2000} defaultValue={description} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Price before GST (₹)" hint="GST is added at the course's rate.">
          <Input name="price" required inputMode="decimal" placeholder="1499" defaultValue={pricePaise ? String(pricePaise / 100) : undefined} />
        </Field>
        <Field label="Compare-at price (₹)" hint="Optional. The usual price, shown struck through.">
          <Input name="compareAt" inputMode="decimal" placeholder="2999" defaultValue={compareAtPaise ? String(compareAtPaise / 100) : undefined} />
        </Field>
      </div>
    </>
  );
}
