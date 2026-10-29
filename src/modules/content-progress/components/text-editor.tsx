"use client";

/**
 * Rich text editor for text lessons (TipTap). Produces HTML that the server sanitises
 * before storing. Keeps to the formatting the lesson page shows: headings, bold, italic,
 * underline, lists, quotes, code, links.
 */
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useActionState, useRef, useState, type ReactNode } from "react";
import { SubmitButton } from "@/components/forms";
import { cx } from "@/components/ui";
import { saveTextAction } from "../actions";
import { PROSE } from "./bits";

function ToolButton({ on, active, label, children }: { on: () => void; active?: boolean; label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={on}
      aria-label={label}
      aria-pressed={active}
      title={label}
      className={cx(
        "inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-[13px] transition-colors",
        active ? "bg-brand text-canvas" : "text-ink hover:bg-brand-soft",
      )}
    >
      {children}
    </button>
  );
}

function Toolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
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
    }),
  });
  const chain = () => editor.chain().focus();
  const setLink = () => {
    const prev = (editor.getAttributes("link").href as string | undefined) ?? "https://";
    const url = window.prompt("Link address (leave empty to remove the link)", prev);
    if (url === null) return;
    if (url.trim() === "" || url.trim() === "https://") chain().extendMarkRange("link").unsetLink().run();
    else chain().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };
  return (
    <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b border-line bg-surface px-2 py-1.5" role="toolbar" aria-label="Formatting">
      <ToolButton label="Heading" active={s.h2} on={() => chain().toggleHeading({ level: 2 }).run()}>
        H2
      </ToolButton>
      <ToolButton label="Subheading" active={s.h3} on={() => chain().toggleHeading({ level: 3 }).run()}>
        H3
      </ToolButton>
      <span className="mx-1 h-5 w-px bg-line" />
      <ToolButton label="Bold" active={s.bold} on={() => chain().toggleBold().run()}>
        <b>B</b>
      </ToolButton>
      <ToolButton label="Italic" active={s.italic} on={() => chain().toggleItalic().run()}>
        <i>I</i>
      </ToolButton>
      <ToolButton label="Underline" active={s.underline} on={() => chain().toggleUnderline().run()}>
        <u>U</u>
      </ToolButton>
      <ToolButton label="Link" active={s.link} on={setLink}>
        Link
      </ToolButton>
      <span className="mx-1 h-5 w-px bg-line" />
      <ToolButton label="Bulleted list" active={s.bullet} on={() => chain().toggleBulletList().run()}>
        • List
      </ToolButton>
      <ToolButton label="Numbered list" active={s.ordered} on={() => chain().toggleOrderedList().run()}>
        1. List
      </ToolButton>
      <ToolButton label="Quote" active={s.quote} on={() => chain().toggleBlockquote().run()}>
        Quote
      </ToolButton>
      <ToolButton label="Code block" active={s.code} on={() => chain().toggleCodeBlock().run()}>
        Code
      </ToolButton>
      <span className="mx-1 h-5 w-px bg-line" />
      <ToolButton label="Undo" on={() => chain().undo().run()}>
        Undo
      </ToolButton>
      <ToolButton label="Redo" on={() => chain().redo().run()}>
        Redo
      </ToolButton>
    </div>
  );
}

export function TextEditor({ uni, lessonId, initialHtml, readOnly }: { uni: string; lessonId: string; initialHtml: string; readOnly?: boolean }) {
  const [state, action] = useActionState(saveTextAction, null);
  const [dirty, setDirty] = useState(false);
  const html = useRef<HTMLInputElement>(null);
  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: { openOnClick: false, autolink: true, protocols: ["http", "https", "mailto"], HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" } },
      }),
    ],
    content: initialHtml || "<p></p>",
    editorProps: {
      attributes: {
        class: cx(PROSE, "min-h-[320px] px-5 py-4 outline-none"),
        "aria-label": "Lesson text",
        role: "textbox",
        "aria-multiline": "true",
      },
    },
    onUpdate: () => setDirty(true),
  });

  return (
    <form
      action={(fd) => {
        setDirty(false);
        return action(fd);
      }}
      onSubmit={() => {
        if (html.current && editor) html.current.value = editor.getHTML();
      }}
    >
      <input type="hidden" name="uni" value={uni} />
      <input type="hidden" name="lessonId" value={lessonId} />
      <input ref={html} type="hidden" name="html" defaultValue={initialHtml} />
      <div className="overflow-hidden rounded-[18px] border border-line bg-surface focus-within:border-brand focus-within:ring-4 focus-within:ring-gold-soft">
        {editor && !readOnly && <Toolbar editor={editor} />}
        {editor ? <EditorContent editor={editor} /> : <div className="min-h-[320px] px-5 py-4 text-muted">Loading the editor…</div>}
      </div>
      {!readOnly && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <SubmitButton pendingText="Saving…">Save text</SubmitButton>
          {dirty && <span className="text-[13px] text-gold-strong">Unsaved changes</span>}
        </div>
      )}
      {state?.error && <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</p>}
      {state?.ok && !dirty && <p className="mt-3 rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand-strong">{state.ok}</p>}
    </form>
  );
}
