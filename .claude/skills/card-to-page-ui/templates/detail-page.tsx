/**
 * card-to-page-ui: the page a card grows into (a Next.js App Router page.tsx).
 * The whole content panel, not just the title, carries the card's name, so the card grows
 * into all of it and the page shrinks back into the card. Rows inside crossfade on search,
 * sort or paging (Swap), and "Open" on a row grows into the row's own page.
 */
import { BackTo, IntentLink, Morph, PageMotion, RevealWhen, Swap } from "./motion";
import { cardName, rowName } from "./motion-names";

type Row = { key: string; label: string };

export default async function DetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string; page?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const item = { id, title: "Item title" }; // load yours
  const rows: Row[] = []; // load yours

  return (
    <PageMotion>
      {/* Leave this out if the layout already has a breadcrumb back to the list. */}
      <BackTo href="/items">All items</BackTo>
      <Morph name={cardName(item.id)}>
        <section className="rounded-[22px] border bg-white">
          <header className="flex items-start justify-between gap-4 p-6">
            <h1 className="text-2xl font-semibold">{item.title}</h1>
          </header>
          <div className="p-6">
            <form>{/* bulk actions over the rows */}
              <Swap id={JSON.stringify([sp.q, sp.page])}>
                <ul className="divide-y">
                  {rows.map((r) => (
                    <li key={r.key} className="flex items-center gap-3 py-2">
                      <input type="checkbox" name="key" value={r.key} />
                      <Morph name={rowName(item.id, r.key)}>
                        <IntentLink href={`/items/${item.id}/rows/${r.key}`}>Open</IntentLink>
                      </Morph>
                      {r.label}
                    </li>
                  ))}
                </ul>
              </Swap>
              {/* Grows open under the list only while rows are ticked. */}
              <RevealWhen countIn='input[type="checkbox"][name="key"]'>
                <div className="mt-4 rounded-2xl border p-4">Delete the ticked rows…</div>
              </RevealWhen>
            </form>
          </div>
        </section>
      </Morph>
    </PageMotion>
  );
}
