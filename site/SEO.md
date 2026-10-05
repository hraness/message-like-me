# Search and answer-engine targets

This file records what each public page should answer for search engines and
AI answer engines, so new pages and edits stay consistent. Copy still follows
`../STYLE.md`; facts about TextButler come from the README, `PRODUCT.md`, and
`docs/textbutler/`.

## Positioning in one sentence

Most personal AI agents are a contact you text. TextButler answers inside the
iMessage, WhatsApp, and Beeper conversations you already have with other
people, on your Mac, only in chats you turn on, with replies marked as AI.
Every comparison leads with this difference, stated fairly.

## Page map

| Page | Questions it answers | Primary terms |
|---|---|---|
| `/` | What is TextButler? How do I set it up? Which AI writes replies? | AI assistant for iMessage, WhatsApp AI auto reply on Mac, AI butler for group chats |
| `/compare` | Which AI assistant you can text fits me? How is TextButler different from personal agents? Does Poke reply to my friends? | AI assistant you can text, personal AI agent comparison, OpenClaw alternatives, Poke AI alternative |
| `/compare/openclaw` | Can OpenClaw answer my friends? OpenClaw vs TextButler for iMessage | OpenClaw alternative, OpenClaw iMessage, OpenClaw group chat |
| `/compare/hermes-agent` | Hermes Agent vs TextButler; Hermes iMessage and WhatsApp setup | Hermes Agent alternative, Hermes Agent iMessage, Nous Research Hermes messaging |
| `/compare/meta-ai-whatsapp` | Can I use my own model in WhatsApp? Meta AI vs TextButler | Meta AI WhatsApp alternative, own AI in WhatsApp chats |
| `/compare/ghostreply` | GhostReply vs TextButler; are AI replies disclosed? | GhostReply alternative, iMessage AI auto reply |
| `/docs`, `/about` | How it works, why replies are marked | TextButler docs, AI reply disclosure |

## Comparison pages

- Keep each competitor's facts in `app/compare/_lib/comparisons.ts` and the
  GhostReply page. Read every fact from the product's own public pages and
  list those pages under Sources.
- `COMPARISONS_CHECKED_ON` is the date those pages were last read. Change it,
  and the `PAGE_LAST_MODIFIED` dates in `app/_lib/site.ts`, only after checking
  every comparison again.
- Write a "Choose X if…" sentence for the other product before the TextButler
  one. Describe what it does; never call it worse. When a source is silent,
  write "Not described" rather than "No".
- A new comparison needs: an entry in `COMPARISONS`, a route folder with
  `page.tsx` and `opengraph-image.tsx`, its path in `CANONICAL_PAGE_PATHS` and
  `PAGE_LAST_MODIFIED`, an admission record in
  `app/compare/_lib/comparison-admissions.ts`, and the page in the Ask AI and
  footer tests. The hub, sitemap, and `llms.txt` pick it up from `HUB_ENTRIES`
  once its record is `indexable`.
- Each comparison URL has an admission record: reader question, sources with
  check dates, a score out of 12, the reviewer and reviewer type, and a
  reassessment date 28 to 56 days after review. A page needs at least 9 with no
  zero to be indexable, and it shows the drafting and review note from that
  record.
- Poke has a hub row and a hub question but no page of its own (it scored 8 of
  12, because Poke never answers your contacts). `/compare/poke` redirects to
  `/compare`.
- Leave out products whose facts can't be read from an official page. For
  example, OpenAI's 1-800-ChatGPT help article blocked automated reading on
  2026-10-02, so ChatGPT on WhatsApp has no page yet.

## Structured data

- The root layout publishes the one `SoftwareApplication` node
  (`https://textbutler.app#application`). Pages point at it through
  `app/_lib/structured-data.ts` rather than repeating it.
- Comparison pages publish `WebPage` (about TextButler, mentioning the other
  product by its official URL), `BreadcrumbList`, and `FAQPage`. The hub
  publishes `CollectionPage` and `FAQPage`.
- Publish `FAQPage` only for questions shown on the same page, with identical
  text. Tests check this.

## llms.txt

`app/llms.txt/route.ts` starts with the definition, then key facts as short
bullets, then the comparison summary with links, then setup and safety detail.
Keep each line true on its own, because answer engines quote single lines.

## Share images

Every share card comes from `defineSocialImageSite` in `app/_lib/social.ts`.
A page passes copy only: eyebrow, headline, and description. The social image
tests check that each card fits.
