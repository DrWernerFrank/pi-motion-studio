# How GPS finds you — the script

## scene s01_hook: the question

[s01.1] No internet. No cell signal. And still, your phone knows where it is — to within a few meters — using satellites twenty thousand two hundred kilometers overhead.
[s01.2] The trick is a clock. More than thirty GPS satellites are overhead right now, each circling the Earth twice a day, and every one carries an atomic clock, broadcasting exactly what time it is.

## scene s02_delay: the measure

[s02.1] Your phone receives the signal a moment later, and measures the delay: about seven hundredths of a second — the twenty thousand kilometers, divided by the speed of light. {delay_marks}

## scene s03_formula: the distance

[s03.1] The signal travels at the speed of light, and distance equals that speed times the delay. {eq_shown}About twenty one thousand kilometers.

## scene s04_spheres: the geometry

[s04.1] One satellite gives one distance: a sphere around it. {sphere_grows}
[s04.2] Three spheres intersect in one point. {spheres_close}That is where you are.
[s04.3] Your phone's clock is not atomic, so a fourth satellite corrects it — solving position and time together. {fourth_draws}

## scene s05_recap: the payoff

[s05.1] Four satellites, one clock trick, and geometry: that is how GPS knows where you are.
