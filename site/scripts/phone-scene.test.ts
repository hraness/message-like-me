import { expect, test } from 'bun:test';
import { Glob } from 'bun';
import { readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { conversations } from '../app/_components/phone/conversations';
import { expectPhoneScene } from './phone-scene-assertions';

for (const conversation of Object.values(conversations)) {
  test(`${conversation.id} uses shared scenes in both themes and perspectives`, () => expectPhoneScene(conversation));
}

test('site source imports stay inside its Vercel deployment root', () => {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const violations: string[] = [];
  for (const file of new Glob('{app,scripts}/**/*.{ts,tsx,mts,js,mjs}').scanSync(root)) {
    const path = resolve(root, file);
    for (const imported of ts.preProcessFile(readFileSync(path, 'utf8'), true, true).importedFiles) {
      if (!imported.fileName.startsWith('.')) continue;
      const target = relative(root, resolve(dirname(path), imported.fileName));
      if (target === '..' || target.startsWith(`..${sep}`)) violations.push(`${file}: ${imported.fileName}`);
    }
  }
  expect(violations).toEqual([]);
});
