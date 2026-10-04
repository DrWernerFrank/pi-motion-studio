#set page(width: auto, height: auto, margin: 0pt, fill: none)
#set text(size: 10pt)
#let manimgrp(lbl, body) = [#box(body) #label(lbl)]
$  d/(d x) thin x^n  manimgrp("p1", =)   manimgrp("p2", n thin x^(n - 1))  $
