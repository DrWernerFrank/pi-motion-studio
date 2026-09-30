# Director's brief (long-form / overnight): fill in, then run /skill:motion-director

You are the director, animator, sound designer and render engineer for a [DURATION] film made in code.
Treat this as a multi-session production. Don't rush to a final render.

## The film in one line
[LOGLINE. What the viewer should feel at the end.]

## References and inputs
- films/<key>/refs/ : [video / frames / image library]. Take the grammar, never the content.
- films/<key>/assets/track.wav : use it unchanged (film.json "track"). Measure beats first (studio beats).
- APIs in .env by name: [ELEVENLABS_API_KEY, FAL_KEY]. Budget: [$X]. Be economical.

## Look
[3-5 lines: palette, type, texture, camera language. Banned looks.]

## Character bible (optional)
[proportions, palette, expressions, identity lock]

## Beat sheet
- 0:00-0:02 hook: [the single most striking image]
- 0:02-0:10 [act 1]
- … a new visual payoff every 3-5 seconds
- [END] the last frame sets up the first frame (loop)

## Text on screen
[when lyrics/captions go huge, when they sit like subtitles]

## Workflow, with gates
plan → sound → rig → stills → animatic (draft render) → full pass → polish → audio → ship.
Show me the storyboard, then continue without waiting if I don't answer in 10 minutes.
Split work across motion-animator subagents per chapter; write docs/ANIMATION_GUIDE.md first.

## Critique loop (every chapter, at least 3 rounds)
film_look → film_review (hook, readability at 360px, motion, variety, composition, brand, sound) →
fix the 3 worst → repeat until all are 8+. Run motion-critic for fresh eyes before shipping.

## Deliverables
out/final-<fmt>.mp4 · out/loop_check.mp4 · out/poster-<fmt>.png · contact sheet · README.md
