# UI morph spec (one shape, never cut: the most-bookmarked pattern)

<inputs>Ask me for: my product + URL, 8 to 12 UI states that tell its story, the real data shown in each
state, brand colors + fonts + one accent, a track near 120 BPM (or synthesize), formats.</inputs>

<direction>Product-film UI motion. One container never cuts: every state is the same element changing
size, radius and fill while its content swaps behind a short blur. A cursor drives every change. Warm
neutral canvas, one accent. Springs with at most a tiny overshoot. Banned: bouncy easing, glows,
gradients on UI chrome, particle bursts, dead time. 120 BPM, 8 bars, something happens on every beat.</direction>

<states>logo → CTA button → email field (typed) → loader → success check → dashboard card → chart draws
itself → tooltip on hover → ⌘K palette → toast → logo</states>

<build>
1. films/<key>/index.html with film({ draw }), window.seek(t). No CSS transitions, no timers, no carried state.
2. Closed-form springs. A value with many targets = track() (sum of one spring per change).
3. Text inside a morphing container enters after the morph starts, leaves before the next (swapAlpha).
4. Tab indicators: leading and trailing edges on different springs so they stretch (indicator()).
5. Beat grid from the track (studio beats) or studio grid. Start on a downbeat. UI sounds on measured peaks.
6. Render at 60 fps with 4 subframes blended for motion blur (film.json motionBlur: 4).
</build>

<gotchas>Never use will-change on anything the camera scales (blurry text). The last frame must equal
the first, cursor position and velocity included (studio new --loop; film_gate checks the seam).</gotchas>

Ask for the inputs, then show me the state list on the beat grid before writing code.
