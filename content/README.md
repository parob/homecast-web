# Blog editing

Posts live in `blog/`. Keep existing filenames: they are published URLs. The build creates the article HTML, RSS feed and sitemap from the same Markdown used by the React pages.

## Voice for Homecast copy

These rules apply to posts, titles, summaries, captions and launch copy. Use the same principles when editing other public Homecast text. Write as someone who knows the product explaining it to a person who wants to use it. Be conversational without inventing a personality for Rob.

- Open with the actual change, problem or task. Avoid a generic observation about smart homes, a staged morning routine, or an introduction that only promises to explain the title.
- Give a claim only the detail the reader needs. One useful example can be enough; it doesn't always need a setting path, an explanation of the internals and a list of consequences. In tutorials, keep the steps needed to follow along. Don't call a step simple or seamless.
- Match detail to the post's purpose. In a launch announcement, name the capability, give one brief example and link to the guide. Keep colour meanings, calculations and node-by-node setup in the tutorial. Once the point is clear, move on; don't follow it with a restatement or a catalogue of related features.
- Connect paragraphs through the subject. If a light has two competing automations, explain what happens and how to check for it. Don't insert “moreover”, “the real magic” or a miniature slogan to manufacture a transition.
- Use first person for an actual choice in the example, a supplied opinion or an invitation to give feedback. “I've allowed two minutes on the platform in this example” has a purpose. Repeated “I like” and “I'd start” do not supply personal experience. Never invent a household, motivation, frustration, testing history, result or quote for the author.
- Preserve a real author's wording when supplied. Edit only what needs editing, rather than smoothing the whole draft into a house template. Keep contractions and natural sentence variation; don't manufacture typos, slang or one-line paragraphs to look human.
- Let the content determine the shape. A camera update can be a few paragraphs. A train project needs a worked example. A launch needs an introduction and a way to try the product. They don't all need three benefits, a lesson and a concluding recap.
- Headings should help someone find the next part: “Create a scene”, “Turn on recording”. Avoid abstract headings such as “Unlock the possibilities” or “Bring your tools along”. Lists belong where readers need steps or comparisons; prose belongs where one thought develops another.
- Put requirements and limitations next to the claim they qualify. A Mac staying awake, managed-only cameras and account approval affect whether the reader can use a feature. Don't hide those just to make a post shorter.
- End when the useful material is finished. A relevant documentation link or a specific feedback request is enough. Don't append a generic sales pitch to each guide.
- Punctuation isn't an authorship test. Use an em dash if it reads well, and a list of three if there are three things to say. Review repetition and empty rhetoric in context rather than enforcing a blacklist or aiming for an AI-detector score.

## What the research changed

Reviewed on 5 October 2026. Forum comments are reader reactions, not a representative survey. These are editorial judgements informed by the sources below, not a scientific test of whether text was generated.

| Criticism or example | What to take from it |
|---|---|
| [r/Blogging: same voice and cadence](https://www.reddit.com/r/Blogging/comments/1rr0184/ai_writing_all_sounds_like_the_same_person_wrote/) | Read openings and endings across the whole index. Remove repeated sentence shapes, padding and forced friendliness, not just conspicuous vocabulary. |
| [Hacker News: ai;dr](https://news.ycombinator.com/item?id=46991394) | Readers object to wasted effort, but disagree about punctuation as a tell. Concision and substance are better review criteria. |
| [Oxide's discussion of LLM writing](https://rfd.shared.oxide.computer/rfd/0576) | Readers need to trust that the author understands and stands behind the claims. Check the facts and the argument; a confident tone doesn't establish either. Oxide's own publishing policy is theirs, not a rule adopted here. |
| [Agarwal et al., CHI 2025](https://arxiv.org/abs/2409.11360) | A study of 118 Indian and US participants found AI suggestions could flatten cultural differences in writing. This is evidence from specific writing tasks, not proof of a universal AI style. Preserve the author's supplied details and phrasing. |
| [Loopwerk: My Home Assistant setup](https://www.loopwerk.io/articles/2025/home-assistant-setup/) | Choices lead to settings and code, with explanations of why that particular setup works for the author. In Homecast guides, explain our example's choices without borrowing their experience. |
| [Grio: HomeKit Support for the Impatient](https://blog.grio.com/2022/11/homebridge-homekit-support-for-the-impatient.html) | One concrete problem carries the post through decisions and setup friction. Use a worked Homecast example rather than a catalogue of benefits. |
| [Home Assistant: Perfect Home Automation](https://www.home-assistant.io/blog/2016/01/19/perfect-home-automation/) | Specific household consequences make the argument worth reading. Explain what happens for the other people using the home, including when a feature fails. |
| [Jeff Geerling: Home Assistant Yellow](https://www.jeffgeerling.com/blog/2022/home-assistant-yellow-pi-powered-local-automation/) | Observations, constraints and untested areas are distinguishable. Keep example data and verified behaviour separate from claims about real-world use. |
| [Simon Willison on first-person writing](https://simonwillison.net/2026/Mar/1/ai-writing/) | First person carries an attribution. Adding “I” doesn't justify inventing the author's opinions or reasons for building a feature. |
| [Julia Evans: Some blogging myths](https://jvns.ca/blog/2023/06/05/some-blogging-myths/) | Pick the intended reader and a small number of useful points. A post doesn't need to explain every related concept. |
| [Troy Hunt: IoT Unravelled](https://www.troyhunt.com/iot-unravelled-part-1-its-a-mess-but-then-theres-home-assistant/) | Keep the overview at the level of what happens in the home. Detailed configuration can live in a separate guide. |
| [Scott Helme: HTTPS for Home Assistant](https://scotthelme.co.uk/setting-up-https-for-home-assistant/) | A focused how-to can proceed from the setup choice to the required commands without teaching the entire surrounding subject. |

These posts are references for pacing, specificity and explanation. Don't copy distinctive phrases, anecdotes, structure sentence by sentence, or claim to reproduce an author's exact voice. Older tutorials are not sources for current Homecast behaviour.

Examples from this revision:

- “Make something you can keep” became “Create a scene”. The section now follows one request through checking the scene and running it again later.
- The train guide keeps its working code and setup steps. Its opening no longer repeats the colour table below it.
- “I'd choose Control for most household members” became a description of what Control permits, so the reader can choose.
- The launch mentions a train-light example in one sentence and links to the tutorial. Its timing rules and editor setup belong in that tutorial.

Before finishing, read the post aloud, then read it beside the other posts. Check that each paragraph adds information, the examples are labelled, and a reader can tell what to do next. Keep useful qualifications. Don't shorten a sentence past the point where it explains the feature.

## Formatting and assets

- Keep descriptions as index and search summaries; the article should move from its title and byline straight into the opening paragraph.
- Keep the main post short. Put long code, secondary setup paths and reference screenshots in native `<details>` / `<summary>` blocks with a clear label. Leave blank lines around inner Markdown. Keep essential requirements and limitations visible, and don't hide the whole article behind expanders.
- Link to existing documentation for full reference material. Don't invent GitHub or gist URLs for unpublished snippets; a collapsed, copyable block keeps the example available.
- Preserve `<!-- snippet: name -->` markers and tested code blocks. The blog tests exercise the published snippets and check links and assets.
- Keep the index text-led, with small thumbnails on selected posts. Use a few understated generated photos: ordinary homes and objects, natural light, no dramatic lighting or staged luxury interiors. Do not add AI-generation captions to published photos. Keep descriptive alt text.
- Use actual app screenshots to demonstrate the product. Screenshots use mock data via `screenshots/blog.spec.ts`; label it as example data rather than a real household's results. Keep images modest in size, with access to the full image. A post does not need a cover.

Checks: `npm test -- src/lib/blog/__tests__`, `npm run typecheck`, `npm run build`. Preview locally at `/blog/?cloud=1`; the query enables the existing development-only marketing preview on localhost.

When merging posts, keep the surviving title and put the retired slug in `src/lib/blog/redirects.ts`. The browser and static build both redirect it; the retired post must not remain in the index or feed.

Set `featured: true` on at most one post to pin it to the top of the index, including its category view. The first public release announcement uses this. RSS stays in date order.

## Search and sharing

Every post gets static HTML, a canonical URL, a search summary, Open Graph and Twitter previews, article and breadcrumb structured data, and related-post links. The React page updates the same metadata when readers navigate. Missing posts get `noindex`. The build updates `/sitemap.xml` and `/blog/feed.xml`; retired posts redirect and stay out of both.

Use a title someone would search for, a specific description, descriptive image alt text and relevant links to other guides. Keep the prose short. Don't pad articles with keywords, FAQ blocks or repeated explanations for SEO. Article dates and authors must be real; do not bump dates just to look fresh.

After publishing, inspect the launch and one guide in Google Search Console and submit `https://homecast.cloud/sitemap.xml`. Check the canonical URL and rendered HTML, then monitor impressions and clicks before changing titles. This requires the site's verified Search Console account; publishing a sitemap alone does not submit it there.

References: [Google's SEO starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide), [article structured data](https://developers.google.com/search/docs/appearance/structured-data/article), [JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics).

## Comments

The comment section uses [Giscus](https://giscus.app/), backed by GitHub Discussions. It stays collapsed and makes no Giscus request until opened. Readers sign in with GitHub to reply. Comments remain in the iframe and are never rendered through the blog's trusted Markdown parser.

**Activation is still pending.** `blog-comments.json` deliberately has empty repository and category IDs, so no broken comment box appears in production. To activate:

1. Enable Discussions on the public `parob/homecast` repository, install the Giscus GitHub app for that repository only, and create a **Blog** category with the Announcements format. App installation needs repository-owner approval.
2. Select that repository and category at [giscus.app](https://giscus.app/) and copy its `data-repo-id` and `data-category-id` into `blog-comments.json`. These IDs are public configuration, not credentials. If using another public repository, update its name too.
3. Build and deploy, then check reading, GitHub sign-in and replying on one post. Previewing the component locally uses that same public discussion store; don't post test comments into production.

Threads are mapped to the canonical post path with strict matching, so query strings and title edits won't split the conversation. Keep published slugs stable. If posts are merged, the surviving post keeps its thread; existing comments from the retired post need a separate moderation decision.

Moderate replies through GitHub Discussions. Keep the Blog category for post comments and avoid changing the issue-reporting workflow.
