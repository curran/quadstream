import { test, expect } from "@playwright/test";

test("production build boots under a non-root base path", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url().startsWith("http://127.0.0.1:4174/")) {
      errors.push(response.url() + ": " + response.status());
    }
  });
  await page.goto("/migration/");
  await expect(page).toHaveTitle("Quadstream Globe");
  await expect(page.getByRole("heading", { name: "Quadstream Globe" })).toBeVisible();
  await page.waitForLoadState("load");
  expect(errors).toEqual([]);
});
