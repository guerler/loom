// A saved Olit session, opened again from GalaxyAI's chat list on another machine: the stub host
// speaks GalaxyAI's brain protocol and commands `chat/open`. The conversation must come back as
// saved, and saving it again must replace that chat, not add another. A chat GalaxyAI held opens
// from its turns and saves anew, a `chat/ask` is asked, a later command switches the running brain,
// and the brain reports each chat it shows with `chat/activeChanged`.
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

/** A fresh browser profile, so nothing of an earlier session is stored: another machine. */
async function machine(browser, url, booting = true) {
    const page = await (await browser.newContext()).newPage();
    await storedProvider(page, { provider: "openrouter", baseUrl: `${STUB}/v1`, apiKey: "sk-or-v1-stubkeystubkey", model: "stub-model" });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    const frame = page.frameLocator("#galaxy_visualization");
    if (!booting) return { page, frame, ready: false };
    const ready = await frame
        .locator("text=/Ready\\./")
        .first()
        .waitFor({ timeout: 120000 })
        .then(() => true)
        .catch(() => false);
    return { page, frame, ready };
}

async function say(frame, text) {
    await frame.locator("#input").fill(text);
    await frame.locator("#send-btn").click();
    await frame.locator("text=Noted.").last().waitFor({ timeout: 60000 });
}

const stored = async () => (await fetch(`${STUB}/__chats`)).json();
const hosted = (page) => page.evaluate(() => window.__galaxyAi);

/** Save once the turn has ended, and wait for the write it makes; the stub serves every drive. */
async function save(frame) {
    const before = (await stored()).writes.length;
    await frame.locator("#save-btn:not([disabled])").click({ timeout: 30000 });
    for (let i = 0; i < 40; i++) {
        const now = await stored();
        if (now.writes.length > before) return now;
        await new Promise((r) => setTimeout(r, 250));
    }
    return stored();
}

(async () => {
    await fetch(`${STUB}/__script?name=plain`);
    const browser = await playwright[BROWSER].launch();

    const first = await machine(browser, `${HOST}?dataset_id=dsaved&frame=1&view=chat`);
    check("the first machine boots", first.ready);
    await say(first.frame, "remember the saved session marker");
    const known = new Set(Object.keys((await stored()).chats));
    const saved = await save(first.frame);
    const made = Object.keys(saved.chats).filter((id) => !known.has(id));
    const id = made[0];
    const chat = saved.chats[id];
    check(
        "saving creates one Olit chat, with its turns and its session",
        made.length === 1 &&
            chat?.agent_type === "olit" &&
            chat.messages[0]?.query === "remember the saved session marker" &&
            chat.document?.olit_session !== undefined,
        JSON.stringify(saved.writes.slice(-2)),
    );

    check("the brain reports the chat a save created", (await hosted(first.page)).active.at(-1) === id, JSON.stringify((await hosted(first.page)).active));

    const second = await machine(browser, `${HOST}?exchange_id=${id}&frame=1&view=chat`);
    check("the second machine boots on the saved chat", second.ready);
    const text = await second.frame.locator("body").innerText();
    check(
        "the conversation comes back as saved",
        text.includes("remember the saved session marker"),
        text.replace(/\s+/g, " ").slice(0, 300),
    );
    check("it is said to be the saved session", /Opened a saved conversation/.test(text));
    check("nothing claims the load failed", !/Could not open saved conversation/.test(text));
    const secondHost = await hosted(second.page);
    check(
        "the command was acknowledged, and the brain reports the chat it shows",
        secondHost.answers.some((a) => a.id === secondHost.commands[0].id && a.result) && secondHost.active.at(-1) === id,
        JSON.stringify(secondHost),
    );

    await say(second.frame, "and one more turn");
    const after = await save(second.frame);
    check(
        "saving again replaces that chat rather than adding one",
        Object.keys(after.chats).length === Object.keys(saved.chats).length && after.writes.at(-1) === `PUT ${id}`,
        JSON.stringify(after.writes.slice(-2)),
    );

    // A chat GalaxyAI held before Olit: its turns, no session.
    const turns = [{ query: "Which aligner for RNA-seq?", response: "HISAT2 or STAR." }];
    await fetch(`${STUB}/__held?id=g1&turns=${encodeURIComponent(JSON.stringify(turns))}`);
    const held = await machine(browser, `${HOST}?exchange_id=g1&frame=1&view=chat`);
    const heldText = await held.frame.locator("body").innerText();
    check(
        "a chat GalaxyAI held opens from its questions and answers",
        held.ready && heldText.includes("Which aligner for RNA-seq?") && heldText.includes("HISAT2 or STAR."),
        heldText.replace(/\s+/g, " ").slice(0, 300),
    );
    check("it says what came along and what did not", /held by GalaxyAI before Olit/.test(heldText));
    await say(held.frame, "and for counting?");
    const continued = await save(held.frame);
    const added = continued.writes.at(-1);
    check(
        "saving it adds a chat and leaves GalaxyAI's as it was",
        /^POST c\d+$/.test(added) && continued.chats.g1.document === null,
        JSON.stringify(continued.writes.slice(-2)),
    );

    // A later command switches the running brain to another chat, without reloading the frame.
    const marker = await held.page.evaluate(() => (window.__marker = Math.random()));
    await held.page.evaluate((chatId) => window.__command("chat/open", { exchange_id: chatId }), id);
    const switched = await held.frame
        .locator("text=and one more turn")
        .first()
        .waitFor({ timeout: 60000 })
        .then(() => true, () => false);
    const afterSwitch = await hosted(held.page);
    check(
        "a later chat/open switches the running brain, and the brain reports it",
        switched && afterSwitch.active.at(-1) === id && (await held.page.evaluate(() => window.__marker)) === marker,
        JSON.stringify(afterSwitch.active),
    );

    // A chat Galaxy does not give this user: another user's, or one deleted.
    const missing = await machine(browser, `${HOST}?exchange_id=gone&frame=1&view=chat`);
    const missingText = await missing.frame.locator("body").innerText();
    check(
        "a chat Galaxy does not give is said not to open, and a new conversation starts",
        missing.ready && /Could not open saved conversation gone/.test(missingText),
        missingText.replace(/\s+/g, " ").slice(0, 300),
    );
    check("the brain reports that it shows no saved chat", (await hosted(missing.page)).active.at(-1) === null);

    // A question GalaxyAI hands over, asked in a new conversation.
    const asked = await machine(browser, `${HOST}?question=${encodeURIComponent("count my datasets please")}&frame=1&view=chat`);
    const answered = await asked.frame
        .locator("text=Noted.")
        .last()
        .waitFor({ timeout: 60000 })
        .then(() => true, () => false);
    const askedText = await asked.frame.locator("body").innerText();
    check("a handed-over question is asked once ready", answered && askedText.includes("count my datasets please"));

    const failed = results.filter((r) => !r.ok);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    await browser.close();
    process.exit(failed.length ? 1 : 0);
})();
