import {
  assertTruthfulConversation,
  conversations,
  type Conversation,
} from './conversations';
import { PhoneMock } from './phone-mock';
import { PhoneMockPlayer } from './phone-mock-player';

/**
 * A review gallery of every conversation, in both appearances plus playback.
 * Not a public page: mount it from a temporary or noindex route to inspect the
 * mockup (the launch lane captured its screenshots this way).
 */
export function PhoneLab() {
  for (const conversation of Object.values(conversations)) assertTruthfulConversation(conversation);
  const tapbackSample: Conversation = {
    ...conversations.hero,
    id: 'tapback-sample',
    preset: 0,
    items: conversations.hero.items.map((item) =>
      item.kind === 'message' && item.id === 'm1' ? { ...item, reaction: { emoji: '❤️', from: 'contact' as const } } : item,
    ),
  };
  const cell = { display: 'grid', gap: 12, justifyItems: 'center' } as const;
  const caption = { font: '13px/1.4 var(--font-text, system-ui)', color: 'var(--muted, #666)', textAlign: 'center' as const, maxWidth: 360 };
  return (
    <div style={{ display: 'grid', gap: 56, padding: '40px 16px', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', maxWidth: 1400, margin: '0 auto' }}>
      <figure style={cell} id="hero-auto">
        <PhoneMockPlayer conversation={conversations.hero} />
        <figcaption style={caption}>Hero, playback, follows page theme.</figcaption>
      </figure>
      <figure style={cell} id="hero-light">
        <PhoneMock conversation={conversations.hero} theme="light" />
        <figcaption style={caption}>Hero · light</figcaption>
      </figure>
      <figure style={cell} id="hero-dark">
        <PhoneMock conversation={conversations.hero} theme="dark" />
        <figcaption style={caption}>Hero · dark</figcaption>
      </figure>
      <figure style={cell} id="hero-friend">
        <PhoneMock conversation={conversations.heroFriend} perspective="contact" />
        <figcaption style={caption}>Friend’s-eye view (video beat 3)</figcaption>
      </figure>
      <figure style={cell} id="ask-yourself">
        <PhoneMock conversation={conversations.askYourself} />
        <figcaption style={caption}>Ask it yourself · your own chat</figcaption>
      </figure>
      <figure style={cell} id="stays-out">
        <PhoneMock conversation={conversations.staysOut} />
        <figcaption style={caption}>It stays out of it · WhatsApp</figcaption>
      </figure>
      <figure style={cell} id="boundaries">
        <PhoneMock conversation={conversations.boundaries} />
        <figcaption style={caption}>It keeps your boundaries · via Beeper · text only</figcaption>
      </figure>
      <figure style={cell} id="tapback">
        <PhoneMock conversation={tapbackSample} />
        <figcaption style={caption}>Component capability only: a person’s tapback. The butler never sends tapbacks.</figcaption>
      </figure>
    </div>
  );
}
