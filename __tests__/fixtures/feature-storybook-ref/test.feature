@storybook
Feature: a.b.c

  Background:
    # e.steps.ts
    Given I am a "storybook" user
    And I visit the "Bla" story of the "a" storybook
    # d.steps.ts
    Then I open foo panel
    # a.steps.ts
    And I search for "banana" in the panel bar

  Scenario: Whatever
    And I visit the "Foo" story of the "b" storybook
    # d.steps.ts
    Then I open foo panel

  Scenario: MultiPath
    And I visit the "Foo" story of the "d/e" storybook
    Then I open foo panel

  Scenario: And this
    And I visit the "Baz" story of the "c" storybook
    # a.steps.ts
    And I see the bar panel is collapsed

  Scenario: Steps testing
    # b.steps.ts
    And I open biz directory
    # b.steps.ts
    Then I do not see 42 files in biz
