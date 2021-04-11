import { createCucumberWrapper } from "features/support/cucumber_wrapper";

const { stepDefinitions, Given } = createCucumberWrapper();

Given(/^Do not match to anything$/, function (this: any, env: string) {
  //
});

export default stepDefinitions;
