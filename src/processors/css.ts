// Copyright 2021 Canva Inc. All Rights Reserved.

import * as postCssDetective from 'detective-postcss';
import { DependencyTree, FileToDeps, Path } from '../';
import { FileProcessor } from '../file_processor';
import { debug } from '../logger';

const logger = debug.extend('css');
const error = logger.extend('error');

export class CssFileProcessor implements FileProcessor {
  public async process(
    file: Path,
    contents: string,
    missing: FileToDeps,
    files: ReadonlyArray<Path>,
    dependencyTree: DependencyTree,
  ): Promise<Set<Path>> {
    const importedFiles = new Set<Path>();
    try {
      const referencedFiles = new Set<Path>(
        postCssDetective(contents, { url: true }),
      );
      referencedFiles.forEach((referencedFile) => {
        dependencyTree.resolveAndCollect(
          file,
          dependencyTree.transformReference(referencedFile, file),
          importedFiles,
          missing,
        );
      });
    } catch (e) {
      // We have a broken CSS file.
      // That doesn't mean our graph is incorrect, as it would also be broken in the browser.
      error('Error in %s when trying to parse CSS: %s', file, e.message);
    }
    return Promise.resolve(importedFiles);
  }

  public match(file: Path): boolean {
    return /\.css$/i.test(file);
  }

  public supportedFileTypes(): string[] {
    return ['css'];
  }
}
