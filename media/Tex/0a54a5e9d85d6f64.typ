#set page(width: auto, height: auto, margin: 0pt, fill: none)
#set text(size: 10pt)
#let manimgrp(lbl, body) = [#box(body) #label(lbl)]
$  manimgrp("p1", (a + b)^2)   manimgrp("p2", =)  a^2 + a b + b a + b^2  $
