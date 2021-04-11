// Copyright 2021 Canva Inc. All Rights Reserved.

/// <dependency-tree
// depends-on="./users/myself/work/canva/tools/dependency-tree/tests/fixtures/directive/index.ts"
// />

/// <dependency-tree
// depends-on="./users/myself/work/canva/tools/dependency-tree/tests/fixtures/directive/index.ts"
// />

import { execSync } from "child_process";
import { resolve } from "path";

/**
 * This file contains test cases of explicitly declared dependencies.
 */

export const getDependencies = () => {
  return [
    resolve(__dirname, "./dep1.ts"), /// <dependency-tree depends-on='./dep1.ts' />
    resolve(__dirname, "./dep2.js"), /// <dependency-tree
    ///   depends-on="./dep2.js"
    /// />
  ];
};

export const executeScript = () => {
  /// <dependency-tree depends-on="./dep3.sh" />
  execSync(resolve(__dirname, "./dep3.sh"));
};

/// <dependency-tree depends-on="./missing.proto" />

// <dependency-tree example="demo" /> // this line is not being parsed because of double-slash
// prefix
