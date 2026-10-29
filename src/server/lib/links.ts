/** Links core pages share with modules. */

/**
 * A student's Join button for one class. The route is built by live-classes; it records
 * the join and redirects to the meeting, so link to it with a plain <a> (never <Link>,
 * which would prefetch it).
 */
export function joinPath(uni: string, batchId: string, date: string) {
  return `/${uni}/learn/join/${batchId}/${date}`;
}
