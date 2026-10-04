#set page(width: auto, height: auto, margin: 0pt, fill: none)
#set text(size: 10pt)
#let manimgrp(lbl, body) = [#box(body) #label(lbl)]
$  manimgrp("p1", k^2)  -  manimgrp("p2", (k - 1)^2)   manimgrp("p3", =)   manimgrp("p4", (2 k - 1))  $
