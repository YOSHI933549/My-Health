import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../ios/App/App/AppDelegate.swift", import.meta.url), "utf8");

function methodBody(signatureStart) {
  const start = source.indexOf(signatureStart);
  assert.notEqual(start, -1, `missing ${signatureStart}`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let i = brace; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(brace + 1, i);
    }
  }
  throw new Error(`unclosed ${signatureStart}`);
}

const urlOpen = methodBody("func application(_ app: UIApplication, open url: URL");
assert.match(
  urlOpen,
  /return ApplicationDelegateProxy\.shared\.application\(app, open: url, options: options\)/
);

const userActivity = methodBody("func application(_ application: UIApplication, continue userActivity: NSUserActivity");
assert.match(
  userActivity,
  /return ApplicationDelegateProxy\.shared\.application\(application, continue: userActivity, restorationHandler: restorationHandler\)/
);
