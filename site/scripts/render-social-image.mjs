// Original Textbutler typography asset. Glyphs come from the pinned shared font.
import { readFile, writeFile } from 'node:fs/promises';
import fontkit from 'next/dist/compiled/@next/font/dist/fontkit/index.js';
import sharp from 'sharp';

const createFont = fontkit.default ?? fontkit;
const font = createFont(await readFile(new URL('../node_modules/@hraness/design-kit/src/fonts/nebula-sans/NebulaSans-Medium.woff2', import.meta.url)));
function lettering(value, x, y, size, fill = '#221f1d') {
  const run = font.layout(value);
  let advance = 0;
  const paths = run.glyphs.map((glyph, index) => {
    const position = run.positions[index];
    const path = `<path transform="translate(${advance + position.xOffset} ${position.yOffset})" d="${glyph.path.toSVG()}"/>`;
    advance += position.xAdvance;
    return path;
  }).join('');
  return `<g fill="${fill}" transform="translate(${x} ${y}) scale(${size / font.unitsPerEm} ${-size / font.unitsPerEm})">${paths}</g>`;
}
const iconBytes = await readFile(new URL('../app/icon.png', import.meta.url));
const icon = `<image x="80" y="60" width="64" height="64" href="data:image/png;base64,${iconBytes.toString('base64')}"/>`;
// The bubble reads 🤖{ 👀 }: braces from the shared font, emoji as white system-font silhouettes.
const bubble = `<g transform="translate(820 150)"><path d="M0 22C0 9.8 9.8 0 22 0H246C258.2 0 268 9.8 268 22V74C268 86.2 258.2 96 246 96H22C9.8 96 0 86.2 0 74Z" fill="#0a84ff"/><path d="M254 80c6 10 14 16 24 18-12 2-24-2-32-10z" fill="#0a84ff"/><text x="44" y="64" font-family="Apple Color Emoji, Noto Color Emoji, sans-serif" font-size="40" fill="#ffffff">🤖</text>${lettering('{', 104, 66, 46, '#ffffff')}<text x="140" y="64" font-family="Apple Color Emoji, Noto Color Emoji, sans-serif" font-size="40" fill="#ffffff">👀</text>${lettering('}', 212, 66, 46, '#ffffff')}</g>`;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><title>Textbutler: AI in your messages. A clearly marked assistant for iMessage, WhatsApp, and Beeper on Mac.</title><rect width="1200" height="630" fill="#f8f7f4"/>${icon}${lettering('Textbutler', 162, 107, 38)}${bubble}${lettering('AI in your', 80, 320, 96)}${lettering('messages.', 80, 420, 96)}${lettering('Say “butler” in a chat you’ve turned on. A clearly marked assistant answers.', 83, 478, 25, '#5c554f')}<path d="M80 525H1120" stroke="#d9d4cd"/>${lettering('textbutler.app', 80, 575, 26)}${lettering('iMessage, WhatsApp, and Beeper on Mac', 700, 575, 23, '#5c554f')}</svg>`;
await writeFile(new URL('../public/og.svg', import.meta.url), svg);
await sharp(Buffer.from(svg)).png().toFile(new URL('../public/og.png', import.meta.url).pathname);
