import { deleteItemAction, itemVisibilityAction, moveItemAction } from "../actions";
import type { Collection } from "../content";
import { ActionButton } from "./action-button";

/** Move up, move down, show or hide, delete: the controls every list item has. */
export function ItemControls({
  uni,
  collection,
  id,
  visible,
  name,
  first,
  last,
}: {
  uni: string;
  collection: Collection;
  id: string;
  visible: boolean;
  name: string;
  first: boolean;
  last: boolean;
}) {
  const f = { uni, collection, id };
  return (
    <div className="flex flex-wrap items-start gap-1.5">
      {!first && (
        <ActionButton action={moveItemAction} fields={{ ...f, direction: "up" }} variant="ghost" label={`Move ${name} up`}>
          <Chevron up />
        </ActionButton>
      )}
      {!last && (
        <ActionButton action={moveItemAction} fields={{ ...f, direction: "down" }} variant="ghost" label={`Move ${name} down`}>
          <Chevron />
        </ActionButton>
      )}
      <ActionButton action={itemVisibilityAction} fields={{ ...f, visible: String(!visible) }}>
        {visible ? "Hide" : "Show"}
      </ActionButton>
      <ActionButton action={deleteItemAction} fields={f} variant="danger" confirm={`Delete ${name}? This can't be undone.`}>
        Delete
      </ActionButton>
    </div>
  );
}

function Chevron({ up }: { up?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className={up ? "rotate-180" : undefined}>
      <path d="M3 5.5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
