// Copyright 2021 Canva Inc. All Rights Reserved.

import * as path from 'path';
import { DependencyTree, ReferenceTransformFn } from '../src';
import { FileProcessor } from '../src/file_processor';
import {
  FeatureFileProcessor,
  StorybookExtractorFn,
} from '../src/processors/feature';

function fixture(...chunks: string[]) {
  return path.join(__dirname, 'fixtures', ...chunks);
}

describe('dependencyTree', () => {
  let dependencyTree: DependencyTree;

  describe('built-ins', () => {
    beforeEach(() => {
      dependencyTree = new DependencyTree([fixture('built-ins')]);
    });

    it('are ignored', async () => {
      expect.hasAssertions();
      expect(await dependencyTree.gather()).toStrictEqual({
        missing: new Map(),
        resolved: new Map([[fixture('built-ins', 'test.ts'), new Set()]]),
      });
    });
  });

  describe('named modules', () => {
    beforeEach(() => {
      dependencyTree = new DependencyTree([fixture('modules')]);
    });

    it('are ignored', async () => {
      expect.hasAssertions();
      expect(await dependencyTree.gather()).toStrictEqual({
        missing: new Map(),
        resolved: new Map([[fixture('modules', 'test.ts'), new Set()]]),
      });
    });
  });

  describe('referenceTransformer', () => {
    let transformFn: ReferenceTransformFn;

    beforeEach(() => {
      transformFn = jest.fn((ref) =>
        ref.startsWith('~') ? path.join('..', ref.substr(1)) : ref,
      );
      dependencyTree = new DependencyTree(
        [fixture('tilde-deps')],
        DependencyTree.createResolver(),
        ['**/node_modules/**'],
        transformFn,
      );
    });

    it('works', async () => {
      expect.hasAssertions();
      expect(await dependencyTree.gather()).toStrictEqual({
        missing: new Map(),
        resolved: new Map([
          [
            fixture('tilde-deps', 'a.css'),
            new Set([fixture('tilde-deps', 'b.css')]),
          ],
          [fixture('tilde-deps', 'b.css'), new Set()],
        ]),
      });
      expect(transformFn).toHaveBeenCalledTimes(1);
      expect(transformFn).toHaveBeenCalledWith(
        '~tilde-deps/b.css',
        fixture('tilde-deps', 'a.css'),
      );
    });
  });

  describe('normal graph', () => {
    beforeEach(() => {
      dependencyTree = new DependencyTree([fixture('a')]);
    });

    it('is detected', async () => {
      expect.hasAssertions();
      const result = await dependencyTree.gather();
      expect(result).toStrictEqual({
        missing: new Map([
          [fixture('a', 'index.ts'), new Set(['./missing-dep'])],
        ]),
        resolved: new Map([
          [
            fixture('a', 'a.css'),
            new Set([
              fixture('a', 'c.css'),
              fixture('a', 'b.css'),
              fixture('a', 'a.png'),
            ]),
          ],
          [
            fixture('a', 'a.tsx'),
            new Set([fixture('a', 'a.css'), fixture('a', 'type.ts')]),
          ],
          [fixture('a', 'b.css'), new Set()],
          [fixture('a', 'c.css'), new Set()],
          [fixture('a', 'index.ts'), new Set([fixture('a', 'a.tsx')])],
          [fixture('a', 'type.ts'), new Set()],
        ]),
      });
    });

    it('can return the whole list', async () => {
      expect.hasAssertions();
      const { resolved } = await dependencyTree.gather();
      expect(
        DependencyTree.getReferences(resolved, [fixture('a', 'index.ts')]),
      ).toStrictEqual(new Set());

      expect(
        DependencyTree.getReferences(resolved, [fixture('a', 'a.png')]),
      ).toStrictEqual(
        new Set([
          fixture('a', 'a.css'),
          fixture('a', 'a.tsx'),
          fixture('a', 'index.ts'),
        ]),
      );
    });

    it('can return all the dependencies', async () => {
      expect.hasAssertions();
      const { resolved } = await dependencyTree.gather();
      expect(
        DependencyTree.getDependencies(resolved, [fixture('a', 'index.ts')]),
      ).toStrictEqual(
        new Set([
          fixture('a', 'a.css'),
          fixture('a', 'a.png'),
          fixture('a', 'a.tsx'),
          fixture('a', 'b.css'),
          fixture('a', 'c.css'),
          fixture('a', 'type.ts'),
        ]),
      );

      expect(
        DependencyTree.getDependencies(resolved, [fixture('a', 'a.png')]),
      ).toStrictEqual(new Set());
    });
  });

  describe('custom files', () => {
    beforeEach(() => {
      dependencyTree = new DependencyTree([fixture('custom-files')]);
      dependencyTree.addFileProcessor(
        new (class BlaFileProcessor implements FileProcessor {
          public match(file: string) {
            return /\.bla$/i.test(file);
          }

          public async process(file: string) {
            return Promise.resolve(
              new Set<string>([file]),
            );
          }

          public supportedFileTypes() {
            return ['bla'];
          }
        })(),
      );
    });

    it('finds custom files', async () => {
      expect.hasAssertions();
      expect(await dependencyTree.gather()).toStrictEqual({
        missing: new Map(),
        resolved: new Map([
          [
            fixture('custom-files', 'x.bla'),
            new Set([fixture('custom-files', 'x.bla')]),
          ],
        ]),
      });
    });
  });

  describe('feature files', () => {
    const STORY_FEATURE_REGEX = /^I visit the "([^"]*)" (?:visreg )?story of the "([^"]*)" storybook$/;
    const extractorFn: StorybookExtractorFn = (gherkinAssertion: string) => {
      const matches = gherkinAssertion.match(STORY_FEATURE_REGEX);
      if (matches) {
        const [, story, storybook] = matches;
        return [storybook, story];
      }
    };

    describe('references', () => {
      beforeEach(() => {
        const fixtureBaseName = 'feature-storybook-ref';
        dependencyTree = new DependencyTree([fixture(fixtureBaseName)]);
        dependencyTree.addFileProcessor(
          new FeatureFileProcessor(fixture(fixtureBaseName), extractorFn),
        );
      });

      it('will be introspected', async () => {
        expect.hasAssertions();
        expect(await dependencyTree.gather()).toStrictEqual({
          missing: expect.any(Map), // we don't care about react and @storybook/react here
          resolved: new Map([
            [
              fixture('feature-storybook-ref', 'test.feature'),
              new Set([
                fixture('feature-storybook-ref', 'a.stories.tsx'),
                fixture('feature-storybook-ref', 'b.stories.tsx'),
                fixture('feature-storybook-ref', 'c.stories.tsx'),
                fixture('feature-storybook-ref', 'd_e.stories.tsx'),
                fixture(
                  'feature-storybook-ref',
                  'step_definitions',
                  'a.steps.ts',
                ),
                fixture(
                  'feature-storybook-ref',
                  'step_definitions',
                  'b.steps.ts',
                ),
                fixture(
                  'feature-storybook-ref',
                  'step_definitions',
                  'd.steps.ts',
                ),
                fixture(
                  'feature-storybook-ref',
                  'step_definitions',
                  'e.steps.ts',
                ),
              ]),
            ],
            [
              fixture('feature-storybook-ref', 'foo.feature'),
              new Set([
                fixture(
                  'feature-storybook-ref',
                  'step_definitions',
                  'c.steps.ts',
                ),
                fixture(
                  'feature-storybook-ref',
                  'step_definitions',
                  'e.steps.ts',
                ),
              ]),
            ],
            [fixture('feature-storybook-ref', 'a.stories.tsx'), new Set()],
            [fixture('feature-storybook-ref', 'b.stories.tsx'), new Set()],
            [fixture('feature-storybook-ref', 'c.stories.tsx'), new Set()],
            [fixture('feature-storybook-ref', 'd_e.stories.tsx'), new Set()],
            [fixture('feature-storybook-ref', 'x.stories.tsx'), new Set()],
            [
              fixture(
                'feature-storybook-ref',
                'step_definitions',
                'a.steps.ts',
              ),
              new Set(),
            ],
            [
              fixture(
                'feature-storybook-ref',
                'step_definitions',
                'b.steps.ts',
              ),
              new Set(),
            ],
            [
              fixture(
                'feature-storybook-ref',
                'step_definitions',
                'c.steps.ts',
              ),
              new Set(),
            ],
            [
              fixture(
                'feature-storybook-ref',
                'step_definitions',
                'd.steps.ts',
              ),
              new Set(),
            ],
            [
              fixture(
                'feature-storybook-ref',
                'step_definitions',
                'e.steps.ts',
              ),
              new Set(),
            ],
            [
              fixture(
                'feature-storybook-ref',
                'step_definitions',
                'xyz.steps.ts',
              ),
              new Set(),
            ],
          ]),
        });
      });
    });

    describe('missing references', () => {
      beforeEach(() => {
        const fixtureBaseName = 'feature-storybook-ref-missing';
        dependencyTree = new DependencyTree([fixture(fixtureBaseName)]);
        dependencyTree.addFileProcessor(
          new FeatureFileProcessor(fixture(fixtureBaseName), extractorFn),
        );
      });

      it('with unknown story', async () => {
        expect.hasAssertions();
        expect(await dependencyTree.gather()).toStrictEqual({
          missing: new Map([
            [
              fixture('feature-storybook-ref-missing', 'test.feature'),
              new Set(['a/b/c/stories/*.stories.tsx']),
            ],
          ]),
          resolved: expect.any(Map), // only interested in the missing files here
        });
      });
    });
  });

  describe('dynamic entry points', () => {
    beforeEach(() => {
      dependencyTree = new DependencyTree([fixture('entry')]);
    });

    it('detected', async () => {
      expect.hasAssertions();
      const result = await dependencyTree.gather();
      expect(result).toStrictEqual({
        missing: expect.any(Map),
        resolved: new Map([
          [
            fixture('entry', 'awkward.entry.ts'),
            new Set([fixture('entry', 'c.tsx')]),
          ],
          [
            fixture('entry', 'point.entry.ts'),
            new Set([fixture('entry', 'main.ts')]),
          ],
          [fixture('entry', 'main.ts'), new Set()],
          [fixture('entry', 'c.tsx'), new Set()],
        ]),
      });
    });

    it('returns correct references', async () => {
      expect.hasAssertions();
      const { resolved } = await dependencyTree.gather();
      const refs = DependencyTree.getReferences(resolved, [
        fixture('entry', 'main.ts'),
      ]);
      expect(refs).toStrictEqual(new Set([fixture('entry', 'point.entry.ts')]));
    });
  });

  describe('snapshots', () => {
    beforeEach(() => {
      dependencyTree = new DependencyTree([fixture('snapshots')]);
    });

    it('detected', async () => {
      expect.hasAssertions();
      const result = await dependencyTree.gather();
      const snapshot = fixture(
        'snapshots',
        '__snapshots__',
        'the.tests.tsx.snap',
      );
      const referencedTest = fixture('snapshots', 'the.tests.tsx');
      expect(result).toStrictEqual({
        missing: new Map(),
        resolved: new Map([[referencedTest, new Set([snapshot])]]),
      });

      expect(
        DependencyTree.getReferences(result.resolved, [snapshot]),
      ).toStrictEqual(new Set([referencedTest]));
    });
  });

  describe('multiple roots', () => {
    it('works', async () => {
      expect.hasAssertions();
      dependencyTree = new DependencyTree([
        fixture('modules'),
        fixture('built-ins'),
      ]);
      const result = await dependencyTree.gather();
      expect(result).toStrictEqual({
        missing: new Map(),
        resolved: new Map([
          [fixture('modules', 'test.ts'), new Set()],
          [fixture('built-ins', 'test.ts'), new Set()],
        ]),
      });
    });

    it('detects imports from another root', async () => {
      expect.hasAssertions();
      dependencyTree = new DependencyTree([
        fixture('modules'),
        fixture('built-ins'),
        fixture('framework'),
      ]);
      const result = await dependencyTree.gather();
      expect(result).toStrictEqual({
        missing: new Map(),
        resolved: new Map([
          [fixture('modules', 'test.ts'), new Set()],
          [fixture('built-ins', 'test.ts'), new Set()],
          [
            fixture('framework', 'index.ts'),
            new Set([
              fixture('modules', 'test.ts'),
              fixture('built-ins', 'test.ts'),
            ]),
          ],
        ]),
      });
    });
  });

  describe('directive', () => {
    const dir = 'directive';
    beforeEach(() => {
      dependencyTree = new DependencyTree([fixture(dir)]);
    });

    it('works', async () => {
      expect.hasAssertions();
      const result = await dependencyTree.gather();
      expect(result).toStrictEqual({
        missing: new Map([
          [
            fixture(dir, 'index.ts'),
            new Set([
              './missing.proto',
              './users/myself/work/canva/tools/dependency-tree/tests/fixtures/directive/index.ts',
            ]),
          ],
        ]),
        resolved: new Map([
          [fixture(dir, 'dep1.ts'), new Set()],
          [
            fixture(dir, 'index.ts'),
            new Set([
              fixture(dir, 'dep1.ts'),
              fixture(dir, 'dep2.js'),
              fixture(dir, 'dep3.sh'),
            ]),
          ],
          [fixture(dir, 'util.ts'), new Set([fixture(dir, 'dep4.ejs')])],
        ]),
      });
    });
  });

  describe('batch size', () => {
    const dir = 'directive';
    beforeEach(() => {
      dependencyTree = new DependencyTree([fixture(dir)]);
    });

    it('works with a batch size of 1', async () => {
      expect.hasAssertions();
      const result = await dependencyTree.gather({ batchSize: 1 });
      expect(result).toBeTruthy();
    });

    it('works with a batch size of 100', async () => {
      expect.hasAssertions();
      const result = await dependencyTree.gather({ batchSize: 100 });
      expect(result).toBeTruthy();
    });

    it('rejects a batch size less than 1', async () => {
      expect.hasAssertions();
      await expect(() =>
        dependencyTree.gather({ batchSize: -1 }),
      ).rejects.toThrowErrorMatchingSnapshot();
    });
  });
});
