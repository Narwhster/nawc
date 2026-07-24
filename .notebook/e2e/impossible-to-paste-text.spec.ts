import { test, expect } from "@playwright/test";

test("pasting text with @playwright/test should not error", async ({ page }) => {
  await page.goto("/");

  // Wait for the agent panel to be ready
  const messageInput = page.getByRole("textbox", { name: "Message the agent" });
  await expect(messageInput).toBeVisible();

  // Select DeepSeek V4 Free model
  const modelButton = page.getByRole("button", { name: "Model" });
  await modelButton.click();
  const deepseekOption = page.getByRole("option", { name: /DeepSeek V4.*Free/i });
  await deepseekOption.click();

  // Paste text containing @playwright/test
  const pastedText = `Error: Playwright Test did not expect test.describe() to be called here.

Most common reasons include:

- You are calling test.describe() in a configuration file.
- You are calling test.describe() in a file that is imported by the configuration file.
- You have two different versions of @playwright/test. This usually happens when one of the dependencies in your package.json depends on @playwright/test.
- You are calling test.describe() from an async test.describe() block. Only sync ones are supported.`;

  await messageInput.fill(pastedText);

  // Send the message
  const sendButton = page.getByRole("button", { name: "Send message" });
  await expect(sendButton).toBeEnabled();
  await sendButton.click();

  // Wait for the response to settle
  await page.waitForTimeout(2000);

  // The page content should not contain any error about file references
  const pageContent = await page.content();
  expect(pageContent).not.toContain("file reference");
});
