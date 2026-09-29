/**
 * The film's product surfaces. They are the site's own mockup components
 * (site/app/mockups and the phone mock), laid out on one desk the camera
 * moves across. Illustration only: every person is made up and third-party
 * apps are drawn without their names or marks.
 */
import { heroConversation, PhoneMock } from "../site/app/_components/phone/index.ts";
import { DraftMockup, MarkerMockup } from "../site/app/mockups/surfaces.tsx";
import { WRITERS } from "../site/app/mockups/samples.ts";
import { TerminalFrame } from "@hraness/design-kit/mockups";

/** The local reply writer, the one the site recommends first. */
const local = WRITERS[0]!;

/** One desk: the phone on the left, the Mac's side on the right. */
export function ProductMockup() {
  return (
    <div className="tbf-desk" data-film="desk">
      <div className="tbf-desk__phone" data-film="phone">
        <PhoneMock conversation={heroConversation} maxWidth={420} screenHeight={760} />
      </div>
      <div className="tbf-desk__mac">
        <div data-film="marker"><MarkerMockup /></div>
        <div data-film="writer">
          <TerminalFrame
            describe={`Illustration: ${local.where}`}
            lines={[...local.commands.map((text) => ({ kind: "input" as const, text })), { kind: "comment" as const, text: local.where }]}
            title="Terminal"
          />
        </div>
        <div data-film="draft"><DraftMockup /></div>
        <p className="tbf-note">Illustration. The people are made up.</p>
      </div>
    </div>
  );
}

const OPEN_TEXTS = [
  ["Maya", "are we still on for tomorrow?"],
  ["Jonah", "what was the name of that place?"],
  ["Mum", "did you see my message?"],
  ["Priya", "can you send me the address again"],
  ["Leo", "what time did we say?"],
  ["Ana", "quick question when you get a sec"],
] as const;

/** A small incoming text for the cold open. Names are made up. */
export function OpenCard({ index }: { index: number }) {
  const [name, text] = OPEN_TEXTS[index % OPEN_TEXTS.length]!;
  return (
    <div className="fm-card">
      <span className="fm-avatar" aria-hidden="true">{name[0]}</span>
      <div>
        <b>{name}</b>
        <p>{text}</p>
      </div>
    </div>
  );
}
