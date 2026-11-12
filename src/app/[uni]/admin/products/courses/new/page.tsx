import Link from "next/link";
import { Empty, PageHeader } from "@/components/ui";
import { spaceContext } from "@/server/context";
import { marketplaceInstalled, quickCourseOptions } from "@/server/services/quick-course";
import { NewCourseForm } from "./new-course-form";

export const metadata = { title: "New course" };

export default async function NewCoursePage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  const options = await quickCourseOptions(actor, university.timezone);
  const back = `/${uni}/admin/products/courses`;

  if (options.departments.length === 0 && !options.canCreateDepartment) {
    return (
      <>
        <PageHeader title="New course" />
        <Empty title="You can't create courses here">
          Institute admins and heads of department create courses. Ask one of them to add the course, or to make you head of a department.{" "}
          <Link href={back} className="font-medium text-brand hover:underline">
            Back to courses
          </Link>
        </Empty>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="New course"
        subtitle="Only the title is needed. Fill in the rest now to have a course students can enrol in when you save, or add it later."
      />
      <NewCourseForm
        uni={uni}
        me={actor.userId}
        options={options}
        showGst={university.gstEnabled}
        marketplace={marketplaceInstalled()}
        cancelHref={back}
      />
    </>
  );
}
