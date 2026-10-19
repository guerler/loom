// GalaxyAI's brain protocol around Olit's lifecycle, against the stub's host page. A frame whose host
// never answers says so rather than start on its own; the chat shown is reported from a click as
// from anywhere (WebKit names the parent as the sender of such messages, which the session's port
// makes moot); and a command that lands mid-answer leaves the question, not half an answer, and no
// run that resumes by itself. BROWSER=firefox or webkit runs it there; WebKit keeps no
// conversations in the browser, so the mid-answer part runs in the other two.
const playwright = require("playwright");
const storedProvider = require("./stored-provider.cjs");
const BROWSER = process.env.BROWSER || "chromium";
const STUB = "http://127.0.0.1:8099";
const HOST = `${STUB}/plugins/visualizations/olit`;

const results = [];
function check(name, ok, detail) {
    results.push({ name, ok });
    console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
}

const hosted = (page) => page.evaluate(() => window.__galaxyAi);
const calls = async () => (await (await fetch(`${STUB}/__seen`)).json()).calls;
const until = async (test, ms = 30000) => {
    const end = Date.now() + ms;
    let ok = await test();
    while (!ok && Date.now() < end) {
        await new Promise((r) => setTimeout(r, 200));
        ok = await test();
    }
    return ok;
};

async function machine(browser, url) {
    const page = await (await browser.newContext()).newPage();
    await storedProvider(page, { provider: "openrouter", baseUrl: `${STUB}/v1`, apiKey: "sk-or-v1-stubkeystubkey", model: "stub-model" });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    return { page, frame: page.frameLocator("#galaxy_visualization") };
}

const ready = (frame) =>
    frame
        .locator("text=/Ready\./")
        .first()
        .waitFor({ timeout: 120000 })
        .then(() => true, () => false);

(async () => {
    const browser = await playwright[BROWSER].launch();

    // A frame host that does not speak the protocol: the brain waits out initialize, then says so.
    const silent = await machine(browser, `${HOST}?dataset_id=dlife&frame=1&host=none`);
    const said = await silent.frame
        .locator("text=/could not connect to GalaxyAI/")
        .waitFor({ timeout: 30000 })
        .then(() => true, () => false);
    const silentText = await silent.frame.locator("body").innerText();
    check("a host that never answers is said not to, and Olit does not start on its own",
        said && !/Ready\./.test(silentText), silentText.replace(/\s+/g, " ").slice(0, 200));

    await fetch(`${STUB}/__script?name=plain`);
    const { page, frame } = await machine(browser, `${HOST}?dataset_id=dlife&frame=1`);
    check("the hosted brain boots", await ready(frame));
    await frame.locator("#input").fill("remember this");
    await frame.locator("#send-btn").click();
    await frame.locator("text=Noted.").last().waitFor({ timeout: 60000 });
    await frame.locator("#save-btn:not([disabled])").click({ timeout: 30000 });
    const saved = await until(async () => typeof (await hosted(page)).active.at(-1) === "string");
    const savedId = (await hosted(page)).active.at(-1);
    check("a save is reported", saved, JSON.stringify((await hosted(page)).active));

    // Reported from the click itself: the message WebKit gives the wrong sender.
    await frame.locator("#reset-btn").click();
    check("a new conversation, started by a click, is reported",
        await until(async () => (await hosted(page)).active.at(-1) === null), JSON.stringify((await hosted(page)).active));

    if (BROWSER !== "webkit") {
        await fetch(`${STUB}/__script?name=slow-once`);
        await frame.locator("#input").fill("answer slowly");
        await frame.locator("#send-btn").click();
        check("the answer is in flight", await until(async () => (await calls()) >= 1));

        const id = await page.evaluate((exchangeId) => window.__command("chat/open", { exchange_id: exchangeId }), savedId);
        const switched = await until(async () => {
            const record = await hosted(page);
            return record.answers.some((a) => a.id === id && a.result) && record.active.at(-1) === savedId;
        });
        check("a command mid-answer is taken, and the saved chat shown", switched, JSON.stringify(await hosted(page)));

        await page.evaluate(() => window.__command("chat/open", {}));
        await ready(frame);
        const back = await until(async () => /answer slowly/.test(await frame.locator("body").innerText()), 60000);
        check("back on its own conversation, the interrupted question is there", back);
        await new Promise((r) => setTimeout(r, 3000));
        const text = await frame.locator("body").innerText();
        check("the interrupted answer neither shows nor resumes by itself",
            !/the abandoned answer/.test(text) && (await calls()) === 1, `calls ${await calls()}`);
        const idle = await until(() => frame.locator("#send-btn").evaluate((b) => !b.classList.contains("hidden")), 30000);
        check("Send is there to continue with", idle, idle ? "" : (await frame.locator("body").innerText()).replace(/\s+/g, " ").slice(-300));
    }

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    await browser.close();
    process.exit(failed.length ? 1 : 0);
})();
