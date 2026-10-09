---
description: 'Defer to the produce skill for any new piece; use this when the human names /skill:motion-director,
  gives a director''s brief, a song or long script, asks for a music video/short film/"work on
  this overnight", or when a film needs chapters and subagents: a long-form or multi-chapter film
  made in code (45 s to several minutes: music videos, history films, story shorts, product films
  with a character), including multi-session and overnight autonomous runs. For short reels use
  motion-reel instead.'
name: motion-director
---

# Motion director

A long film is a production, not a prompt. You hire the crew (subagents), set the gates, and do not
rush to a final render. House rules: `AGENTS.md`. Techniques: `../motion-reel/craft.md`.

## The brief skeleton (write `films/<key>/brief.md`)

1. **Film in one line**: logline + the joke/feeling.
2. **References**: source video/song/image. What to keep, what to push.
3. **Tools & keys**: APIs in `.env` by NAME only, budget.
4. **Character bible** (if any): proportions, palette, expressions. Draw it as `drawHero(ctx, pose, t)`.
5. **Beat sheet**: acts with timestamps; a hook in the first 2 s; a visual payoff every 3-5 s.
6. **Text on screen**: when lyrics/captions go huge, when they sit like subtitles; leave room.
7. **Workflow gates** (below). 8. **Critique loop**. 9. **Deliverables**.

## Workflow gates

| Gate | Output | Check |
|---|---|---|
| 1 plan | `brief.md`, `design.json`, `docs/STORYBOARD.md` | show user |
| 2 sound first | `beats.json` (measure track) | cuts on downbeats |
| 3 rig | `docs/ANIMATION_GUIDE.md`, shared `lib/` | one still per pose |
| 4 stills | one key still per shot | contact sheet |
| 5 animatic | all shots blocked, placeholder art OK | watch pacing |
| 6 full pass | every shot animated | critique rounds |
| 7 polish | transitions, texture, loop | 3+ rounds, all 8+ |
| 8 audio | cues.json on grid, `film_sound` | gates pass |
| 9 render | `node engine/cli.mjs ship <key>` | deliverables |

## Chapters and subagents

Split into chapters: `films/<key>/chapters/ch01.js` … each exports
`export default { from, to, draw(ctx, lt, L, p, t, shared) }`. Before spawning anyone, write
`docs/ANIMATION_GUIDE.md` so every chapter codes in the same style. Spawn one `motion-animator`
per chapter in parallel. Then run `motion-critic` over the whole film.

## Overnight rules

- Keep `docs/PROGRESS.md`: current gate, what's done, what's next, open questions.
- Don't wait on questions longer than 10 min; decide, log, continue.
- Render drafts often (cheap); finals once per gate 7+.
- No aesthetic re-litigation after gate 3 unless a score is below 6.

