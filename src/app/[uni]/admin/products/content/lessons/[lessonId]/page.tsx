import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Field, Input, Notice, PageHeader, Select } from "@/components/ui";
import { DeleteLessonButton } from "@/modules/content-progress/components/lesson-editor-controls";
import { DripFields } from "@/modules/content-progress/components/drip-fields";
import { FileUpload } from "@/modules/content-progress/components/file-upload";
import { TextEditor } from "@/modules/content-progress/components/text-editor";
import { Icon } from "@/modules/content-progress/components/bits";
import {
  clearContentAction,
  saveLinkAction,
  saveVideoLinkAction,
  setLessonKindAction,
  updateLessonAction,
} from "@/modules/content-progress/actions";
import { formatBytes } from "@/modules/content-progress/lib/files";
import { embedUrl, KIND_LABEL, LESSON_KINDS } from "@/modules/content-progress/lib/kinds";
import { curriculumPath, lessonEditorPath, staffFilePath, uploadsPath } from "@/modules/content-progress/paths";
import { getLessonForEdit } from "@/modules/content-progress/service";
import { spaceContext } from "@/server/context";
import { NotFoundError } from "@/server/errors";

export const metadata = { title: "Edit lesson" };

const KIND_HELP: Record<string, string> = {
  video: "Upload a video file, or paste a YouTube or Vimeo link. Students complete it by watching 90%.",
  pdf: "Upload a PDF. Students read it in the lesson and mark it complete.",
  text: "Write the lesson here. Students read it and mark it complete.",
  link: "Send students to a page on another site, like an article or an exercise. They mark it complete when done.",
  live: "Points students to this course's live classes on their batch timetable. There is nothing to upload.",
};

/** Curriculum → one lesson: content, settings, drip. Editing needs content.manage; others see it read-only. */
export default async function LessonEditorPage({ params }: { params: Promise<{ uni: string; lessonId: string }> }) {
  const { uni, lessonId } = await params;
  const { actor } = await spaceContext(uni);
  const data = await getLessonForEdit(actor, lessonId).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { lesson, parsed, course, sections, section, prev, next, canEdit } = data;
  const hidden = (
    <>
      <input type="hidden" name="uni" value={uni} />
      <input type="hidden" name="lessonId" value={lesson.id} />
    </>
  );

  return (
    <>
      <div className="mb-2 text-sm text-muted">
        <Link href={curriculumPath(uni, course.id)} className="hover:text-ink">
          {course.title}
        </Link>{" "}
        / {section.title}
      </div>
      <PageHeader
        title={lesson.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{KIND_LABEL[lesson.kind]}</Badge>
            <Badge tone={lesson.required ? "brand" : "neutral"}>{lesson.required ? "Required" : "Optional"}</Badge>
            {lesson.ready ? <span>Students see this lesson.</span> : <Badge tone="gold">Needs content: hidden from students</Badge>}
          </span>
        }
        actions={
          <div className="flex gap-2">
            {prev && (
              <Link href={lessonEditorPath(uni, prev.id)} className="rounded-full border border-line px-4 py-2 text-[14px] hover:border-brand/40">
                Previous lesson
              </Link>
            )}
            {next && (
              <Link href={lessonEditorPath(uni, next.id)} className="rounded-full border border-line px-4 py-2 text-[14px] hover:border-brand/40">
                Next lesson
              </Link>
            )}
          </div>
        }
      />
      {!canEdit && <Notice tone="neutral">You can view this lesson. Only the course&apos;s HOD, admins and faculty who teach one of its batches can change it.</Notice>}

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_380px]">
        <Card>
          <CardTitle hint={KIND_LABEL[lesson.kind]}>Content</CardTitle>
          <p className="-mt-2 mb-5 text-[14px] text-muted">{KIND_HELP[lesson.kind]}</p>

          {parsed.kind === "video" && (
            <div className="space-y-6">
              {parsed.video?.source === "upload" && (
                <div className="space-y-2">
                  <video controls preload="metadata" playsInline className="aspect-video w-full rounded-2xl bg-brand-deep" src={staffFilePath(uni, lesson.id)} />
                  <div className="text-[13px] text-muted">
                    {parsed.video.fileName} · {formatBytes(parsed.video.size)}
                    {parsed.video.durationSeconds ? ` · ${Math.round(parsed.video.durationSeconds / 60)} min` : ""}
                  </div>
                </div>
              )}
              {parsed.video && parsed.video.source !== "upload" && (
                <div className="space-y-2">
                  <div className="aspect-video w-full overflow-hidden rounded-2xl bg-brand-deep">
                    <iframe
                      src={embedUrl(parsed.video)}
                      title={lesson.title}
                      className="h-full w-full"
                      allow="encrypted-media; picture-in-picture; fullscreen"
                      referrerPolicy="strict-origin-when-cross-origin"
                      sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
                    />
                  </div>
                  <a href={parsed.video.url} target="_blank" rel="noreferrer" className="text-[13px] text-brand hover:underline">
                    {parsed.video.url}
                  </a>
                </div>
              )}
              {canEdit && (
                <>
                  <div>
                    <div className="mb-2 text-[13px] font-medium">Upload a video file</div>
                    <FileUpload uploadsUrl={uploadsPath(uni)} lessonId={lesson.id} kind="video" hasFile={parsed.video?.source === "upload"} />
                  </div>
                  <div className="border-t border-line pt-5">
                    <ActionForm action={saveVideoLinkAction} className="space-y-3" resetOnSuccess={false}>
                      {hidden}
                      <Field label="Or paste a YouTube or Vimeo link" hint="Unlisted videos work too. The lesson uses the link instead of an uploaded file.">
                        <Input
                          name="url"
                          type="url"
                          required
                          placeholder="https://www.youtube.com/watch?v=…"
                          defaultValue={parsed.video && parsed.video.source !== "upload" ? parsed.video.url : ""}
                        />
                      </Field>
                      <SubmitButton variant="secondary">Save video link</SubmitButton>
                    </ActionForm>
                  </div>
                </>
              )}
            </div>
          )}

          {parsed.kind === "pdf" && (
            <div className="space-y-5">
              {parsed.pdf && (
                <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-canvas/60 px-4 py-3">
                  <Icon name="pdf" className="text-brand" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{parsed.pdf.fileName}</div>
                    <div className="text-[13px] text-muted">{formatBytes(parsed.pdf.size)}</div>
                  </div>
                  <a href={staffFilePath(uni, lesson.id)} target="_blank" rel="noreferrer" className="text-[14px] text-brand hover:underline">
                    Open PDF
                  </a>
                </div>
              )}
              {canEdit && <FileUpload uploadsUrl={uploadsPath(uni)} lessonId={lesson.id} kind="pdf" hasFile={!!parsed.pdf} />}
            </div>
          )}

          {parsed.kind === "text" && <TextEditor uni={uni} lessonId={lesson.id} initialHtml={parsed.html} readOnly={!canEdit} />}

          {parsed.kind === "link" &&
            (canEdit ? (
              <ActionForm action={saveLinkAction} className="space-y-3" resetOnSuccess={false}>
                {hidden}
                <Field label="Web address">
                  <Input name="url" type="url" required placeholder="https://" defaultValue={parsed.url ?? ""} />
                </Field>
                <SubmitButton>Save link</SubmitButton>
              </ActionForm>
            ) : parsed.url ? (
              <a href={parsed.url} target="_blank" rel="noreferrer" className="break-all text-brand hover:underline">
                {parsed.url}
              </a>
            ) : (
              <p className="text-[14px] text-muted">No link yet.</p>
            ))}

          {parsed.kind === "live" && (
            <Notice tone="brand">Students see their batch&apos;s next live classes in this lesson, with a Join button on class days.</Notice>
          )}

          {canEdit && lesson.kind !== "live" && lesson.ready && (
            <ActionForm
              action={clearContentAction}
              className="mt-6 border-t border-line pt-4"
              confirm="Remove this lesson's content? Students won't see the lesson until you add new content."
            >
              {hidden}
              <SubmitButton variant="danger" size="sm">
                Remove content
              </SubmitButton>
            </ActionForm>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardTitle>Lesson settings</CardTitle>
            <ActionForm action={updateLessonAction} className="space-y-4" resetOnSuccess={false}>
              {hidden}
              <Field label="Title">
                <Input name="title" defaultValue={lesson.title} required minLength={2} maxLength={200} disabled={!canEdit} />
              </Field>
              <Field label="Section">
                <Select name="sectionId" defaultValue={lesson.sectionId} disabled={!canEdit}>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Counts toward progress">
                  <Select name="required" defaultValue={lesson.required ? "required" : "optional"} disabled={!canEdit}>
                    <option value="required">Required</option>
                    <option value="optional">Optional</option>
                  </Select>
                </Field>
                <Field label="Duration (minutes)">
                  <Input name="durationMinutes" type="number" min={0} max={6000} step={1} inputMode="numeric" defaultValue={lesson.durationMinutes || ""} placeholder="0" disabled={!canEdit} />
                </Field>
              </div>
              <DripFields mode={lesson.dripMode} days={lesson.dripDays} date={lesson.dripDate} disabled={!canEdit} />
              {canEdit && <SubmitButton>Save settings</SubmitButton>}
            </ActionForm>
          </Card>

          {canEdit && (
            <Card>
              <CardTitle>Lesson type</CardTitle>
              <ActionForm
                action={setLessonKindAction}
                className="space-y-3"
                resetOnSuccess={false}
                confirm={lesson.ready && lesson.kind !== "live" ? "Changing the type removes this lesson's current content. Continue?" : undefined}
              >
                {hidden}
                <Select name="kind" defaultValue={lesson.kind} aria-label="Lesson type">
                  {LESSON_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </Select>
                <SubmitButton variant="secondary">Change type</SubmitButton>
              </ActionForm>
              <div className="mt-6 border-t border-line pt-4">
                <DeleteLessonButton uni={uni} lessonId={lesson.id} courseId={course.id} title={lesson.title} />
              </div>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
