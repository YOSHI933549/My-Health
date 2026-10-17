import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../../js/app.js", import.meta.url), "utf8");
const STORAGE_KEY = "yoshi-health-tracker-v1";

// Shared stand-in for the browser objects app.js touches while the tests run.
// The symptom and weight tests used to keep their own copies of this setup.
export function loadApp(seed) {
  const store = {};
  if (seed !== undefined) store[STORAGE_KEY] = JSON.stringify(seed);
  const localStorage = {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    },
    removeItem(key) {
      delete store[key];
    },
  };
  class Image {
    set src(_value) {
      if (typeof this.onload === "function") this.onload();
    }
  }
  const context = {
    localStorage,
    document: {
      addEventListener() {},
      getElementById() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      createElement() {
        return { textContent: "" };
      },
    },
    navigator: {},
    location: { hash: "", pathname: "/", search: "" },
    history: { replaceState() {} },
    console,
    structuredClone,
    Image,
    atob,
    TextDecoder,
    Uint8Array,
    Map,
    Set,
    Date,
    JSON,
    Math,
    Number,
    String,
    Object,
    Array,
    Promise,
  };
  context.window = context;
  const before = store[STORAGE_KEY];
  vm.createContext(context);
  vm.runInContext(source, context, { filename: "js/app.js" });
  return {
    context,
    before,
    raw() {
      return store[STORAGE_KEY];
    },
    saved() {
      return store[STORAGE_KEY] ? JSON.parse(store[STORAGE_KEY]) : null;
    },
  };
}
