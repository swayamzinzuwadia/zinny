import { Card, PageHeader } from "@/components/ui";
import { assertCan } from "@/server/authz/engine";
import { spaceContext } from "@/server/context";
import { ImportForm } from "./import-form";

export const metadata = { title: "Bulk import" };

export default async function ImportPage({ params }: { params: Promise<{ uni: string }> }) {
  const { uni } = await params;
  const { actor, university } = await spaceContext(uni);
  assertCan(actor, "user.import", { universityId: university.id });
  return (
    <>
      <PageHeader
        title="Bulk import"
        subtitle="Upload a CSV of students and staff. Every row is checked first; nothing is saved unless all rows are valid. Re-importing the same file never creates duplicates."
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <Card>
          <ImportForm uni={uni} />
        </Card>
        <Card className="h-fit text-sm">
          <div className="mb-2 font-semibold">Columns</div>
          <ul className="space-y-1.5 text-muted">
            <li><b className="text-ink">name</b>, <b className="text-ink">email</b>: required</li>
            <li><b className="text-ink">role</b>: student, permanent_faculty, visiting_faculty, hod, accounts_fees, board_owner or institute_admin</li>
            <li><b className="text-ink">department</b>: the department code (CS, MKT). Needed for faculty and HODs.</li>
            <li><b className="text-ink">access_ends</b>: date like 2027-03-31. Needed for visiting faculty.</li>
            <li><b className="text-ink">phone</b>: optional</li>
          </ul>
        </Card>
      </div>
    </>
  );
}
