import { test, expect } from "@playwright/test";
import { registerGlobeSuite } from "./globe-suite.mjs";

registerGlobeSuite(test, expect, { entry: "/examples/globe/index.html" });
