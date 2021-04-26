# @canva-public/dependency-tree

[![build](https://github.com/canva-public/dependency-tree/actions/workflows/node.js.yml/badge.svg)](https://github.com/canva-public/dependency-tree/actions/workflows/node.js.yml)
[![npm](https://img.shields.io/npm/v/@canva-public/dependency-tree.svg)](https://www.npmjs.com/package/@canva-public/dependency-tree)

This package can create a dependency tree from a given set of files/folders.
The nodes of the tree are files and the edges are file -> file dependencies.
The most common way to express such a dependency between two files is some sort of import statement (`require()`, `import ... from`, `@import`) or a directive.

It provides an extensible API for file processors to generate this dependency tree and comes with a few of them out of the box:

- CSS (postcss dialect, via [`detective-postcss`](https://www.npmjs.com/package/detective-postcss))
- Gherkin (`*.feature`, via [`gherkin`](https://www.npmjs.com/package/gherkin))
- JavaScript (via [`acorn`](https://www.npmjs.com/package/acorn) and [`esquery`](https://www.npmjs.com/package/esquery))
- TypeScript (via [`typescript`](https://www.npmjs.com/package/typescript))
- [Directives](./docs/directive.md) (custom comment directives to express cross-file dependencies)

It has support for custom resolvers using [`enhanced-resolve`](https://www.npmjs.com/package/enhanced-resolve) and dynamic reference transformation.
It has built-in file caching and test coverage is ~80%+.

# Usage

```ts
const dependencyTree = new DependencyTree(['/path/to/my/dir']);
const {
  missing, // a map from files in any of the given root directories to their (missing) dependencies
  resolved, // a map from files in any of the given root directories to their dependencies
} = await dependencyTree.gather();

// we can now get set of (transitive) references to a file
const directOrTransitiveReferences = DependencyTree.getReferences(resolved, [
  '/path/to/my/dir/file.ts',
]);

// or we can get the set of (transitive) dependencies of a file
const directOrTransitiveDependencies = DependencyTree.getDependencies(
  resolved,
  ['/path/to/my/dir/file.ts'],
);
```

# Use cases

- Visualisation of (epxlicit and implicit) in-code dependencies
- Identifying build targets that need to be regenerated based on affected code

## Releasing

- Bump the version of `package.json` to a meaningful version for the changes since the last release (we follow semver).
- To do a dry-run of the release and what would go out in the package you can manually execute the [npm-publish](https://github.com/canva-public/dependency-tree/actions/workflows/npm-publish.yml) workflow on the `main` branch. It will do a dry-run publish (not actually publish the new version).
- Draft a new release in the github project - please use a tag named `vX.X.X` (where `X.X.X` is the new to-be-releases semver of the package - please add as many detail as possible to the release description.
- Once you're ready, `Publish` the release. Publishing will trigger the [npm-publish](https://github.com/canva-public/dependency-tree/actions/workflows/npm-publish.yml) workflow on the tag and do the actual publish to npm.
