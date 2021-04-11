import { createCucumberWrapper } from "features/support/cucumber_wrapper";

const { stepDefinitions, Given, Then } = createCucumberWrapper();

Then(
  /^I search for "([\w\s]*)" in the panel bar$/,
  function (this: any, arg: string) {
    //
  }
);

Given(
  /^I see the bar panel is (collapsed|expanded)$/,
  function (this: any, state: string) {
    //
  }
);

export default stepDefinitions;
