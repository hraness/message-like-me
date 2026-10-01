// PostCSS is supplied by Next. The published UI compiler supplies the union;
// there is no local CSS compiler, generated-class rewrite or runtime injection.
module.exports = function packageUnion(options) {
  let loaded;
  return {
    postcssPlugin: 'hraness-precompiled-package-union',
    async Once(root, { result, postcss }) {
      loaded ??= Promise.all([import('node:assert/strict'), import('node:path'), import('./stylex-package-union.mjs')])
        .then(async ([{ default: assert }, { resolve }, api]) => ({
          ...api, assert, resolve, union: await api.loadPackageUnion(options.root, options.packages),
        }));
      const { auditPackageStyles, assert, resolve, union } = await loaded;
      const from = resolve(result.opts.from);
      auditPackageStyles(root, union.manifests, from);
      if (from !== resolve(options.root, options.entry)) return;
      const imports = root.nodes.filter(node => node.type === 'atrule' && node.name === 'import');
      for (const name of options.packages) {
        const foundation = `${name}/compiler-foundation.css`;
        assert.equal(imports.filter(node => node.params === `'${foundation}'` || node.params === `"${foundation}"`).length,
          1, `The union entry must import ${foundation} exactly once.`);
      }
      for (const file of union.dependencies) result.messages.push({ type: 'dependency', plugin: 'hraness-precompiled-package-union', file, parent: from });
      root.append(postcss.parse(union.css, { from: undefined }).nodes);
    },
  };
};
module.exports.postcss = true;
