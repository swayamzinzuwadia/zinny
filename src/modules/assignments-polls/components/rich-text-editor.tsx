"use client";

import { useEffect, useRef, useState } from "react";
import { cx, inputClass } from "@/components/ui";

type Command = { label: string; title: string; run: () => void; active?: () => boolean };

/**
 * A small rich-text editor for assignment instructions: bold, italic, a heading, lists and
 * links. The HTML goes to the server in a hidden field and is sanitised there.
 */
export function RichTextEditor({ name, defaultValue = "", placeholder, label }: { name: string; defaultValue?: string; placeholder?: string; label: string }) {
  const area = useRef<HTMLDivElement>(null);
  const hidden = useRef<HTMLInputElement>(null);
  const [empty, setEmpty] = useState(!defaultValue);
  const [, force] = useState(0);

  const sync = () => {
    const el = area.current;
    if (!el || !hidden.current) return;
    const text = el.textContent?.trim() ?? "";
    hidden.current.value = text ? el.innerHTML : "";
    setEmpty(!text && !el.querySelector("li"));
  };

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.innerHTML = defaultValue;
    sync();
    const form = el.closest("form");
    const onReset = () => {
      el.innerHTML = "";
      sync();
    };
    form?.addEventListener("reset", onReset);
    return () => form?.removeEventListener("reset", onReset);
    // defaultValue only seeds the editor once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const exec = (cmd: string, value?: string) => {
    area.current?.focus();
    document.execCommand(cmd, false, value);
    sync();
    force((n) => n + 1);
  };
  const state = (cmd: string) => {
    try {
      return typeof document !== "undefined" && document.queryCommandState(cmd);
    } catch {
      return false;
    }
  };

  const commands: Command[] = [
    { label: "B", title: "Bold", run: () => exec("bold"), active: () => state("bold") },
    { label: "I", title: "Italic", run: () => exec("italic"), active: () => state("italic") },
    { label: "H", title: "Heading", run: () => exec("formatBlock", "<h3>") },
    { label: "•", title: "Bulleted list", run: () => exec("insertUnorderedList"), active: () => state("insertUnorderedList") },
    { label: "1.", title: "Numbered list", run: () => exec("insertOrderedList"), active: () => state("insertOrderedList") },
    {
      label: "Link",
      title: "Add a link",
      run: () => {
        const url = window.prompt("Link address (https://…)");
        if (!url) return;
        if (!/^(https?:\/\/|mailto:)/i.test(url.trim())) {
          window.alert("Links must start with https:// or http://");
          return;
        }
        exec("createLink", url.trim());
      },
    },
    { label: "Clear", title: "Remove formatting", run: () => exec("removeFormat") },
  ];

  return (
    <div>
      <span className="mb-1.5 block text-[13px] font-medium" id={`${name}-label`}>
        {label}
      </span>
      <div className="rounded-xl border border-line bg-surface focus-within:border-brand focus-within:ring-4 focus-within:ring-gold-soft">
        <div className="flex flex-wrap gap-1 border-b border-line px-2 py-1.5" role="toolbar" aria-label="Formatting">
          {commands.map((c) => (
            <button
              key={c.title}
              type="button"
              title={c.title}
              aria-label={c.title}
              aria-pressed={c.active ? c.active() : undefined}
              onMouseDown={(e) => e.preventDefault()}
              onClick={c.run}
              className={cx(
                "h-7 min-w-7 rounded-lg px-2 text-[13px] text-muted hover:bg-brand-soft hover:text-brand-strong",
                c.label === "B" && "font-bold",
                c.label === "I" && "italic",
                c.active?.() && "bg-brand-soft text-brand-strong",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="relative">
          {empty && placeholder && <div className="pointer-events-none absolute left-3 top-2.5 text-[14px] text-faint">{placeholder}</div>}
          <div
            ref={area}
            role="textbox"
            aria-multiline
            aria-labelledby={`${name}-label`}
            contentEditable
            suppressContentEditableWarning
            onInput={sync}
            onBlur={sync}
            onKeyUp={() => force((n) => n + 1)}
            onMouseUp={() => force((n) => n + 1)}
            className={cx(
              inputClass,
              "h-auto min-h-40 rounded-none border-0 bg-transparent py-2.5 leading-relaxed focus:ring-0",
              "[&_a]:text-brand [&_a]:underline [&_h3]:mt-2 [&_h3]:text-[16px] [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5",
            )}
          />
        </div>
      </div>
      <input ref={hidden} type="hidden" name={name} defaultValue={defaultValue} />
    </div>
  );
}
