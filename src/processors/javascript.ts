import * as path from 'path';
import * as acorn from 'acorn';
import * as esquery from 'esquery';
import type { Node } from 'estree';
import { DependencyTree, FileToDeps, Path } from '..';
import { FileProcessor } from '../file_processor';

export function extractJsImports(content: string): Set<string> {
  const imports = new Set<string>();
  const node = acorn.parse(content, {
    sourceType: 'module',
    allowHashBang: true,
    ecmaVersion: 'latest',
  }) as Node;
  const importNodes = esquery(node, 'ImportDeclaration');
  importNodes.forEach((node) => {
    if (
      node.type === 'ImportDeclaration' &&
      node.source.type === 'Literal' &&
      typeof node.source.value === 'string'
    ) {
      imports.add(node.source.value);
    }
  });
  const requireNodes = esquery(node, 'CallExpression[callee.name="require"]');
  requireNodes.forEach((node) => {
    if (
      node.type === 'CallExpression' &&
      node.arguments.length === 1 &&
      node.arguments[0].type === 'Literal' &&
      typeof node.arguments[0].value === 'string'
    ) {
      imports.add(node.arguments[0].value);
    }
  });
  return imports;
}

export class JavascriptFileProcessor implements FileProcessor {
  match(file: Path): boolean {
    const ext = path.extname(file);
    return ext === '.js' || ext === '.cjs' || ext === '.mjs';
  }

  supportedFileTypes(): string[] {
    return ['js', 'cjs', 'mjs'];
  }

  /**
   * @inheritDoc
   */
  process(
    file: Path,
    contents: string,
    missing: FileToDeps,
    files: ReadonlyArray<Path>,
    dependencyTree: DependencyTree,
  ): Promise<Set<Path>> {
    // TODO: change
    const importedFiles = new Set<Path>();
    const referencedFiles = new Set<Path>(extractJsImports(contents));
    referencedFiles.forEach((referencedFile) => {
      dependencyTree.resolveAndCollect(
        file,
        dependencyTree.transformReference(referencedFile, file),
        importedFiles,
        missing,
      );
    });
    return Promise.resolve(importedFiles);
  }
}
