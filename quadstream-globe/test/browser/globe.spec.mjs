import { test, expect } from "@playwright/test";
import { registerGlobeSuite } from "../../../test/browser/globe-suite.mjs";

registerGlobeSuite(test, expect, { entry: "/migration/" });
