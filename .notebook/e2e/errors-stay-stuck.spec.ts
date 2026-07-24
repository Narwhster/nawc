import { test, expect } from "@playwright/test";

test.describe("errors stay stuck", () => {
  test("error from interrupted turn should not pile up at bottom", async ({ page }) => {
    await page.goto("/");

    // Wait for the agent panel to be ready
    const messageInput = page.getByRole("textbox", { name: "Message the agent" });
    await expect(messageInput).toBeVisible();

    // Select DeepSeek V4 Free model
    const modelButton = page.getByRole("button", { name: "Model" });
    await modelButton.click();
    const deepseekOption = page.getByRole("option", { name: /DeepSeek V4.*Free/i });
    await deepseekOption.click();

    // Send first message
    await messageInput.fill("think carefully about this");
    await messageInput.press("Enter");

    // Wait for the agent to start working (showing "Working" or "Stop agent" button)
    const workingIndicator = page.getByText("Working");
    const stopButton = page.getByRole("button", { name: "Stop agent" });
    
    // Wait for either the working indicator or stop button to appear
    await expect(workingIndicator.or(stopButton)).toBeVisible({ timeout: 15000 });

    // Small delay to ensure agent is actively processing
    await page.waitForTimeout(500);

    // Interrupt the agent
    const stopBtn = page.getByRole("button", { name: "Stop agent" });
    if (await stopBtn.isVisible()) {
      await stopBtn.click();
    }

    // Wait for the error to appear (may take a moment after interruption)
    const errorAlert = page.getByRole("alert").filter({ hasText: "Agent error" });
    await expect(errorAlert).toBeVisible({ timeout: 10000 });

    // Get the position of the first error
    const firstErrorBox = await errorAlert.boundingBox();
    expect(firstErrorBox).not.toBeNull();

    // Send second message
    await messageInput.fill("another test message");
    await messageInput.press("Enter");

    // Wait for the second message to appear
    const secondMessage = page.getByText("another test message");
    await expect(secondMessage).toBeVisible({ timeout: 15000 });

    // The first error should be ABOVE the second message, not at the bottom
    const secondMessageBox = await secondMessage.boundingBox();
    expect(secondMessageBox).not.toBeNull();

    // First error's bottom edge should be above the second message's top edge
    // (or at least not below it, which would mean it's piling up at the bottom)
    expect(firstErrorBox!.y + firstErrorBox!.height).toBeLessThanOrEqual(secondMessageBox!.y);
  });
});
