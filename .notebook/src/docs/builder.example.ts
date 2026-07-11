export const foo = (value: string) => (count: number) => value.repeat(count);

const result = foo("na")(2);

console.log(result);
