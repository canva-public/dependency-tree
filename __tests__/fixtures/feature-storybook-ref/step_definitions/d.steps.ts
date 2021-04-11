import { createCucumberWrapper } from "features/support/cucumber_wrapper";

const { stepDefinitions, When } = createCucumberWrapper();

When(/^I open foo panel$/, function (this: any) {
  //
});

export default stepDefinitions;
