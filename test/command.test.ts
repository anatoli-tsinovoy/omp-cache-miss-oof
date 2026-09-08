import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext, RegisteredCommand } from "@oh-my-pi/pi-coding-agent";
import cacheMissOof from "../src/index";

function harness() {
	const entries: unknown[] = [];
	const notifications: { message: string; level: string }[] = [];
	const events = new Map<string, (event: unknown, ctx: ExtensionCommandContext) => void>();
	let command: RegisteredCommand;
	const api = {
		on: (name: string, handler: (event: unknown, ctx: ExtensionCommandContext) => void) => events.set(name, handler),
		registerCommand: (_name: string, registered: RegisteredCommand) => { command = registered; },
		appendEntry: (customType: string, data: unknown) => entries.push({ type: "custom", customType, data }),
		logger: { warn: () => { } },
	} as unknown as ExtensionAPI;
	const ctx = {
		cwd: tmpdir(),
		sessionManager: { getBranch: () => entries },
		ui: { notify: (message: string, level: string) => notifications.push({ message, level }) },
	} as unknown as ExtensionCommandContext;
	cacheMissOof(api, async () => { });
	return { entries, notifications, events, ctx, run: (args: string) => command.handler(args, ctx) };
}

test("directory replacement is atomic and reset restores bundled sounds", async () => {
	const directory = await mkdtemp(join(tmpdir(), "oof roster "));
	try {
		await Bun.write(join(directory, "clip.wav"), Bun.file(new URL("../sounds/unfa-oof.wav", import.meta.url)));
		const h = harness();
		await h.run(`directory "${directory}"`);
		await h.run("status");
		expect(h.notifications.at(-1)?.message).toContain(directory);
		await h.run(`directory ${join(directory, "missing")}`);
		expect(h.notifications.at(-1)?.level).toBe("error");
		await h.run("status");
		expect(h.notifications.at(-1)?.message).toContain(directory);
		expect(h.entries).toHaveLength(1);
		await h.run("reset");
		await h.run("status");
		expect(h.notifications.at(-1)?.message).toContain("bundled OOF sounds");
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("session navigation restores the branch's configured directory or bundled roster", async () => {
	const h = harness();
	h.entries.push({ type: "custom", customType: "cache-miss-oof-config", data: { directory: "/saved/audio" } });
	h.events.get("session_start")!({}, h.ctx);
	await h.run("status");
	expect(h.notifications.at(-1)?.message).toContain("/saved/audio");
	h.entries.length = 0;
	h.events.get("session_switch")!({}, h.ctx);
	await h.run("status");
	expect(h.notifications.at(-1)?.message).toContain("bundled OOF sounds");
});
