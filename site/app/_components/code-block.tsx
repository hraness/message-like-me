import { MarketingProofFrame, SyntaxCode } from '@hraness/design-kit/react/server';

export function CodeBlock({ code, language = 'shell' }: Readonly<{ code: string; language?: string }>) {
  const content = <pre className="tb-code" tabIndex={0}><SyntaxCode code={code} language={language} styles="classes" /></pre>;
  return ['shell', 'sh', 'bash', 'console'].includes(language)
    ? <MarketingProofFrame className="tb-code-frame" title="Terminal">{content}</MarketingProofFrame>
    : content;
}
