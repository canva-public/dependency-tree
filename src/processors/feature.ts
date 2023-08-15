// Copyright 2021 Canva Inc. All Rights Reserved.

import { messages } from 'cucumber-messages';
import * as gherkin from 'gherkin';
import escapeRegExp = require('lodash.escaperegexp');
import * as path from 'path';
import * as ts from 'typescript';
import { FileToDeps, Path } from '../';
import { debug } from '../logger';
import { TypeScriptFileProcessor } from './typescript';
import IStep = messages.GherkinDocument.Feature.IStep;
import IEnvelope = messages.IEnvelope;

const logger = debug.extend('feature');
const info = logger.extend('info');
const warn = logger.extend('warn');

const STORIES_IMPORT = 'storiesOf';
const CSF3_EXPORT_TITLE_FIELD = 'title';
const STORIES_PACKAGE = '@storybook/react';
const STORIES_FILE_RE = new RegExp(
  `([^${escapeRegExp(path.sep)}]+)\\.stories\\.tsx?$`,
);
const STEPS_FILE_RE = new RegExp(
  `([^${escapeRegExp(path.sep)}]+)\\.steps\\.ts$`,
);
const RE_LITERAL_RE = /^\/(.+)\/([gimsuy]*)$/;
const STEP_DEFININITION_FN_NAMES = ['When', 'Then', 'Given'];

export type Storybook = string;
export type Story = string;
export type StorybookExtractorFn = (
  gherkinAssertion: string,
) => [Storybook, Story] | void;

type StorybookMap = Map<Storybook, Set<Path>>;
type StepMap = Map<Path, Set<RegExp>>;

export class FeatureFileProcessor extends TypeScriptFileProcessor {
  private storybookDefinitions: Promise<StorybookMap> | undefined;
  private stepsDefinitions: Promise<StepMap> | undefined;

  constructor(
    rootDir: string,
    private readonly extractorFn: StorybookExtractorFn,
  ) {
    super(rootDir);
  }

  private static isRegExpToken(
    a: ts.Expression,
  ): a is ts.RegularExpressionLiteral {
    return (
      typeof a === 'object' &&
      typeof a.kind !== 'undefined' &&
      typeof ((a as unknown) as Record<string, unknown>).text !== 'undefined' &&
      a.kind === ts.SyntaxKind.RegularExpressionLiteral
    );
  }

  private static isImportDeclaration(
    node: ts.Node,
  ): node is ts.ImportDeclaration {
    return node.kind === ts.SyntaxKind.ImportDeclaration;
  }

  private static isStoriesOf(node: ts.Node): boolean {
    return (
      node.kind === ts.SyntaxKind.Identifier &&
      (node as ts.Identifier).text === STORIES_IMPORT
    );
  }

  private static isStoriesImport(node: ts.Node): boolean {
    if (!FeatureFileProcessor.isImportDeclaration(node)) {
      return false;
    }

    if (
      !(
        node.moduleSpecifier &&
        (node.moduleSpecifier as ts.StringLiteral).text === STORIES_PACKAGE
      )
    ) {
      return false;
    }

    const namedBindings =
      node.importClause && (node.importClause.namedBindings as ts.NamedImports);
    if (!namedBindings) {
      return false;
    }

    return (
      namedBindings.elements &&
      namedBindings.elements.some(
        (is: ts.ImportSpecifier) =>
          (is.name as ts.Identifier).text === STORIES_IMPORT,
      )
    );
  }

  private static isStringLiteral(node: ts.Node): node is ts.StringLiteral {
    return node.kind === ts.SyntaxKind.StringLiteral;
  }

  private static isCallExpression(node: ts.Node): node is ts.CallExpression {
    return node.kind === ts.SyntaxKind.CallExpression;
  }

  private static isExportAssignment(
    node: ts.Node,
  ): node is ts.ExportAssignment {
    return node.kind === ts.SyntaxKind.ExportAssignment;
  }

  private static isObjectLiteralExpression(
    node: ts.Node,
  ): node is ts.ObjectLiteralExpression {
    return node.kind === ts.SyntaxKind.ObjectLiteralExpression;
  }

  private static isPropertyAssignment(
    node: ts.Node,
  ): node is ts.PropertyAssignment {
    return node.kind === ts.SyntaxKind.PropertyAssignment;
  }

  private static isIdentifier(node: ts.Node): node is ts.Identifier {
    return node.kind === ts.SyntaxKind.Identifier;
  }

  private static walkStories(
    sourceFile: ts.SourceFile,
    callback: (storybook: Storybook) => void,
  ) {
    let importFound = false;

    const walkTree = (node: ts.Node): void => {
      if (
        FeatureFileProcessor.isCallExpression(node) &&
        FeatureFileProcessor.isStoriesOf(node.expression)
      ) {
        const firstNode = node.arguments[0];
        if (!FeatureFileProcessor.isStringLiteral(firstNode)) {
          // TODO(joscha): we should support composites, etc. as well.
          throw new Error(
            'Only string literals in storiesOf(...) are supported',
          );
        }
        callback(firstNode.text);
        return;
      }

      if (FeatureFileProcessor.isExportAssignment(node)) {
        const { expression } = node;
        if (FeatureFileProcessor.isObjectLiteralExpression(expression)) {
          const property = expression.properties[0];
          if (FeatureFileProcessor.isPropertyAssignment(property)) {
            const { name, initializer } = property;
            if (
              FeatureFileProcessor.isIdentifier(name) &&
              FeatureFileProcessor.isStringLiteral(initializer) &&
              name.escapedText === CSF3_EXPORT_TITLE_FIELD
            ) {
              callback(initializer.text);
            }
          }
        }
      }

      ts.forEachChild(node, walkTree);
    };

    const walkFirstLevel = (node: ts.Node): void => {
      // Look for stories import first
      if (!importFound && FeatureFileProcessor.isStoriesImport(node)) {
        importFound = true;
      } else if (
        importFound &&
        !FeatureFileProcessor.isImportDeclaration(node)
      ) {
        // Look for `storiesOf` calls only if there was import
        walkTree(node);
      }
    };

    return ts.forEachChild(sourceFile, walkFirstLevel);
  }

  private static walkSteps(
    sourcefile: ts.SourceFile,
    callback: (re: RegExp) => void,
  ) {
    const walk = (node: ts.Node) => {
      if (FeatureFileProcessor.isCallExpression(node)) {
        if (
          ts.isIdentifier(node.expression) &&
          // It assumed that we have steps defined only by calling following functions names
          STEP_DEFININITION_FN_NAMES.indexOf(
            node.expression.escapedText as string,
          ) !== -1
        ) {
          const arg = node.arguments[0];
          if (FeatureFileProcessor.isRegExpToken(arg)) {
            const match = RE_LITERAL_RE.exec(arg.text);
            if (match === null) {
              throw new Error(
                'Unable to parse TypeScript RegExp literal token. It might be the format was ' +
                  'changed or incorrect change was made to RE_LITERAL_RE.',
              );
            }
            const [, re, flags] = match;
            callback(new RegExp(re, flags));
            return;
          }
        }
      }
      ts.forEachChild(node, walk);
    };
    ts.forEachChild(sourcefile, walk);
  }

  public async process(
    file: Path,
    contents: string,
    missing: FileToDeps,
    files: ReadonlyArray<Path>,
  ): Promise<Set<Path>> {
    const importedFiles = new Set<Path>();

    const steps = await this.getSteps(file);
    const referencedStorybookMapping = this.getReferencedStorybookMapping(
      steps,
    );
    const referencedStorybooks = Array.from(referencedStorybookMapping.keys());

    if (referencedStorybooks.length > 0) {
      info('Found references to storybooks %o', referencedStorybooks);

      const storyDefinitions = await this.getStorybookDefinitions(files);
      for (const storybook of referencedStorybooks) {
        if (storyDefinitions.size && storyDefinitions.has(storybook)) {
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          for (const tsFile of storyDefinitions.get(storybook)!) {
            importedFiles.add(tsFile);
          }
        } else {
          warn('Could not find referenced storybook %s', storybook);
          // This is an interpolation for a missing storybook file. From having the dot-notated
          // storybook (e.g. "a.b.c") we only know that the path has to start with "a/b/c/stories/"
          // but we can't deduce the stories filename easily, hence we will put a star there, e.g.
          // a missing story "a.b.c" will become "a/b/c/stories/*.stories.tsx"
          const missingFileDeps = missing.get(file) || new Set<Path>();
          missingFileDeps.add(
            path.join(
              storybook.replace(/\./g, path.sep),
              'stories',
              '*.stories.tsx',
            ),
          );
          missing.set(file, missingFileDeps);
        }
      }
    }

    const stepsMap = await this.getStepsDefinitionRegExps(files);

    for (const [filePath, regExps] of stepsMap) {
      regexpsLoop: for (const re of regExps) {
        for (const { text } of steps) {
          if (text && re.test(text)) {
            importedFiles.add(filePath);
            break regexpsLoop;
          }
        }
      }
    }
    return importedFiles;
  }

  public match(file: Path): boolean {
    return /\.feature$/i.test(file);
  }

  public supportedFileTypes(): string[] {
    return ['feature'];
  }

  /**
   * This is only meant to be called once per execution of the dependency graph calculation.
   * The return value is a promise in order to facilitate potential asynchronicity to improve
   * performance later.
   * The passed files array is expected to be stable and never-changing.
   */
  private async getStorybookDefinitions(
    files: ReadonlyArray<string>,
  ): Promise<StorybookMap> {
    this.storybookDefinitions =
      this.storybookDefinitions ||
      // TODO reduce scope of the promise here
      // eslint-disable-next-line no-async-promise-executor
      new Promise(async (resolve, reject) => {
        const storybookDefinitions: StorybookMap = new Map();
        for (const file of files) {
          if (!STORIES_FILE_RE.test(file)) {
            // Caveat: this is a bit short-sighted, as potentially it is possible to have a
            // storiesOf(...) in a file that doesn't match the stories regex, but for that we would
            // need the graph of the stories import and that is quite expensive, so for now we are
            // happy to just look into stories files
            continue;
          }
          try {
            const sourceFile = await TypeScriptFileProcessor.createTSSourceFile(
              file,
              this.compilerOptions.target,
            );
            FeatureFileProcessor.walkStories(
              sourceFile,
              (storybook: Storybook) => {
                const paths = storybookDefinitions.get(storybook) || new Set();
                paths.add(file);
                storybookDefinitions.set(storybook, paths);
              },
            );
          } catch (e) {
            reject(e);
            return;
          }
        }
        resolve(storybookDefinitions);
      });
    return this.storybookDefinitions;
  }

  /**
   * Extracts regular expressions matching gherkin step definitions from a given array of steps
   * files
   */
  private async getStepsDefinitionRegExps(
    files: ReadonlyArray<Path>,
  ): Promise<StepMap> {
    this.stepsDefinitions =
      this.stepsDefinitions ||
      // TODO reduce scope of the promise here
      // eslint-disable-next-line no-async-promise-executor
      new Promise(async (resolve) => {
        const stepsRegExpsToPathsMap: StepMap = new Map();

        for (const file of files) {
          if (!STEPS_FILE_RE.test(file)) {
            continue;
          }

          const sourceFile = await TypeScriptFileProcessor.createTSSourceFile(
            file,
            this.compilerOptions.target,
          );
          FeatureFileProcessor.walkSteps(sourceFile, (re: RegExp) => {
            const res: Set<RegExp> =
              stepsRegExpsToPathsMap.get(file) || new Set();
            res.add(re);
            stepsRegExpsToPathsMap.set(file, res);
          });
        }
        resolve(stepsRegExpsToPathsMap);
      });
    return this.stepsDefinitions;
  }

  /**
   * Extracts all the steps.
   *
   * @param gherkinFile path to gherkin file
   * @return an array of steps
   */
  private async getSteps(gherkinFile: Path): Promise<IStep[]> {
    return new Promise((resolve, reject) => {
      const stream = gherkin.fromPaths([gherkinFile], {
        includeGherkinDocument: true,
        includePickles: false,
        includeSource: false,
      });

      let steps: IStep[] = [];
      stream.on('data', (envelope: IEnvelope) => {
        if (
          envelope.gherkinDocument != null &&
          envelope.gherkinDocument.feature != null &&
          envelope.gherkinDocument.feature.children != null
        ) {
          for (const child of envelope.gherkinDocument.feature.children) {
            if (child.background && child.background.steps) {
              steps = steps.concat(child.background.steps);
            }
            if (child.scenario && child.scenario.steps) {
              steps = steps.concat(child.scenario.steps);
            }
          }
        }
      });
      stream.on('error', (err: Error) => reject(err));
      stream.on('end', () => resolve(steps));
    });
  }

  /**
   * Extracts references to Storybooks & stories from a given gherkin steps.
   *
   * @return  a map with a storybook name as the key and a value with a set of stories that are
   *          referenced by the gherkin file passed
   */
  private getReferencedStorybookMapping(
    steps: IStep[],
  ): Map<Storybook, Set<Story>> {
    const storybooks: Map<Storybook, Set<Story>> = new Map();

    for (const step of steps) {
      // TODO(joscha): This does not work with gherkin dataTables, yet
      if (step.text) {
        const extracted = this.extractorFn(step.text);
        if (extracted) {
          const [storybook, story] = extracted;
          if (!storybook) {
            throw new Error(
              `Storybook extraction from "${step.text}" failed, it yielded no storybook`,
            );
          }
          if (!story) {
            throw new Error(
              `Storybook extraction from "${step.text}" failed, it yielded no story`,
            );
          }
          const book = storybooks.get(storybook) || new Set<Path>();
          book.add(story);
          storybooks.set(storybook, book);
        }
      }
    }

    return storybooks;
  }
}
