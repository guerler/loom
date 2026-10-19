// Save in Olit as GalaxyAI's brain: nothing to save in an empty conversation or while a turn runs,
// and available once it ends. GalaxyAI is not told whether the conversation is saved: the brain
// protocol has no event for it yet, which would come as a capability of its own, so Galaxy does not
// warn before unloading an unsaved conversation as it did for Olit as a visualization.
const playwright = require("playwright");
const storedProvider = require("./stored-provider.cjs");
const BROWSER = process.env.BROWSER || "chromium";
const STUB = "http://127.0.0.1:8099";
// Galaxy launches Olit on a dataset; the history is the one holding it.
const HOST = `${STUB}/plugins/visualizations/olit?dataset_id=e2edataset0002&frame=1`;

let failed = 0;
function check(name, ok, detail) {
    if (!ok) failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

(async () => {
    const browser = await playwright[BROWSER].launch();
    const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
    await storedProvider(page, { provider: "openrouter", baseUrl: `${STUB}/v1`, apiKey: "sk-or-v1-stubkeystubkey", model: "stub-model" });

    // The default scenario answers with a destructive call and opens the gate; this one just replies.
    await fetch(`${STUB}/__script?name=compact`);
    await page.goto(HOST, { waitUntil: "domcontentloaded" });
    const frame = page.frameLocator("#galaxy_visualization");
    const idle = () =>
        frame
            .locator("#send-btn:not(.hidden)")
            .waitFor({ timeout: 60000 })
            .then(() => true, () => false);

    check(
        "booted inside the frame",
        await frame.locator("text=/Ready\./").first().waitFor({ timeout: 120000 }).then(() => true, () => false),
    );
    check("an empty conversation offers nothing to save", await frame.locator("#save-btn").isDisabled());

    await frame.locator("#input").fill("list my histories please");
    await frame.locator("#send-btn").click();
    check("the turn finished", await idle());
    check("saving is available once it has", await frame.locator("#save-btn").isEnabled());

    // A second turn is what isolates the busy case: the first already made a turn to save.
    await frame.locator("#input").fill("and again please");
    await frame.locator("#send-btn").click();
    check("saving is unavailable while a turn runs", await frame.locator("#save-btn").isDisabled());
    check("the second turn finished", await idle());
    check("saving is available again once it has", await frame.locator("#save-btn").isEnabled());

    console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
    await browser.close();
    process.exit(failed ? 1 : 0);
})();
