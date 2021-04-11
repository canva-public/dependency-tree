import { extractJsImports } from '../../src/processors/javascript';

describe('extractJsImports', () => {
  it('recognize import', () => {
    expect.hasAssertions();
    const importPaths = extractJsImports('import "foo";');
    expect(importPaths).toStrictEqual(new Set(['foo']));
  });

  it('recognize require', () => {
    expect.hasAssertions();
    const importPaths = extractJsImports('const bz = require("bar");');
    expect(importPaths).toStrictEqual(new Set(['bar']));
  });

  it('allow shebang', () => {
    expect.hasAssertions();
    const importPaths = extractJsImports('#!/usr/bin/env node');
    expect(importPaths).toStrictEqual(new Set([]));
  });
});
