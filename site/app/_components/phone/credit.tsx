import styles from './phone.module.css';

/**
 * The quiet “Made with Textmock” credit under a phone mockup. The phones are
 * drawn by Textmock's open-source renderer; the plain followed link credits
 * textmock.com. Keep it outside crops, and out of exported stills and films.
 */
export function MockupCredit() {
  return (
    <p className={styles.credit}>
      <a href="https://textmock.com">Made with Textmock</a>
    </p>
  );
}
