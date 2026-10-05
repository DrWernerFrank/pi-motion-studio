#set page(width: auto, height: auto, margin: 0pt, fill: none)
#set text(size: 10pt)
#let manimgrp(lbl, body) = [#box(body) #label(lbl)]
$  manimgrp("p1", (k))   manimgrp("p2", +)   manimgrp("p3", (k - 1))   manimgrp("p4", =)   manimgrp("p5", (2 k - 1))  $
