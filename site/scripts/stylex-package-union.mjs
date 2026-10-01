import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { realpath } from 'node:fs/promises';
import { join } from 'node:path';
import {
  auditCssWithoutStylexUnionNamespace,
  readStylexPackageManifest,
  serializeStylexRuleUnionV1,
} from '@hraness/ui/stylex-build';

// The shared compiler owns parsing, manifest/artifact checks and serialization.
// This adapter only selects the installed precompiled packages for a site.
export async function loadPackageUnion(root, names) {
  assert.ok(names.length > 0 && new Set(names).size === names.length, 'List each StyleX package once.');
  const require = createRequire(join(root, 'package.json'));
  const packages = await Promise.all(names.map(async name => {
    const directory = await realpath(join(root, 'node_modules', name));
    const manifestPath = await realpath(require.resolve(`${name}/stylex-manifest.json`));
    const manifest = await readStylexPackageManifest(manifestPath, directory);
    assert.equal(manifest.package.name, name, 'StyleX package identity must match the configured import.');
    const foundation = await realpath(require.resolve(`${name}/compiler-foundation.css`));
    // Design Kit's full foundation imports its smaller declared palette
    // foundation. Both entries are explicitly bound by the package manifest.
    assert.ok(manifest.stylesheets.some(artifact => join(directory, artifact.path) === foundation),
      'Use a manifest-bound compiler foundation entry.');
    return { manifest, dependencies: [manifestPath, join(directory, 'package.json'),
      ...[...manifest.buildTools, ...manifest.runtime, manifest.standaloneCss, ...manifest.stylesheets]
        .map(artifact => join(directory, artifact.path))] };
  }));
  const manifests = packages.map(item => item.manifest);
  return {
    manifests,
    css: serializeStylexRuleUnionV1(manifests.flatMap(item => item.rules), manifests.map(item => item.standaloneSerializer)),
    dependencies: [...new Set(packages.flatMap(item => item.dependencies))],
  };
}

export function auditPackageStyles(root, manifests, name) {
  auditCssWithoutStylexUnionNamespace(root.toString(), name);
  const prefixes = manifests.map(item => item.standaloneSerializer.prefix);
  root.walkAtRules(rule => {
    if (rule.name === 'import') {
      assert.ok(!/(?:^|\/)stylex\.css(?:["'\s;?]|$)/u.test(rule.params)
        && !manifests.some(item => rule.params.includes(`${item.package.name}/styles.css`)
          || rule.params.includes(`${item.package.name}/palettes.css`)),
      'Use compiler foundations instead of standalone recipe imports.');
    }
    if (rule.name !== 'layer') return;
    // PostCSS owns the AST. Accept canonical layer names so escaping cannot
    // conceal a copied package priority layer from this small delivery guard.
    assert.ok(!rule.params.includes('\\'), 'Use canonical CSS layer names.');
    const parents = [];
    for (let parent = rule.parent; parent; parent = parent.parent) {
      if (parent.type === 'atrule' && parent.name === 'layer') parents.unshift(parent.params.trim());
    }
    for (const declared of rule.params.split(',')) {
      const layer = [...parents, declared.trim()].join('.');
      assert.ok(!prefixes.some(prefix => layer.startsWith(`${prefix}.priority`)),
        'Do not load independently serialized recipe layers beside the package union.');
    }
  });
}
