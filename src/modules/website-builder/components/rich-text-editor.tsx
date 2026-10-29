"use client";

import { useState, type ReactNode } from "react";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { cx, inputClass } from "@/components/ui";
import { PROSE } from "./prose";

/**
 * The blog post editor: headings, emphasis, lists, quotes, code and links. Its HTML goes into
 * a hidden input (`name`) and is sanitised again on the server when the form is saved.
 */
export function RichTextEditor({ name, initialHtml, label }: { name: string; initialHtml: string; label: string }) {
  const [html, setHtml] = useState(initialHtml);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: {
          openOnClick: false,
          autolink: true,
          defaultProtocol: "https",
          protocols: ["http", "https", "mailto", "tel"],
          HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
        },
      }),
    ],
    content: initialHtml,
    editorProps: {
      attributes: {
        class: cx(PROSE, "[&_a]:text-brand [&_blockquote]:border-line min-h-[360px] px-5 py-4 outline-none"),
        "aria-label": label,
        "aria-multiline": "true",
        role: "textbox",
      },
    },
    onUpdate: ({ editor }) => setHtml(editor.isEmpty ? "" : editor.getHTML()),
  });

  const s = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            p: e.isActive("paragraph"),
            h2: e.isActive("heading", { level: 2 }),
            h3: e.isActive("heading", { level: 3 }),
            bold: e.isActive("bold"),
            italic: e.isActive("italic"),
            underline: e.isActive("underline"),
            bullet: e.isActive("bulletList"),
            ordered: e.isActive("orderedList"),
            quote: e.isActive("blockquote"),
            code: e.isActive("codeBlock"),
            link: e.isActive("link"),
            href: (e.getAttributes("link").href as string | undefined) ?? "",
            canUndo: e.can().undo(),
            canRedo: e.can().redo(),
          }
        : null,
  });

  const chain = () => editor!.chain().focus();

  function openLink() {
    setLinkUrl(s?.href ?? "");
    setLinkError(null);
    setLinkOpen(true);
  }

  function applyLink() {
    const raw = linkUrl.trim();
    if (!raw) {
      chain().extendMarkRange("link").unsetLink().run();
      setLinkOpen(false);
      return;
    }
    const href = /^(https?:\/\/|mailto:|tel:|\/|#)/i.test(raw) ? raw : `https://${raw}`;
    if (!/^(https?:\/\/[^\s/$.?#].[^\s]*|mailto:\S+@\S+|tel:[+\d\s()-]+|\/\S*|#\S*)$/i.test(href)) {
      setLinkError("That isn't a web address. Paste the full link, like https://example.com.");
      return;
    }
    chain().extendMarkRange("link").setLink({ href }).run();
    setLinkOpen(false);
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface focus-within:border-brand focus-within:ring-4 focus-within:ring-gold-soft">
      <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-1 border-b border-line bg-canvas/60 px-2 py-1.5">
        <Tool on={!!s?.p} disabled={!editor} label="Normal text" onClick={() => chain().setParagraph().run()}>
          Text
        </Tool>
        <Tool on={!!s?.h2} disabled={!editor} label="Heading" onClick={() => chain().toggleHeading({ level: 2 }).run()}>
          H2
        </Tool>
        <Tool on={!!s?.h3} disabled={!editor} label="Subheading" onClick={() => chain().toggleHeading({ level: 3 }).run()}>
          H3
        </Tool>
        <Sep />
        <Tool on={!!s?.bold} disabled={!editor} label="Bold" onClick={() => chain().toggleBold().run()}>
          <b>B</b>
        </Tool>
        <Tool on={!!s?.italic} disabled={!editor} label="Italic" onClick={() => chain().toggleItalic().run()}>
          <i className="font-serif">I</i>
        </Tool>
        <Tool on={!!s?.underline} disabled={!editor} label="Underline" onClick={() => chain().toggleUnderline().run()}>
          <span className="underline underline-offset-2">U</span>
        </Tool>
        <Tool on={!!s?.link} disabled={!editor} label={s?.link ? "Edit link" : "Add link"} onClick={openLink}>
          Link
        </Tool>
        <Sep />
        <Tool on={!!s?.bullet} disabled={!editor} label="Bulleted list" onClick={() => chain().toggleBulletList().run()}>
          <ListIcon />
        </Tool>
        <Tool on={!!s?.ordered} disabled={!editor} label="Numbered list" onClick={() => chain().toggleOrderedList().run()}>
          <ListIcon numbered />
        </Tool>
        <Tool on={!!s?.quote} disabled={!editor} label="Quote" onClick={() => chain().toggleBlockquote().run()}>
          Quote
        </Tool>
        <Tool on={!!s?.code} disabled={!editor} label="Code block" onClick={() => chain().toggleCodeBlock().run()}>
          Code
        </Tool>
        <Tool on={false} disabled={!editor} label="Divider line" onClick={() => chain().setHorizontalRule().run()}>
          Line
        </Tool>
        <Sep />
        <Tool on={false} disabled={!s?.canUndo} label="Undo" onClick={() => chain().undo().run()}>
          Undo
        </Tool>
        <Tool on={false} disabled={!s?.canRedo} label="Redo" onClick={() => chain().redo().run()}>
          Redo
        </Tool>
      </div>

      {linkOpen && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-gold-soft/40 px-3 py-2">
          <label className="sr-only" htmlFor="rte-link">
            Link address
          </label>
          <input
            id="rte-link"
            autoFocus
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
              if (e.key === "Escape") setLinkOpen(false);
            }}
            placeholder="https://example.com"
            className={cx(inputClass, "h-9 min-w-0 flex-1")}
          />
          <button type="button" onClick={applyLink} className="h-9 rounded-full bg-brand px-4 text-[13px] font-medium text-canvas">
            {linkUrl.trim() ? "Apply link" : "Remove link"}
          </button>
          <button type="button" onClick={() => setLinkOpen(false)} className="h-9 rounded-full px-3 text-[13px] text-muted hover:text-ink">
            Cancel
          </button>
          {linkError && (
            <span role="alert" className="w-full text-[12px] text-danger">
              {linkError}
            </span>
          )}
        </div>
      )}

      {editor ? <EditorContent editor={editor} /> : <div className="min-h-[360px] px-5 py-4 text-muted">Loading the editor…</div>}
      <input type="hidden" name={name} value={html} />
    </div>
  );
}

function Tool({ on, disabled, label, onClick, children }: { on: boolean; disabled?: boolean; label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={on}
      title={label}
      className={cx(
        "inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-[13px] transition-colors disabled:opacity-40",
        on ? "bg-brand text-canvas" : "text-ink hover:bg-brand-soft",
      )}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span aria-hidden className="mx-1 h-5 w-px bg-line" />;
}

function ListIcon({ numbered }: { numbered?: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden fill="currentColor">
      {numbered ? (
        <>
          <text x="0" y="5.5" fontSize="5" fontFamily="inherit">1</text>
          <text x="0" y="10" fontSize="5" fontFamily="inherit">2</text>
          <text x="0" y="14.5" fontSize="5" fontFamily="inherit">3</text>
        </>
      ) : (
        <>
          <circle cx="2" cy="4" r="1.3" />
          <circle cx="2" cy="8.5" r="1.3" />
          <circle cx="2" cy="13" r="1.3" />
        </>
      )}
      <rect x="5" y="3.2" width="10" height="1.6" rx=".8" />
      <rect x="5" y="7.7" width="10" height="1.6" rx=".8" />
      <rect x="5" y="12.2" width="10" height="1.6" rx=".8" />
    </svg>
  );
}
