import { marked, type Conversation } from '../../site/app/_components/phone/conversations';

export const storyPhone: Conversation = {
  id: 'story-market',
  app: 'imessage',
  owner: { name: 'Sam', initial: 'S' },
  contact: { name: 'Alex', initial: 'A' },
  items: [
    { kind: 'header', id: 'today', day: 'Today', time: '9:41 AM' },
    { kind: 'message', id: 'question', from: 'contact', text: 'butler, when does the farmers market open on Saturday?' },
    { kind: 'message', id: 'reply', from: 'butler', text: marked('It opens at 8 a.m. on Saturday, by the fountain.') },
  ],
};
