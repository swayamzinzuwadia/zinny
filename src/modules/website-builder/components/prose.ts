/** Typography for blog posts, shared by the editor and the public post page (sanitised tags only). */
export const PROSE = [
  "text-[17px] leading-[1.75] text-ink",
  "[&_p]:my-4 [&>*:first-child]:mt-0",
  "[&_h2]:mb-3 [&_h2]:mt-10 [&_h2]:text-[24px] [&_h2]:font-semibold [&_h2]:leading-snug",
  "[&_h3]:mb-2 [&_h3]:mt-8 [&_h3]:text-[19px] [&_h3]:font-semibold [&_h3]:leading-snug",
  "[&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1.5 [&_li>p]:my-0",
  "[&_a]:underline [&_a]:decoration-1 [&_a]:underline-offset-[3px]",
  "[&_blockquote]:my-7 [&_blockquote]:border-l-[3px] [&_blockquote]:pl-5 [&_blockquote]:text-[19px] [&_blockquote]:leading-relaxed [&_blockquote]:text-muted",
  "[&_hr]:my-10 [&_hr]:border-line",
  "[&_code]:rounded-md [&_code]:bg-canvas [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:text-[0.88em]",
  "[&_pre]:my-6 [&_pre]:overflow-x-auto [&_pre]:rounded-2xl [&_pre]:bg-ink [&_pre]:p-5 [&_pre]:text-[14px] [&_pre]:leading-relaxed [&_pre]:text-canvas [&_pre_code]:bg-transparent [&_pre_code]:p-0",
].join(" ");
