# Brand reel (point the reel at a product)

Make a dynamic 20-second motion graphics video for [PRODUCT] ([URL]), with the energy of a motion
designer's showreel. Go all out.

Assets
- `node engine/cli.mjs capture <film> [URL]`: real screenshots, logo, colors, fonts. List what you found
  before you animate. Never redraw the product UI from imagination: crop and animate the real thing.

Story (one beat each, 2 to 4 seconds)
1. Hook: the problem in 5 words of huge kinetic type.
2. The product appears; the UI assembles itself piece by piece.
3. Three features, each as a UI moment with a cursor doing a real action.
4. One number that proves it works: [METRIC].
5. Logo lockup + [CTA].

Sound: original music, 120 BPM, synthesized in code. UI clicks and whooshes on the beat.
Format: 1080x1920 (9:16) first, then 1:1 and 16:9 from the same timeline (layout from L, not pixels).
Before the full render, show me a contact sheet of one frame per beat.

Optional voice/mascot: a character who explains the product; the ElevenLabs key is ELEVENLABS_API_KEY
in .env (never paste a real key into a prompt).
