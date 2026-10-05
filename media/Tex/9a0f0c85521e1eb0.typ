#set page(width: auto, height: auto, margin: 0pt, fill: none)
#set text(size: 10pt)
#let manimgrp(lbl, body) = [#box(body) #label(lbl)]
$  manimgrp("p1", (a + b)^2)   manimgrp("p2", =)   manimgrp("p3", a^2)  +  manimgrp("p4", 2 a b)  +  manimgrp("p5", b^2)  $
