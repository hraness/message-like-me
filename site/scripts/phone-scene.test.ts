import { expect, test } from 'bun:test';
import { evaluateScene } from '@hraness/textmockups/timeline';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { PhoneFit } from '@hraness/textmockups';
import { conversations } from '../app/_components/phone/conversations';
import { conversationScene, schedule, sideFor } from '../app/_components/phone/scene';

for (const conversation of Object.values(conversations)) {
  test(`${conversation.id} uses shared scenes in both themes and perspectives`, () => {
    for (const perspective of ['owner', 'contact'] as const) for (const theme of ['light', 'dark'] as const) {
      const scene = conversationScene(conversation, { perspective, theme });
      const { timed, end } = schedule(conversation, perspective);
      expect(scene.platform).toBe(conversation.app === 'whatsapp' ? 'whatsapp' : 'imessage');
      expect(scene.theme).toBe(theme);
      expect(scene.messages.map(message => message.id)).toEqual(timed.map(entry => entry.message.id));
      expect(scene.participants.find(person => person.isSelf)?.id).toBe(perspective === 'owner' ? 'owner' : 'contact');
      for (const [index, entry] of timed.entries()) {
        expect(scene.messages[index]?.senderId).toBe(entry.message.from === 'contact' ? 'contact' : 'owner');
        if (entry.message.from === 'butler' || sideFor(entry.message.from, perspective) === 'out') expect(entry.typingFrom).toBeUndefined();
        expect(evaluateScene(scene, entry.at).messages.map(message => message.id)).toContain(entry.message.id);
        if (entry.at > 0) expect(evaluateScene(scene, entry.at - 0.001).messages.map(message => message.id)).not.toContain(entry.message.id);
      }
      expect(evaluateScene(scene, end + 1).messages).toHaveLength(timed.length);
      const html = renderToStaticMarkup(createElement(PhoneFit, { scene, watermark: false }));
      expect(html).toContain('data-textmock-phone');
      expect(html).toContain(`data-platform="${scene.platform}"`);
      expect(html).not.toContain('data-textmock-watermark');
    }
  });
}
