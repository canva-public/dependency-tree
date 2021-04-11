type MyMagicEntryPoint = {
  file: string;
  anotherProperty?: number;
  needed?: any;
};

class SomeError extends Error {}

type MyString = string;

export const doSomeAwesomeStuff = () => {};

(() => {
  // one more trick here
})();

export const entry = {
  file: "./b",
};

export const secondEntryPoint = {
  // no 'file' property provided
};

export const entryPoint: MyMagicEntryPoint = {
  anotherProperty: 0,
  needed: {
    content: void 42,
  },
  file: "./c",
};
