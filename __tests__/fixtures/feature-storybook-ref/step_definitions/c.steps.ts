import { createCucumberWrapper } from "features/support/cucumber_wrapper";

const { stepDefinitions, When } = createCucumberWrapper();

When(/^I open panel C$/, function (this: any) {
  //
});

export default stepDefinitions;
