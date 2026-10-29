/**
 * reports-board tables. Prefix: rpt_. drizzle.config.ts picks this file up automatically.
 * Every table holding university data needs `university_id uuid not null` referencing
 * universities; row-level security is then applied to it by `npm run db:push`.
 */
export {};
