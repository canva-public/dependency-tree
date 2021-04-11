// Copyright 2021 Canva Inc. All Rights Reserved.

import * as fs from 'fs';
import * as memoizeFs from 'memoize-fs';
import * as os from 'os';
import * as path from 'path';
import * as ts from 'typescript';
import { CompilerOptions } from 'typescript';
import { DependencyTree, FileToDeps, Path } from '../';
import { FileProcessor } from '../file_processor';
import { debug as logger } from '../logger';
import memoize = require('lodash.memoize');
import { name, version } from '../../package.json';

// this memoizes function invocations with a cache on disk so caching works across invocations of
// the script, not just the function.
// we use the version of the package to scope the cache. This has the downside that on version bump
// we purge the cache but will hopefully prevent someone from using this memoizer and store things
// in it that need to be kept stable across versions
const memoizer = memoizeFs({
  cachePath: path.join(os.tmpdir(), name, version),
});

const tsLogger = logger.extend('ts');
const debug = tsLogger.extend('debug');
const info = tsLogger.extend('info');
const error = tsLogger.extend('error');

const reEntryPoint = /\.entry\.ts$/;

type ResolveModuleNameFn = (
  moduleName: string,
  containingFile: string,
  compilerOptions: ts.CompilerOptions,
) => Promise<ts.ResolvedModuleWithFailedLookupLocations>;

export class TypeScriptFileProcessor implements FileProcessor {
  private static memoizerCacheId = 'resolveModuleName';

  protected readonly compilerOptions: ts.CompilerOptions;
  private reExt: RegExp;
  private reRootDir: RegExp;
  private resolveModuleName: Promise<ResolveModuleNameFn>;

  constructor(private readonly rootDir: string) {
    // We do pre-compilation of RegExp because it seems to be the fastest way to match file paths.
    this.reExt = new RegExp(
      `\\.(${this.supportedFileTypes().join('|')})$`,
      'i',
    );
    this.reRootDir = new RegExp(`^${rootDir}`, 'i');
    this.compilerOptions = this.getTsCompilerOptions(rootDir);
    this.resolveModuleName = memoizer.fn(
      TypeScriptFileProcessor.resolveModuleName,
      {
        cacheId: TypeScriptFileProcessor.memoizerCacheId,
        // By default, `memoize-fs` returns `undefined` when trying to read an invalid cache
        // file. ("invalid" in this case is anything that cannot be parsed using `JSON.parse`).
        // Enabling this forces the memoized function to be re-run when the cache file is invalid.
        retryOnInvalidCache: true,
      },
    );
  }

  private static resolveModuleName(
    moduleName: string,
    containingFile: string,
    compilerOptions: ts.CompilerOptions,
  ) {
    return ts.resolveModuleName(
      moduleName,
      containingFile,
      compilerOptions,
      ts.sys,
    );
  }

  // Checks if the file path matches entry points file name pattern
  static isEntryPointFileName(file: string): boolean {
    return reEntryPoint.test(file);
  }

  // Creates an AST from the given file path
  static async createTSSourceFile(
    filePath: Path,
    target: ts.ScriptTarget = ts.ScriptTarget.ES2015,
  ): Promise<ts.SourceFile> {
    const source = await fs.promises.readFile(filePath, 'utf8');
    return ts.createSourceFile(filePath, source, target);
  }

  public async process(
    file: Path,
    contents: string,
    missing: FileToDeps,
    files: ReadonlyArray<Path>,
    dependencyTree: DependencyTree,
  ): Promise<Set<Path>> {
    const importedFiles = new Set<Path>();
    const filesList = ts
      .preProcessFile(contents, true, true)
      .importedFiles.map(({ fileName }) => fileName);
    if (TypeScriptFileProcessor.isEntryPointFileName(file)) {
      filesList.push(TypeScriptFileProcessor.getEntryPointImport(file));
    }

    for (const fileName of filesList) {
      const referencedFile = dependencyTree.transformReference(fileName, file);
      if (Array.isArray(referencedFile)) {
        throw new Error(
          `No support glob import in TS, file ${file}, import from ${fileName}`,
        );
      }
      // try to resolve via TS first
      debug('trying to resolve %s against %s via TS', referencedFile, file);
      const resolver = await this.resolveModuleName;

      const tsResolve:
        | ts.ResolvedModuleWithFailedLookupLocations
        | undefined = await resolver(
        referencedFile,
        file,
        this.compilerOptions,
      );
      if (tsResolve == null) {
        throw new Error(
          'nullish tsResolve value from memoized function. Expected result to always be non-nullish',
        );
      }

      if (tsResolve.resolvedModule) {
        if (!tsResolve.resolvedModule.isExternalLibraryImport) {
          importedFiles.add(tsResolve.resolvedModule.resolvedFileName);
        }
      } else {
        // and if that didn't work, fall back to enhanced-resolve
        dependencyTree.resolveAndCollect(
          file,
          referencedFile,
          importedFiles,
          missing,
        );
      }
    }

    if (file.endsWith('.tests.ts') || file.endsWith('.tests.tsx')) {
      debug('%s is a test, so we see if there is a snapshot file', file);
      const allegedTestFile = path.join(
        path.dirname(file),
        '__snapshots__',
        path.basename(file) + '.snap',
      );
      if (fs.existsSync(allegedTestFile)) {
        info('Marking %s as an import from %s', allegedTestFile, file);
        importedFiles.add(allegedTestFile);
      }
    }

    return Promise.resolve(importedFiles);
  }

  public match(file: Path): boolean {
    return this.reExt.test(file) && this.reRootDir.test(file);
  }

  public supportedFileTypes(): string[] {
    return ['ts', 'tsx'];
  }

  /**
   * Extracts the TS compiler options from the {rootDir}
   */
  private getTsCompilerOptions: (rootDir: string) => CompilerOptions = memoize(
    (rootDir: string) => {
      const tsConfigPath = path.join(rootDir, 'tsconfig.json');
      const tsOptionsJson = ts.readConfigFile(tsConfigPath, ts.sys.readFile);
      return ts.parseJsonConfigFileContent(
        tsOptionsJson.config,
        ts.sys,
        path.dirname(tsConfigPath),
      ).options;
    },
  );

  // Finds an implicit 'import' in the entry point object literal, like:
  //
  //    export const entryPoint: DynamicEntryPoint = {
  //      file: './main', // <-- an implicit 'import'
  //      // ...  another properties
  //    };
  //
  // TODO(joscha,toby) This can be fixed/simplified in the future by not allowing a custom
  // main file and always using the convention `./main`. That way we know what to resolve
  // without having to load the entrypoint file itself.
  private static getEntryPointImport(file: string): string {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      return require(file).entryPoint.file;
    } catch (e) {
      error(
        `Malformed entry point: '${file}'. Make sure that this entry point does follow the convention.`,
      );
      throw e;
    }
  }
}
