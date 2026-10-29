import { ActionForm, SubmitButton } from "@/components/forms";
import { Badge, Card, CardTitle, Empty, Input, Select } from "@/components/ui";
import type { CourseTabProps } from "@/contracts/module";
import { can } from "@/server/core";
import { addLessonAction, addSectionAction } from "../actions";
import { getCurriculum } from "../service";

/** Admin course page → Curriculum tab (adminCourseTabs.curriculum). Moved from the core course page. */
export async function CurriculumTab({ uni, actor, course, target }: CourseTabProps) {
  const curriculum = await getCurriculum(actor, course.id);
  const canEdit = can(actor, "course.update", target);
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        {curriculum.length === 0 && <Empty title="No sections yet">Group lessons into sections, like Week 1 or Module 1.</Empty>}
        {curriculum.map((s, i) => (
          <Card key={s.id}>
            <CardTitle hint={`${s.lessons.length} lessons`}>
              {i + 1}. {s.title}
            </CardTitle>
            <ul className="mb-4 space-y-1 text-sm">
              {s.lessons.map((l) => (
                <li key={l.id} className="flex items-center gap-2">
                  <Badge>{l.kind}</Badge> {l.title}
                </li>
              ))}
            </ul>
            {canEdit && (
              <ActionForm action={addLessonAction} className="flex flex-wrap gap-2">
                <input type="hidden" name="uni" value={uni} />
                <input type="hidden" name="courseId" value={course.id} />
                <input type="hidden" name="sectionId" value={s.id} />
                <Input name="title" placeholder="Lesson title" required className="min-w-0 flex-1" />
                <Select name="kind" className="w-28">
                  <option value="video">Video</option>
                  <option value="text">Text</option>
                  <option value="pdf">PDF</option>
                  <option value="live">Live</option>
                </Select>
                <SubmitButton size="sm" variant="secondary">
                  Add lesson
                </SubmitButton>
              </ActionForm>
            )}
          </Card>
        ))}
      </div>
      {canEdit && (
        <Card className="h-fit">
          <CardTitle>Add a section</CardTitle>
          <ActionForm action={addSectionAction} className="space-y-3">
            <input type="hidden" name="uni" value={uni} />
            <input type="hidden" name="courseId" value={course.id} />
            <Input name="title" placeholder="Module 1: Foundations" required />
            <SubmitButton variant="secondary">Add section</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
