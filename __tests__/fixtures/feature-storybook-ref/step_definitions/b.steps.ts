import { createCucumberWrapper } from "features/support/cucumber_wrapper";

const { stepDefinitions, Given, Then } = createCucumberWrapper();

Then(/^I open biz directory$/, function (this: any) {
  //
});

Given(
  /^I( do not)? see (\d*) files in biz$/,
  function (this: any, negate: string, number: string) {
    //
  }
);

export default stepDefinitions;
