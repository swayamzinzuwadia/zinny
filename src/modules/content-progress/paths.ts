/** Links to this module's pages and the core pages it plugs into. */

export const curriculumPath = (uni: string, courseId: string) => `/${uni}/admin/products/courses/${courseId}?tab=curriculum`;
export const lessonEditorPath = (uni: string, lessonId: string) => `/${uni}/admin/products/content/lessons/${lessonId}`;
export const staffFilePath = (uni: string, lessonId: string) => `/${uni}/admin/products/content/lessons/${lessonId}/file`;
export const uploadsPath = (uni: string) => `/${uni}/admin/products/content/uploads`;
export const progressOverviewPath = (uni: string) => `/${uni}/admin/products/content`;
export const batchProgressPath = (uni: string, batchId: string) => `/${uni}/admin/products/content/batches/${batchId}`;

export const lessonPath = (uni: string, lessonId: string) => `/${uni}/learn/lessons/${lessonId}`;
export const lessonFilePath = (uni: string, lessonId: string) => `/${uni}/learn/lessons/${lessonId}/file`;
export const lessonProgressPath = (uni: string, lessonId: string) => `/${uni}/learn/lessons/${lessonId}/progress`;
export const courseHubPath = (uni: string, enrolmentId: string) => `/${uni}/learn/my/${enrolmentId}?tab=lessons`;
/** The live-classes join route (contracts: link with a plain <a>, never <Link>). */
export const joinPath = (uni: string, batchId: string, date: string) => `/${uni}/learn/join/${batchId}/${date}`;
