import { createCucumberWrapper } from "features/support/cucumber_wrapper";

const { stepDefinitions, When } = createCucumberWrapper();

When(/^I am an? "([^"]*)" user$/, function (this: any, env: string) {
  //
});

export default stepDefinitions;
