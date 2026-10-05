#set page(width: auto, height: auto, margin: 0pt, fill: none)
#set text(size: 10pt)
#let manimgrp(lbl, body) = [#box(body) #label(lbl)]
$  lim_(h -> 0)  manimgrp("p1", ((x + h)^2 - x^2)/h)   manimgrp("p2", =)  2 x  $
