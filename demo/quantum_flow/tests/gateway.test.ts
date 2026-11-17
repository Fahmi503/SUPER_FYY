import test from "node:test";
import assert from "node:assert";
import { ApiGateway } from "../app/gateway.js";

test("ApiGateway initialization", () => {
  const gw = new ApiGateway(9090);
  assert.ok(gw);
});
