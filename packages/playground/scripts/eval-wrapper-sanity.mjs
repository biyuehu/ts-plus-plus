// Sanity check for the eval wrapper used in src/vendor/playground/sidebar/runtime.ts.
// Simulates a browser scope WITHOUT `exports`/`require` (vite ESM) by running the
// eval inside a function whose only extra param is a fake console.
const userCode = `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.greet = void 0;
const greet = () => console.log("greet ok, esModule =", exports.__esModule);
exports.greet = greet;
`;

const captured = [];
const fakeConsole = { log: (...a) => captured.push(a.join(" ")) };

const wrapper = code =>
  `(function (exports, module, require, console) {
module = { exports: exports };
${code}
return module.exports;
})({}, void 0, name => { throw new Error("require(" + name + ") is not supported") }, fakeConsole)`;

const result = eval(wrapper(userCode));

result.greet();
if (!captured[0].includes("greet ok, esModule = true")) throw new Error("console capture failed: " + captured[0]);
if (!Object.keys(result).includes("greet")) throw new Error("exports wiring failed");

// UMD-style guard should fall through to the exports branch (define undefined).
const umdCode = `"use strict";
(function (factory) {
  if (typeof exports === "object" && typeof module !== "undefined") factory(exports);
})(function (exports) { exports.flag = 42; });
`;
const result2 = eval(wrapper(umdCode));
if (result2.flag !== 42) throw new Error("umd branch failed");

// var require declared by user code must still parse (param binding, not const).
const varRequire = `var require = function () { return 1 }; exports.ok = require() === 1;`;
const result3 = eval(wrapper(varRequire));
console.log("result3:", JSON.stringify(result3));
if (result3.ok !== true) throw new Error("var require shadow failed");

console.log("wrapper sanity: 3/3 OK");
