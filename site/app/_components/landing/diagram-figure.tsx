import { publicAssetExists } from './public-assets';

type Variant = Readonly<{ wide: string; narrow?: string }>;

// The diagrams lane exports `<name>-wide.<theme>@2x.png` plus an optional
// `<name>-narrow.<theme>@2x.png` (under 900 px), or one `<name>.<theme>@2x.png`.
function variant(name: string, theme: 'light' | 'dark'): Variant | undefined {
  const wide = `diagrams/${name}-wide.${theme}@2x.png`;
  if (publicAssetExists(wide)) {
    const narrow = `diagrams/${name}-narrow.${theme}@2x.png`;
    return publicAssetExists(narrow) ? { wide, narrow } : { wide };
  }
  const single = `diagrams/${name}.${theme}@2x.png`;
  return publicAssetExists(single) ? { wide: single } : undefined;
}

function Picture({ files, alt, className }: Readonly<{ files: Variant; alt: string; className: string }>) {
  return (
    <picture className={className}>
      {files.narrow === undefined ? null : <source media="(max-width: 899px)" srcSet={`/${files.narrow}`} />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt={alt} aria-hidden={alt === '' ? true : undefined} className="tb-diagram__img" decoding="async" loading="lazy" src={`/${files.wide}`} />
    </picture>
  );
}

/**
 * A diagram exported to public/diagrams, in light and dark, switching with the
 * page's Paper appearance. Renders nothing until the files exist, because the
 * surrounding copy already carries the same steps.
 */
export function DiagramFigure({ name, alt, caption }: Readonly<{ name: string; alt: string; caption?: string }>) {
  const light = variant(name, 'light');
  const dark = variant(name, 'dark');
  if (light === undefined) return null;
  return (
    <figure className="tb-diagram">
      {dark === undefined ? (
        <Picture alt={alt} className="tb-diagram__picture" files={light} />
      ) : (
        <>
          <Picture alt={alt} className="tb-diagram__picture tb-theme-light" files={light} />
          <Picture alt="" className="tb-diagram__picture tb-theme-dark" files={dark} />
        </>
      )}
      {caption === undefined ? null : <figcaption>{caption}</figcaption>}
    </figure>
  );
}
