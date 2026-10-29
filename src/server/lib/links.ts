/** Links core pages share with modules. */

/** A student's Join button for one class. The route is built by live-classes. */
export function joinPath(uni: string, batchId: string, date: string) {
  return `/${uni}/learn/join/${batchId}/${date}`;
}
