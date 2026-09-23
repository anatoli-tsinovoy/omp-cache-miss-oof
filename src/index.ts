import { homedir } from "node:os";
import { resolve } from "node:path";
import type { AudioPlayback } from "@oh-my-pi/pi-natives";
import type { Usage } from "@oh-my-pi/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { detectCacheInvalidation } from "@oh-my-pi/pi-tui/chat/cache-invalidation-marker";
import { decodePcm16MonoWav, startSound, type DecodedSound } from "./audio";
import { SoundCycle } from "./sound-cycle";
import { loadDirectorySounds } from "./roster";

const CONFIG_ENTRY = "cache-miss-oof-config";

const SOUND_URLS = [
	new URL("../sounds/unfa-oof.wav", import.meta.url),
	new URL("../sounds/unfa-oof-filtered.wav", import.meta.url),
] as const;

async function loadSounds(): Promise<DecodedSound[]> {
	return await Promise.all(
		SOUND_URLS.map(async url =>
			decodePcm16MonoWav(url.pathname.split("/").at(-1) ?? url.pathname, await Bun.file(url).arrayBuffer()),
		),
	);
}

function restoreUsageBaseline(ctx: ExtensionContext): Usage | undefined {
	const branch = ctx.sessionManager.getBranch();
	for (let index = branch.length - 1; index >= 0; index--) {
		const entry = branch[index];
		if (entry?.type !== "message" || entry.message.role !== "assistant") continue;
		const message = entry.message;
		const usage = message.usage;
		if (usage.cacheRead + usage.cacheWrite + usage.input <= 0) continue;
		return usage;
	}
	return undefined;
}

export default function cacheMissOof(pi: ExtensionAPI, playSound?: () => Promise<void>): void {
	let baseline: Usage | undefined;
	let directory: string | undefined;
	let cycle: Promise<SoundCycle<DecodedSound>> | undefined;
	let playback: AudioPlayback | undefined;

	const replaceRoster = (nextDirectory: string | undefined, sounds?: DecodedSound[]): void => {
		playback?.stop();
		playback = undefined;
		directory = nextDirectory;
		cycle = sounds ? Promise.resolve(new SoundCycle(sounds)) : undefined;
	};

	const syncBaseline = (_event: unknown, ctx: ExtensionContext) => {
		baseline = restoreUsageBaseline(ctx);
		let restored: string | undefined;
		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== "custom" || entry.customType !== CONFIG_ENTRY) continue;
			const data = entry.data as { directory?: unknown } | undefined;
			if (data?.directory === null) restored = undefined;
			else if (typeof data?.directory === "string") restored = data.directory;
		}
		if (restored !== directory) replaceRoster(restored);
	};

	const playNext = async (): Promise<void> => {
		const pending = cycle ??= (directory ? loadDirectorySounds(directory) : loadSounds())
			.then(sounds => new SoundCycle(sounds));
		let roster: SoundCycle<DecodedSound>;
		try {
			roster = await pending;
		} catch (error) {
			if (cycle === pending) cycle = undefined;
			throw error;
		}
		if (cycle !== pending) return;
		const sound = roster.next();
		const started = await startSound(sound, playback);
		if (cycle !== pending) {
			started.player.stop();
			await started.done;
			return;
		}
		playback = started.player;
		try {
			await started.done;
		} finally {
			if (playback === started.player) playback = undefined;
		}
	};

	const playNextDetached = (): void => {
		void (playSound ?? playNext)().catch(error => {
			pi.logger.warn("Cache-miss sound playback failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		});
	};

	pi.on("session_start", syncBaseline);
	pi.on("session_switch", syncBaseline);
	pi.on("session_branch", syncBaseline);
	pi.on("session_tree", syncBaseline);
	pi.on("session_compact", syncBaseline);
	pi.on("session_shutdown", () => {
		playback?.stop();
		playback = undefined;
		cycle = undefined;
	});

	pi.on("message_end", event => {
		if (event.message.role !== "assistant") return;

		const message = event.message;
		const usage = message.usage;
		if (usage.cacheRead + usage.cacheWrite + usage.input <= 0) return;

		const miss = detectCacheInvalidation(baseline, usage);
		baseline = usage;

		if (miss) playNextDetached();
	});

	pi.registerCommand("cache-miss-oof", {
		description: "Play a sound, or configure: directory <path>, status, reset",
		handler: async (args, ctx) => {
			const input = args.trim();
			try {
				if (!input) {
					await (playSound ?? playNext)();
					ctx.ui.notify("Played the next cache-miss sound", "info");
				} else if (input === "status") {
					ctx.ui.notify(`Cache-miss sounds: ${directory ?? "bundled OOF sounds"}`, "info");
				} else if (input === "reset") {
					pi.appendEntry(CONFIG_ENTRY, { directory: null });
					replaceRoster(undefined);
					ctx.ui.notify("Using bundled OOF sounds", "info");
				} else if (input.startsWith("directory ")) {
					let path = input.slice("directory ".length).trim();
					if ((path.startsWith('"') && path.endsWith('"')) || (path.startsWith("'") && path.endsWith("'"))) {
						path = path.slice(1, -1);
					}
					if (!path) throw new Error("Provide an audio directory");
					if (path === "~") path = homedir();
					else if (path.startsWith("~/")) path = resolve(homedir(), path.slice(2));
					const nextDirectory = resolve(ctx.cwd, path);
					const sounds = await loadDirectorySounds(nextDirectory);
					pi.appendEntry(CONFIG_ENTRY, { directory: nextDirectory });
					replaceRoster(nextDirectory, sounds);
					ctx.ui.notify(`Using ${sounds.length} cache-miss sounds from ${nextDirectory}`, "info");
				} else {
					ctx.ui.notify("Usage: /cache-miss-oof [directory <path> | status | reset]", "warning");
				}
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			}
		},
	});
}
