# The dependency-tree's directive

In most cases, statical source code analysis works quite well for purposes that the dependency-tree tool aims to target. However, this approach doesn't work for some rare, yet important cases. Since most of the application's code depends on the configuration files indirectly an ability to link these files with the application's source code became crucial. For example, the tool is currently unable to build a correct dependency graph between some configuration files and the application's source code. Another example where there is no full (AST processing) support for a particular language (e.g. `*.ejs`, `*.sh`, etc) in the dependency-tree tool but since we use this language in critical paths of the system it's important to build dependency graph correctly for such cases.

The approach to address this problem could look like to annotate some of the files with pieces of metadata that let the tool know how to build a dependency graph.

The dependency-tree directive is a mechanism that implements the described approach. It is language-agnostic can be easily adapted to be used in different source file types. Effectively, it's a comment line(s) with a single [XML] element in it that contains metadata (see below).

### General Syntax Rules

It is a self-closing [XML] element with more that zero attributes.

```xml
<dependency-tree />
```

Attributes are contained metadata related to specific case. Attribute values must always be quoted. Either single or double quotes can be used. Double quotes preferred.

```xml
<dependency-tree attribute="value" />
```

or

```xml
<dependency-tree attribute='value' />
```

Attributes can start with a new line:

```xml
<dependency-tree
  attribute="value" />
```

The element can be closed at a new line:

```xml
<dependency-tree
  attribute="value"
/>
```

Available attributes:

- **`depends-on="..."`**
    - contains a relative path to a dependency file.
    - or a relative path with glob pattern.

Note that unavailable attributes will cause a validation error.

### Language Specific Syntax Rules

For the **[TypeScript]** codebase (`['.ts', '.tsx']` file extensions), we utilize a triple-slash comment to hold the directive element. The comment can be placed after any language constructions in a single line:

```typescript
/// <dependency-tree depends-on="../../../../../../conf/libraries.ts" />

/// <dependency-tree depends-on="./dep1.sh" />
resolve(__dirname, './dep1.sh');
resolve(__dirname, './dep2.ts'); /// <dependency-tree depends-on="./dep2.js" />
```

directive comment can detect glob patterns:

```typescript
///<dependency-tree depends-on="./dir1/**/*" />
resolve(__dirname, './dir1/dep5.py');
resolve(__dirname, './dir1/dir2/dep6.md');
```

Element's definition can be split into multiple lines:

```typescript
resolve(__dirname, './dep2.ts'); /// <dependency-tree
///   depends-on="./dep2.js"
/// />
```

A multi-line definition can also contain two-slash comment in the rest of the lines but triple-slash comment preferred (it is mostly work-around IJ IDEA's autoformatting).

```typescript
/// <dependency-tree
// depends-on="./users/myself/work/canva/tools/dependency-tree/tests/fixtures/directive/index.ts"
// />
```

The line below will be treated as a comment and not being parsed because of the triple-slash prefix not in use.

```typescript
// <dependency-tree invalid directive declaration example />
```

#### Example

```bash
root_dir/
  |- index.js
  |- dep1.sh
  |- util.ts
  |- dir1/
      |- dep5.py
      |- dir2/
          |- dep6.md
```

```typescript
// root_dir/util.ts

/// <dependency-tree depends-on="./dep1.sh" />
///<dependency-tree depends-on="./dir1/**/*" />
```

```typescript
// index.js
const dependencyTree = new DependencyTree(['root_dir']);
const result = await dependencyTree.gather();
const dependencies = result.resolved;
//{
//  "root_dir/util.ts" => Set {
//    "root_dir/dep1.sh",
//    "root_dir/dir1/dep5.py",
//    "root_dir/dir1/dir2/dep6.md",
// },
//}
```

[xml]: https://www.w3schools.com/xml/
[typescript]: https://www.typescriptlang.org/docs/home.html
