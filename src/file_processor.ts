// Copyright 2021 Canva Inc. All Rights Reserved.

// tslint:disable-next-line interface-name
import { DependencyTree, FileToDeps, Path } from "./index";

export interface FileProcessor {
  /**
   * Should return true if this processor wants to process the given file
   */
  match(file: Path): boolean;

  /**
   * The supported file types by this processor.
   * This is used to initially pick up files via a glob.
   * No leading dot.
   * TODO: Joscha: unify this with the matcher
   */
  supportedFileTypes(): string[];

  /**
   * Finds files that are imported from a given file that is a supported file type by this
   * FileProcessor instance
   *
   * @param file The file path to inspect for referenced modules (real path)
   * @param contents The file contents
   * @param missing A map of sets that can be populated with modules that couldn't be
   *     resolved
   * @param files All files detected in this dependency run. Real paths.
   * @param dependencyTree A DependencyTree instance
   * @returns {Set<Path>} All files that are imported from this file
   */
  process(
    file: Path,
    contents: string,
    missing: FileToDeps,
    files: ReadonlyArray<Path>,
    dependencyTree: DependencyTree
  ): Promise<Set<Path>>;
}

export { TypeScriptFileProcessor } from "./processors/typescript";
export {
  FeatureFileProcessor,
  StorybookExtractorFn,
} from "./processors/feature";
