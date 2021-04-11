// Copyright 2021 Canva Inc. All Rights Reserved.

import * as bim from "builtin-modules";
import {
  CachedInputFileSystem,
  NodeJsInputFileSystem,
  ResolverFactory,
} from "enhanced-resolve";
import * as fg from "fast-glob";
import * as fs from "fs";
import * as path from "path";
import { FileProcessor } from "./file_processor";
import { debug as logger } from "./logger";
import { CssFileProcessor } from "./processors/css";
import { TSDirectiveProcessor } from "./processors/directive";
import { TypeScriptFileProcessor } from "./processors/typescript";
import Resolver = require("enhanced-resolve/lib/Resolver");
import SyncAsyncFileSystemDecorator = require("enhanced-resolve/lib/SyncAsyncFileSystemDecorator");
import { AbstractInputFileSystem } from "enhanced-resolve/lib/common-types";

// This is a set of built-in modules, e.g. `path`, `fs`, etc.
const builtinModules = new Set(bim);
const info = logger.extend("info");
const error = logger.extend("error");
const debug = logger.extend("debug");

export type Path = string;
export type FileToDeps = Map<Path, Set<Path>>;

export type ResolverOptionsGenerator = () => Partial<ResolverFactory.ResolverOption>;

/**
 * If reference is a glob pattern (for example `./foo/*.ts`), this function should transform to
 * the list of files, such as `['./foo/bar.ts', './foo/baz.ts']`.
 */
export type ReferenceTransformFn = (
  reference: string,
  sourceFile: string
) => string[] | string;

export class DependencyTree {
  private readonly fileProcessors: FileProcessor[] = [];

  /**
   * @param rootDirs The root directories to search for files to build the dependency tree
   * @param resolver A resolver to be used for resolving references between files
   * @param ignoreGlobs An array of glob patterns that will be use to exclude files from the
   *     dependency tree on match
   * @param transformReference A function that can be used to transform a reference into a
   *     different path
   */
  constructor(
    private readonly rootDirs: Path[],
    private readonly resolver = DependencyTree.createResolver(),
    private readonly ignoreGlobs: string[] = ["**/node_modules/**"],
    public readonly transformReference: ReferenceTransformFn = (ref) => ref
  ) {
    for (const dir of this.rootDirs) {
      this.addFileProcessor(new TypeScriptFileProcessor(dir));
    }
    this.addFileProcessor(new CssFileProcessor());
    this.addFileProcessor(new TSDirectiveProcessor());
  }

  /**
   * Returns dependencies (and transitive dependencies) of a given set of files
   *
   * @param fileToDeps A mapping between files and their dependencies
   * @param files The files to get dependencies of
   * @returns Any file (indirectly) depending on the given files
   */
  public static getDependencies(
    fileToDeps: FileToDeps,
    files: Path[]
  ): Set<Path> {
    const graph = new DirectedGraph(fileToDeps);
    return DependencyTree.findRelatedFiles(graph, files);
  }

  /**
   * Returns references (and transitive references) to a given set of files
   *
   * @param fileToDeps A mapping between files and their dependencies
   * @param files The files to get references for
   * @returns Any file (indirectly) referencing the given files
   */
  public static getReferences(
    fileToDeps: FileToDeps,
    files: Path[]
  ): Set<Path> {
    // invert the graph because we are interested in the files that *reference* the entrypoint
    // files, rather than the files that the entrypoint files references (which is what
    // `DependencyTree.getDependencies` does)
    const graph = new DirectedGraph(fileToDeps).transpose();
    return DependencyTree.findRelatedFiles(graph, files);
  }

  /**
   * Walk a dependency graph to find all the files related to the entrypoint files. Removes the
   * entrypoints from the set of visited nodes since it does not make sense for a file to be
   * "related" to itself.
   *
   * @param graph the graph to walk
   * @param files the entrypoints to start the walk on
   */
  private static findRelatedFiles(graph: DirectedGraph<Path>, files: Path[]) {
    const visited = new Set<Path>();
    for (const referencingFile of graph.manyWalkDfs(files)) {
      visited.add(referencingFile);
    }

    // delete all the entrypoints since it does not make sense for a file to reference or
    // depend on itself
    for (const file of files) {
      visited.delete(file);
    }

    return visited;
  }

  /**
   * Creates a synchronous resolver
   *
   * @param generator
   * @returns the resolver
   */
  public static createResolver(
    generator: ResolverOptionsGenerator = () => ({})
  ): Resolver {
    const opts: ResolverFactory.ResolverOption = {
      ...generator(),
      fileSystem: (new SyncAsyncFileSystemDecorator(
        (new CachedInputFileSystem(
          new NodeJsInputFileSystem(),
          4000
        ) as unknown) as AbstractInputFileSystem
      ) as unknown) as AbstractInputFileSystem,
    };
    return ResolverFactory.createResolver(opts);
  }

  /**
   * Adds an additional file processor.
   * Processors are called in the order they were added.
   */
  public addFileProcessor(fileProcessor: FileProcessor): void {
    this.fileProcessors.push(fileProcessor);
  }

  /**
   * Walks through all found files and builds a map of their resolved dependencies
   * and a set of missing dependencies.
   * The map returned maps from a file (absolute path) to its referenced dependencies (absolute
   * paths)
   *
   * Built-in (Node) and package dependencies are ignored.
   */
  public async gather(): Promise<{
    missing: FileToDeps;
    resolved: FileToDeps;
  }> {
    const fileToDeps: FileToDeps = new Map();
    const missing: FileToDeps = new Map();
    const files = this.getFiles();
    info(`Found a total of ${files.length} source files`);

    for (const file of files) {
      info("Scanning %s", file);
      const importedFiles = await this.getImportedFiles(file, missing, files);
      fileToDeps.set(file, importedFiles);
    }

    return {
      missing,
      resolved: fileToDeps,
    };
  }

  /**
   * This resolves a referenced module and adds it to either the resolved files or the set of
   * non-existent dependencies
   *
   * @param file The file to resolve from (e.g. the file containing the reference)
   * @param referencedModule The module to resolve (e.g. the import/require target)
   * @param importedModules The set to add a module to that can be resolved
   * @param missingModules The map of sets to add a module to that can not
   *     be resolved
   */
  public resolveAndCollect(
    file: Path,
    referencedModule: string[] | string,
    importedModules: Set<Path>,
    missingModules: FileToDeps
  ): void {
    if (Array.isArray(referencedModule)) {
      for (const m of referencedModule) {
        this.resolveAndCollect(file, m, importedModules, missingModules);
      }
      return;
    }
    if (builtinModules.has(referencedModule)) {
      debug("%s is a built-in module, ignoring", referencedModule);
      return;
    }
    try {
      debug(
        "trying to resolve %s against %s via enhanced-resolve",
        referencedModule,
        file
      );
      const resolved = this.resolver.resolveSync(
        {},
        path.dirname(file),
        referencedModule
      );
      if (resolved) {
        importedModules.add(resolved);
        return;
      }
    } catch (e) {
      // We write the message to stderr but treat the module as missing
      error(e.message);
    }
    if (referencedModule) {
      error("Couldn't find: %o", referencedModule);
      const missingFileDeps = missingModules.get(file) || new Set<Path>();
      missingFileDeps.add(referencedModule);
      missingModules.set(file, missingFileDeps);
    }
  }

  /**
   * Returns all imported files for a given file
   *
   * @param file The file to get the imported files for
   * @param missing A set that will be populated with modules that couldn't be
   *     resolved
   * @param files All files found in this dependency run.
   * @returns {Set<string>}
   */
  private async getImportedFiles(
    file: Path,
    missing: FileToDeps,
    files: ReadonlyArray<Path>
  ) {
    const contents = fs.readFileSync(file, "utf8");

    const allImported = new Set<Path>();
    let matched = false;
    for (const fileProcessor of this.fileProcessors) {
      if (fileProcessor.match(file)) {
        matched = true;
        const importedFiles = await fileProcessor.process(
          file,
          contents,
          missing,
          files,
          this
        );
        for (const imported of Array.from(importedFiles)) {
          allImported.add(imported);
        }
      }
    }
    if (!matched) {
      /* istanbul ignore next */
      throw new Error(`No file processor matches ${file}`);
    }

    return allImported;
  }

  /**
   * Globs all supported files from the {rootDirs}
   *
   * @returns {string[]} An array of found files (absolute paths)
   */
  private getFiles(): readonly Path[] {
    const supportedFileTypes = new Set(
      this.fileProcessors.reduce(
        (acc, processor) => [...acc, ...processor.supportedFileTypes()],
        []
      )
    );
    return this.rootDirs.reduce<Path[]>((acc: string[], rootDir) => {
      return acc.concat(
        fg.sync(`**/*.{${Array.from(supportedFileTypes).join(",")}}`, {
          cwd: rootDir,
          ignore: this.ignoreGlobs,
          absolute: true,
        })
      );
    }, []);
  }
}

/**
 * Directed graph. Internally represented using the edges of the graph. For example, the following
 * directed graph:
 *
 * <pre>
 *        +-> b --> c
 *    a --|
 *        +-> d
 * </pre>
 *
 * Can be represented using the following sequence of pairs, representing each of the edges in the
 * graph:
 *
 * <pre>
 *   (a, b)
 *   (a, d)
 *   (b, c)
 * </pre>
 */
class DirectedGraph<T> {
  constructor(private readonly edges: Map<T, Set<T>>) {}

  /**
   * Computes the transpose of the dependency graph & return a graph of files to referencing files.
   *
   * Visualise this transformation as a reversal of all (directed) edges in the graph, e.g. from
   * this
   *
   * <pre>
   *       +-> b --> c
   *   a --|
   *       +-> d
   * </pre>
   *
   * to this
   *
   * <pre>
   *   c --> b --+
   *             |-> a
   *         d --+
   * </pre>
   *
   * @param fileToDeps the graph to invert
   */
  transpose(): DirectedGraph<T> {
    const invertedEdges = new Map<T, Set<T>>();

    for (const [node, endpointNodes] of this.edges) {
      for (const endpointNode of endpointNodes) {
        if (invertedEdges.has(endpointNode)) {
          assertNonNull(
            invertedEdges.get(endpointNode),
            "expected outNodes to not be null"
          ).add(node);
        } else {
          invertedEdges.set(endpointNode, new Set([node]));
        }
      }
    }

    return new DirectedGraph(invertedEdges);
  }

  /**
   * Perform multiple depth-first walks of the graph, starting each walk at one of the provided
   * entrypoints.
   *
   * @param entrypoints start points for each of the depth-first walks
   */
  *manyWalkDfs(entrypoints: readonly T[]): IterableIterator<T> {
    const visited = new Set<T>();
    for (const entrypoint of entrypoints) {
      yield* this.walkDfs(entrypoint, visited);
    }
  }

  /**
   * Walk the graph in a depth-first manner.
   *
   * @param entrypoint the starting node for the walk
   * @param visited the nodes that have already been visited. injected to ensure that nodes are only
   *        visited once across multiple walks
   */
  private *walkDfs(entrypoint: T, visited = new Set<T>()): IterableIterator<T> {
    const toVisit = new Stack<T>();
    toVisit.add(entrypoint);

    while (!toVisit.isEmpty()) {
      const node = toVisit.next();
      if (visited.has(node)) {
        continue;
      }

      yield node;
      visited.add(node);

      const outNodes = this.edges.get(node);
      if (outNodes) {
        toVisit.addMany(outNodes);
      }
    }
  }
}

/** O(1) unbounded stack ADT */
class Stack<T> {
  private readonly stack: T[] = [];

  add(val: T): void {
    this.stack.push(val);
  }

  addMany(vals: Iterable<T>): void {
    for (const val of vals) {
      this.add(val);
    }
  }

  next(): T {
    return assertNonNull(this.stack.pop(), "tried to pop from an empty stack");
  }

  isEmpty(): boolean {
    return this.stack.length === 0;
  }
}

function assertNonNull<T>(val: T | undefined | null, message: string): T {
  if (val == null) {
    throw new Error(message);
  }
  return val;
}
