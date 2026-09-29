# TextButler public site

The homepage is a Persuade surface; the documentation and legacy source catalog
are Read surfaces. Visitors should understand the intended Mac butler, inspect
its architecture, and see its development status without mistaking source
foundations or synthetic illustrations for a shipping message service.

Preserve the incumbent Hraness Design Kit marketing grammar and portable Paper
palette. The homepage opts into the immutable Design Kit v0.6.7 editorial preset
at `898d80364085a41c858350f1b492ac28b5a0384b`.
`styles/vendor/hraness-marketing/` is a complete checked snapshot; local
adaptations stay outside it. Component/UI versions and the Paper snapshot stay
unchanged. Documentation and preview surfaces do not opt into the preset.

Instrument Serif 400 is the landing display face. H1 uses the released
`clamp(2.75rem, 5.1vw, 4rem)`, 1.06 leading and -0.025em tracking; H2 uses
`clamp(2.4rem, 4vw, 3.25rem)`, 1.08 leading and -0.02em tracking. Nebula Sans
remains the body and documentation face; mono is reserved for filenames and
code. Body text is 16px, with a 17px desktop / 16px mobile lead.

The marketing wrapper includes the sticky header and page. Main measure is
70rem, header measure 76rem, gutters 32px on desktop and 20px on narrow screens,
and header height 72px before phone navigation wraps into a second row. The
landing header uses Lantern's 90% surface and 20px blur where supported, with opaque
accessibility fallbacks. Buttons use 4px corners and at least 44px phone targets.

Lantern v0.7.0 at `eccb0341d8d0ba960a0f02248cf59888062afb0a` is the
independent material layer. `styles/vendor/hraness-lantern/` is its immutable
five-file snapshot, checked alongside the existing palette and editorial preset.
The homepage alone opts in. Warm transmitted light and square glass seams sit
behind the opening copy and synthetic product frame. The message frame stays
opaque; expanded questions use warm paired paint and ink. Native reduced
transparency and forced colors remove decorative effects. No material is applied
to logos, documentation, or the inert preview. Paper retains its
incoming/outgoing bubble colors, links and focus.

The opening leads with the outcome, “AI in your messages.”, beside a coded
iPhone-class phone (`app/_components/phone/`) showing one synthetic iMessage
exchange: a friend says “butler”, the butler sends `🤖{ 👀 }`, then a marked
reply drawn only from that chat's visible history. The phone is a drawing, not
a screenshot; it carries a caption and hairline callouts outside the device.
Butler bubbles are never preceded by typing dots, and no example recalls another
chat, invents the owner's whereabouts, or promises a skipped request later.

`SITE_STATUS` renders once, directly under the hero. The page then runs: How it
works (the D1 diagram, seven steps, and the three reply modes); What it works
with (messaging apps and the Mac, each limit beside its feature); Pick what
writes replies (three cards with a status chip, one command, and what leaves the
Mac, then the precedence note and the D2 diagram); Setup (three steps, the agent
prompt with a Copy button, the D3 diagram, the manual guided-terminal frame and
the JSON command line); You stay in charge (three pillars with synthetic
WhatsApp and Beeper examples and the contact folder); Ask it yourself; FAQ; and a
closing call to action. Diagrams come from `public/diagrams/` in light and dark,
wide and narrow, and a slot renders nothing until its file exists. The launch
film slot works the same way with `public/launch/`. A setup skill, a one-line
installer, and signed distribution remain unavailable and are said so beside
the setup steps; synthetic tests do not establish live account delivery.

The website remains informational. No message or contact collection, sign-in,
agent execution, live dashboard, or signed app download is present. Historical
Message Like Me artifacts keep their immutable coordinates and are explicitly
labeled legacy. Their history source support does not imply TextButler transport
support.

At narrow widths, the phone, the support blocks, the reply-writer cards, and the
setup steps stack in reading order, with no horizontal page scroll. Links keep visible focus and underlines in prose. Shared FAQ
controls retain keyboard operation. Frames contain no fabricated live controls.
The social image is an original, code-generated typographic asset, with its SVG
source retained beside the PNG.
