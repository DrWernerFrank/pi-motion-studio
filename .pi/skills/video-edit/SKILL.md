---
description: 'Edit real footage into a platform-ready cut: trim a raw phone clip, talking head,
  interview, podcast or screen recording — cut the dead air and the "ums", add word-accurate
  captions, reframe widescreen to vertical with the speaker kept framed, pull podcast highlight
  reels, make screen recordings snappy with punch-ins and a music bed, repair audio (denoise,
  level, -14 LUFS). Use when the user hands you a real video or audio file to cut, caption,
  reframe or fix — roughly 5-90 s of finished footage, from sources of any length. For code-drawn
  films use motion-reel instead.'
name: video-edit
---

# Video edit

You are editor, captioner, sound engineer and delivery engineer on real footage. The motion engine is
now a layer over, under and around it: titles, lower thirds, captions, punch-ins on the measured words.
House rules: `AGENTS.md` (read it if you have not this session), including "Real footage". The craft
rules in §8 are the product. The user watches and vetoes in the Studio GUI (`/studio`, link
`http://localhost:3142/#film=<key>`): the timeline, the cut proposals and the sheets are all there.

The order is fixed: **ingest → look → transcribe → read → cut → arrange → captions → reframe → sound →
look → review → gate → render → report.** Audio before picture, every time.

## 0. Intake (ask, don't guess)

| The ask | Pipeline |
|---|---|
| "Cut the dead air and the ums, add captions, 9:16 + 16:9" | ingest → transcribe → cut silence + fillers → hook first → captions → reframe → ship |
| "Three 45-second vertical highlights from this podcast" | ingest → transcribe → read, pick the 3 lines → three timelines → captions → follow reframe → ship |
| "Fix the audio: hiss, level, -14 LUFS" | ingest → sound (dialog bus + cleanup); no cuts unless asked |
| "Reframe widescreen to vertical, speaker framed" | ingest → cam follow (crop-keyframes if the move is deliberate) → ship |
| "Make this screen recording snappy" | ingest → transcribe → cut idle + speed the boring part → punch-ins + title → music bed → ship |
| "Twelve clips and a song: a montage" | ingest ×12 + song → grid → cuts on the beats → title → duck → ship |
| "Add name lower thirds" | ingest → transcribe → find the introductions → overlay lower-third → ship |

Ask with `ask_user_question`, one question per call, only what the request does not say:

1. **Duration** — target length (and for a long source: one piece or several?).
2. **Platform / formats** — 9:16 / 1:1 / 16:9 / 4:5. Default: the source aspect plus 9:16.
3. **Keep-um-or-clean** — fillers are cut for polish; if the ums are part of the charm (a conversation,
   a comedian), keep them and say so.
4. **Music** — none (default for talking heads), a supplied track (path), or synthesize.
5. **Hook** — which line lands hardest? Ask only if the transcript does not make it obvious.

For a pure one-liner ("make this snappy") skip intake: the genre is the spec. Pick defaults, state them.

## 1. Ingest and truth

```bash
./studio new <key> --edit --fps 30000/1001 --formats 16:9,9:16
./studio ingest <key> ~/Videos/interview.mp4 --id cam
./studio media <key>            # the bin: sources, durations, originals still where they were?
```

- Ingest conforms every source: CFR at the project fps, upright, SDR bt709, short GOP + a scrub proxy,
  48 kHz PCM, waveform peaks, a filmstrip, scene cuts, a silence map. Originals are read-only
  (path + sha256 pinned); conformed media is a cache. Windows paths, spaces and non-ASCII work.
  A moved original: `./studio relink <key>` repairs by hash.
- Look before you decide: `./studio look <key> --mode every` — read the sheet. Then `media.json`
  (fps, rotation, HDR, VFR, audio layout) and the silence map.
- **Never trust word boundaries over the audio.** Cut points come from the measured gaps (noise floor,
  speech segmentation), whatever the transcript says. The transcript decides *what*; the audio decides *where*.

## 2. Transcribe and read

```bash
./studio transcribe <key> cam                        # local, word-level, cached, language auto-detected
./studio transcript <key> cam --from 0 --to 120      # read in 60-120 s chunks
./studio transcript <key> cam --grep "the mistake"   # hunt a line
./studio transcript <key> cam --format srt           # compact | words | srt
```

- Word times are refined against the audio (raw ASR drifts 100-300 ms), but cut points still come from
  the measured gaps, never from the word starts.
- While reading, write down: the strongest lines (the hook), every name and number (caption overrides),
  the flubs and retakes, where the energy peaks.
- Never re-transcribe a cut timeline: word timings retime onto the edit automatically.

## 3. The edit

`films/<key>/edit.json` is the timeline as data. Author ops in seconds; every op is validated, atomic,
frame-snapped at the project's rational fps (30000/1001 is exact, not a float), undoable, and logged.
Never hand-edit the file: apply ops.

```bash
./studio edit <key> add --src cam --in 61.2 --out 64.9 --at 0 --note "cold open: strongest line"
./studio edit <key> trim --id c3 --out 63.1           # ripple by default: the track closes up
./studio edit <key> ripple-delete --id c7
./studio edit <key> speed --id c4 --speed 1.5         # audio stays locked, pitch-preserving
./studio edit <key> ops '[…]' --base-rev 12           # batch; a stale base-rev conflicts, never blind-write
./studio edit <key> undo / redo / show / sync
```

| op | keys |
|---|---|
| add | src, track, in, out, at, speed, note |
| trim / split / delete / ripple-delete / move / reorder | id (+ in, out, t, at, track, order) |
| speed / freeze | id, speed (0.1-16) / id, t, dur |
| volume / fade / xfade / jcut | id, db / id, in_ms, out_ms / a, b, ms / id, ms (audio leads or trails picture) |
| crop-keyframe / cam | §5 |
| color / lut | id, exposure, contrast, saturation, temperature / file (the grade; HDR→SDR is done at ingest) |
| overlay | action add/update/remove, type title, lower-third, callout, punch-in, text, logo, progress, speed-ramp, at, dur, props |
| caption-style | §4 |
| marker | t, label |
| snap (query) | t, to frames/cuts/beats/words |

Every automated cut runs **dry first** and lists its removed text so a human (or you) can veto:

```bash
./studio cut <key> silence              # prints CUT <from>-<to> <reason> removed: "…" — applies nothing
./studio cut <key> silence --apply
```

| kind | default | reads |
|---|---|---|
| silence | `--max-gap 0.5 --keep-breath 0.15` | cut pauses > 0.35-0.5 s, keep 0.12-0.2 s of breath |
| fillers | um/uh/er per language | "like"/"you know" off by default; `--also` to add |
| takes | `--window 20` | near-duplicate sentences: keep the last complete take |
| idle | `--max-idle 1` | frozen picture (screen recordings); `--speed-up --speed 4` speeds it instead, audio locked |
| tighten | `--target 45` | hit a duration, weak lines go first |

Read every proposal. Veto anything that changes meaning (check negations and numbers around the cut),
clips a word, or cuts a breath you wanted. After applying: `./studio edit <key> sync` (duration lands in
`film.json`), put the hook first as a cold open, then arrange.

## 4. Captions

Captions are design, not subtitles. Set them with the `caption-style` op; the style ladder lives in
`design.json` (a `captions` role).

- Three styles from the design system: **pop** (a plate behind the words, the current word in the accent),
  **typewriter** (words type in as spoken), **karaoke** (the current word fills with the accent).
  No default white-with-black-stroke, ever.
- One accent color, current word only. Big on vertical: nothing under 3.2u. At most 2 lines, broken at
  punctuation and pauses.
- The safe area per format (`L.safe`; vertical feeds cover the bottom ~14%): clear of platform UI and of
  the speaker's face. Lead the speech by ~50 ms; minimum on-screen time; reading-speed cap.
- Exact on names and numbers: `caption-style --overrides '[{"word":17,"text":"Studio"}]'` — fix what the
  ASR heard wrong; a wrong number is a broken deliverable.

```bash
./studio edit <key> caption-style --style pop
./studio look <key> --mode phone        # the 360 px readability test, every format
./studio captions <key> --format srt    # or vtt → out/captions.*
```

## 5. Reframe

One timeline exports 9:16, 1:1, 16:9 and 4:5. The camera is per format:

- **crop-keyframe** for deliberate moves: `./studio edit <key> crop-keyframe --id c2 --fmt 9:16 --t 0
  --cx 0.46 --cy 0.42 --zoom 1.0` — linear between keyframes, held outside. cx/cy are fractions of the
  source, zoom 1-8, t is clip-local seconds.
- **follow** for people: `./studio edit <key> cam --id c2 --mode follow` — subject tracking smoothed by a
  critically damped spring with a dead zone: it never jitters, it resets on cuts. The default for a
  talking head going vertical.
- **blurfill** when there is no track: the sharp clip over a blurred copy. `--mode center` is the default.

The subject stays inside the crop (the gates check ≥ 95% of frames); never crop outside the source.

## 6. Sound

Audio first: cut and clean sound before polishing picture.

- The dialog bus builds itself from the timeline: every trim, speed change, J/L offset and fade is
  honored to the sample, with 5-10 ms micro-fades at every seam. `./studio sound <key>` → `out/mix.wav`.
- Per-source cleanup (high-pass ~80 Hz, denoise, gentle compressor, limiter) runs at ingest; a hissy
  source is fixed there, not by hand.
- Music bed: `./studio ingest <key> song.mp3 --id bed` then `edit add --src bed --track A1`. It is ducked
  10-14 dB under speech (attack ~150 ms, release ~400 ms) — the dialog bus keys the sidechain, so the
  music never fights the voice. Fade it out at the end.
- -14 LUFS / -1 dBTP is the mixer's job, not yours: never hand-tune levels. Measure with `edit_audio`
  (loudness per second, waveform and spectrogram sheets) — you cannot listen.

## 7. The loop (never skip)

Each round:

1. `edit_status` / `film_status`: open notes from the GUI are timecoded user feedback — fix them first.
2. `edit_look` mode `cuts` — both sides of every cut, source timecodes on each frame; this is where
   edits break. Then `every`, then `phone` once captions and graphics exist. Hunt: flashes, framing
   jumps, clipped mouths, captions that pop.
3. `film_review` on the 7 keys with the edit meanings: hook = the first 2 s (strongest line, cold open);
   readability = captions legible at 360 px; motion = cut rhythm, overlay motion, seam quality;
   variety = a visual change every 2-4 s; composition = framing, headroom, reframe, safe zones;
   brand = brief + design.json fidelity; sound = dialog clarity, level, ducking, seams.
4. Fix the worst 3. Re-look only the affected seconds (`times`, `strip` across a seam).

Minimum 3 rounds; stop when every score is 8+ ("I would post this"). The last round is the `edit-critic`
subagent — fresh eyes that did not build the edit.

## 8. Craft rules

- Audio first: fix and trim sound before picture. Viewers forgive soft video, not bad audio.
- Cut on breath and between words, never inside one. Keep ~80-120 ms of room tone before a word after a
  cut and ~120-180 ms after the last word. Never change meaning with a cut (check negations and numbers).
- Mask jump cuts on a talking head by alternating framing (100% and ~108-115% punch-in) on every other
  cut. A visual change every 2-4 s (cut, punch-in, graphic, emphasized word); the hook in the first 2 s
  is the strongest line, cold open, no logo sting.
- Captions are where AI edits look cheap. No default white text with a black stroke: build 3 distinct
  styles from the design system, one accent color, large on vertical, clear of platform UI and of the
  speaker's face, exact on names and numbers.
- Titles and lower thirds only when they carry information; restraint over decoration. The banned looks
  in AGENTS.md apply to overlays too.
- Music: duck 10-14 dB under speech (attack ~150 ms, release ~400 ms), fade out at the end, never fight
  the voice. End on a held last frame or a CTA of at least 1.2 s unless a loop was requested.
- Defaults to propose: cut pauses longer than 0.35-0.5 s and keep 0.12-0.2 s of breath; fillers off by
  default for "like" and "you know"; for takes, near-duplicate sentences within ~20 s keep the last.
- Say what you removed: every automated cut list ships with the removed text so a human can veto it.

## 9. Delivery

```
./studio gate <key>              # edit gates: media + hashes, timeline integrity, seams, captions vs
                                 # transcript, loudness, dead air, deliverable probe. Fix every FAIL.
./studio render <key> --draft    # pacing check, seconds
./studio ship <key>              # sound → gates → final render all formats → sheets
./studio captions <key> --format srt
```

Report to the user: the deliverables (files, formats, durations), what was removed (seconds saved and
the removed text — it is all in the cut log), and the one thing to improve next. One thing, not a list.
