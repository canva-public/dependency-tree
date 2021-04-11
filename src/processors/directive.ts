// Copyright 2021 Canva Inc. All Rights Reserved.

import * as camelcase from 'camelcase';
import { escapeRegExp } from 'lodash';
import { OptionsV2, parseStringPromise as xml2js } from 'xml2js';
import { DependencyTree, FileToDeps, Path } from '../';
import { FileProcessor } from '../file_processor';

type Directive = {
  dependsOn?: string;
};

type Options = {
  // A token that we start parsing of directive definition from.
  reStart: RegExp;
  // A token that splits multiline definitions if any, can be a RegExp string, e.g. '///?'.
  reContinuation: RegExp;
  // File type that need to be inspected by an instance of the processor.
  fileTypes: string[];
};

/**
 * An abstract DirectiveProcessor class that implements language-agnostic generic logic of
 * directives' parsing. For more info see: tools/dependency-tree/docs/directive.md.
 */
abstract class DirectiveProcessor implements FileProcessor {
  static readonly ELEMENT_NAME = 'dependency-tree';

  private static readonly allowedAttributes = ['dependsOn'];
  private readonly reMultilineDirectiveDelimiter: RegExp;
  private readonly reExt: RegExp;
  private readonly reNext: RegExp;
  private readonly xmlParserOptions: OptionsV2;

  protected constructor(private readonly options: Options) {
    // We do pre-compilation of RegExp because it seems to be the fastest way to match a file
    // extension with some of supported extensions. See benchmarks: https://jsbench.me/hck9uhbt4z/1
    this.reExt = new RegExp(
      `\\.(${this.supportedFileTypes().join('|')})$`,
      'i',
    );

    /**
     * reStrElementsBody defines a RegExp group to match a valid directive definitions, single- &
     * multi-lined. It captures named group called 'body' that contains an XML element body. It can
     * contain tokens that matches `this.options.continuationToken` so need to be cleaned up first
     * via `this.reMultilineDirectiveDelimiter` before making an attempt to parse XML.
     *
     * Side note: Node.js does support of named groups so we can safely use it.
     */
    const reStrElementsBody = `(?:.*${
      this.options.reStart.source
    }\\s*(?<body><${escapeRegExp(
      DirectiveProcessor.ELEMENT_NAME,
    )}\\s[^>]*/>).*)`;

    /**
     * reStrSyntaxError this RegExp group is similar to above. It matches invalid XML, i.e.
     * essentially, if XML element has not been closed properly. It captures named group called
     * 'syntaxError' that contains a beginning of XML element body. See
     * tools/dependency-tree/docs/directive.md for details.
     */
    const reStrSyntaxError = `(?:.*(?<syntaxError>${
      this.options.reStart.source
    }\\s*<${escapeRegExp(DirectiveProcessor.ELEMENT_NAME)})\\s.*)`;

    /**
     * reStrRest a RegExp non-captured group that matches everything else except the groups above
     * until it finds a non empty string or the end of the file and doesn't match the groups above.
     */
    const reStrRest = `(?:.+)`;

    /**
     * this.reNext a RegExp group that matches one of the groups above and following newline
     * elements or the end of the file.
     */
    this.reNext = new RegExp(
      `^((?:${reStrElementsBody}|${reStrSyntaxError}|${reStrRest})(?:\\n+|$))`,
    );

    /**
     * This RegExp matches line breaks for multiline directives. E.g if the directive defined as
     * follows:
     *
     *   /// <dependency-tree
     *   // depends-on="./dep2.js"
     *   // />
     *
     * `this.reNext` will match XML body '<dependency-tree\n//   depends-on="./dep2.js"\n// />'.
     * Comments with new lines needs to be cut out from the body to make the XML syntax valid.
     */
    this.reMultilineDirectiveDelimiter = new RegExp(
      `\\n\\s*(${this.options.reContinuation.source})`,
      'g',
    );

    this.xmlParserOptions = {
      // Cast capitalized kebab case ('DEPENDS-ON', by default) to camel case ('dependsOn')
      attrNameProcessors: [camelcase],
      normalizeTags: true, // to lower case
      trim: true,
      attrkey: 'attributes',
      strict: true,
    };
  }

  /**
   * Checks if the passed argument is an object of Directive shape and content is valid and throws
   * an exception otherwise.
   * @param obj - arbitrary payload
   */
  private static assertDirective(obj: unknown): Directive {
    if (typeof obj !== 'object' || obj === null) {
      throw new TypeError(`Unexpected type: ${typeof obj}`);
    }

    // Check that all the properties are known
    for (const key of Object.keys(obj)) {
      if (!DirectiveProcessor.allowedAttributes.includes(key)) {
        throw new TypeError(`Unknown attribute: '${key}'`);
      }
    }

    return obj;
  }

  /**
   * Returns position of where the next symbol could be located at in terms of line & column
   * numbers. For example:
   *
   *   const str = `some
   *   kind
   *   of content
   *   presented here`;
   *
   *   const [lineNumber, columnNumber ] = DirectiveProcessor.getNextSymbolPosition(str);
   *
   *   assert(lineNumber === 4);
   *   assert(columnNumber === 15);
   *
   * @param content is a string that is going right before the position we would
   *                need to know.
   */
  private static getNextSymbolPosition = (
    content: string,
  ): [number, number] => {
    const m = content.split('\n');
    return [m.length, (m.pop()?.length || 0) + 1];
  };

  /**
   * @inheritDoc
   */
  public async process(
    file: Path,
    contents: string,
    missing: FileToDeps,
    files: ReadonlyArray<Path>,
    dependencyTree: DependencyTree,
  ) {
    const importedFiles = new Set<Path>();
    const directives = await this.getDirectives(contents, file);
    // Handle directives with 'depends-on' attribute defined
    directives.forEach(({ dependsOn }) => {
      dependsOn &&
        dependencyTree.resolveAndCollect(
          file,
          dependencyTree.transformReference(dependsOn, file),
          importedFiles,
          missing,
        );
    });

    return Promise.resolve(importedFiles);
  }

  public match(file: Path) {
    return this.reExt.test(file);
  }

  public supportedFileTypes() {
    return this.options.fileTypes;
  }

  /**
   * Returns directives defined in the content.
   *
   * @param content A content to parse
   * @param filePath A file path, for error reports only
   */
  private async getDirectives(
    content: string,
    filePath: Path,
  ): Promise<Directive[]> {
    const directives: Directive[] = [];
    let lastIndex = 0;
    const errorPayload = (
      fullMatch: string,
      groupMatch: string,
    ): [string, string, number, number] => {
      const [line, column] = DirectiveProcessor.getNextSymbolPosition(
        content.slice(
          0,
          lastIndex - fullMatch.length + fullMatch.indexOf(groupMatch),
        ),
      );
      return [content, filePath, line, column];
    };

    let m:
      | (string[] & { groups?: { body?: string; syntaxError?: string } })
      | null = null;
    while ((m = this.reNext.exec(content.slice(lastIndex)))) {
      const { 0: match, groups: { body, syntaxError } = {} } = m;
      lastIndex += match.length;
      if (body) {
        // Remove new lines with leftover comments's symbols and new lines.
        const singleLineBody = body.replace(
          this.reMultilineDirectiveDelimiter,
          '',
        );
        const parsed = await xml2js(
          singleLineBody,
          this.xmlParserOptions,
        ).catch((e) => {
          // We cut non-actual information about the syntax error location if any because
          // the xml2js library is always parses a single XML element passed from the RegExp
          // match so the xml2js library doesn't aware of the whole context of the parsing,
          // hence the line and column cannot be inferred correctly.
          const reXML2JSReport = /(line|column|char):.*(\n+|$)/gi;
          if (!reXML2JSReport.test(e.message)) {
            throw new Error(`The xml2js output format has been changed (maybe xmk2js npm has been upgraded?)!
Please align this part of the code along.
Current output is: '${
              e.message
            }', that doesn't match '${reXML2JSReport.toString()}'.

Do you have any questions? Reach out to #fe-infra on slack.`);
          }
          // Re-throw the cleaned up error with the full context.
          throw new DirectiveProcessorParseError(
            e.message.replace(reXML2JSReport, ''),
            ...errorPayload(match, body),
          );
        });
        const {
          [DirectiveProcessor.ELEMENT_NAME]: { attributes },
        } = parsed;
        try {
          directives.push(DirectiveProcessor.assertDirective(attributes));
        } catch (e) {
          // Re-throw a validation error with full context of the error.
          throw new DirectiveProcessorValidationError(
            e.message,
            ...errorPayload(match, body),
          );
        }
      } else if (syntaxError) {
        // DirectiveProcessor.ELEMENT_NAME mention have found in the content but no match happened
        // so syntax seems to be invalid.
        throw new DirectiveProcessorSyntaxError(
          '',
          ...errorPayload(match, syntaxError),
        );
      }
    }

    return directives;
  }
}

/**
 * Extends the Error class to render human-understandable error messages
 * along with the context of parsing.
 */
class DirectiveProcessorError extends Error {
  constructor(
    message: string,
    content: string,
    readonly fileName: Path,
    readonly lineNumber: number,
    readonly columnNumber: number,
  ) {
    super(`${message}

${lineNumber}\t${content.split(/\n/g)[lineNumber - 1]}
\t${' '.repeat(columnNumber - 1)}^
\t${' '.repeat(columnNumber - 1)}└── definition starts at ${[
      fileName,
      lineNumber,
      columnNumber,
    ].join(':')}

Please make sure you have followed the guidelines of how to define the dependency-tree directive.
See the online documentation at dependency-tree/docs/directive.md.
Do you have any questions? Reach out to #fe-infra on slack.
`);
  }
}

class DirectiveProcessorSyntaxError extends DirectiveProcessorError {}

class DirectiveProcessorParseError extends DirectiveProcessorError {}

class DirectiveProcessorValidationError extends DirectiveProcessorError {}

/**
 * TypeScript triple-slash directives processor. The behavior is similar to the built-in TypeScript
 * triple-slash directive processor
 * (https://www.typescriptlang.org/docs/handbook/triple-slash-directives.html) but definition is
 * allowed across the whole file. For more info see: tools/dependency-tree/docs/directive.md.
 */
export class TSDirectiveProcessor extends DirectiveProcessor {
  constructor() {
    super({
      reStart: /\/\/\//,
      reContinuation: /\/\/\/?/,
      fileTypes: ['ts', 'tsx'],
    });
  }
}
