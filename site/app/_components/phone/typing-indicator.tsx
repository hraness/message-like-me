import styles from './phone.module.css';

/**
 * The iOS "someone is typing" bubble. Only people type: never render this
 * before a butler message, because the Mac sends those without typing.
 */
export function TypingIndicator() {
  return (
    <div className={styles.typing} aria-hidden="true">
      <span className={styles.typingDot} />
      <span className={styles.typingDot} />
      <span className={styles.typingDot} />
      <span className={styles.typingTailLarge} />
      <span className={styles.typingTailSmall} />
    </div>
  );
}
