import { test, expect } from "@playwright/test";
import { registerGlobeSuite } from "../../../test/browser/globe-suite.mjs";

registerGlobeSuite(test, expect, { entry: process.env.GLOBE_BASE_PATH ?? "/migration/" });
