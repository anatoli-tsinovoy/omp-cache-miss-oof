import type { AudioPlayback } from "@oh-my-pi/pi-natives";
import type { Usage } from "@oh-my-pi/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { detectCacheInvalidation } from "@oh-my-pi/pi-coding-agent/modes/components/cache-invalidation-marker";
import { decodePcm16MonoWav, type DecodedSound, startSound } from "./audio";
import { SoundCycle } from "./sound-cycle";

const SOUND_URLS = [
	new URL("../sounds/unfa-oof.wav", import.meta.url),
	new URL("../sounds/unfa-oof-filtered.wav", import.meta.url),
] as const;

async function loadSounds(): Promise<DecodedSound[]> {
	return await Promise.all(
		SOUND_URLS.map(async url => decodePcm16MonoWav(url.pathname.split("/").at(-1) ?? url.pathname, await Bun.file(url).arrayBuffer())),
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
	let sounds: Promise<DecodedSound[]> | undefined;
	let cycle: SoundCycle<DecodedSound> | undefined;
	let playback: AudioPlayback | undefined;

	const syncBaseline = (_event: unknown, ctx: ExtensionContext) => {
		baseline = restoreUsageBaseline(ctx);
	};

	const playNext = async (): Promise<void> => {
		sounds ??= loadSounds();
		cycle ??= new SoundCycle(await sounds);
		const sound = cycle.next();
		const started = startSound(sound, playback);
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
		description: "Play the next cache-miss sound",
		handler: async (_args, ctx) => {
			await (playSound ?? playNext)();
			ctx.ui.notify("Played the next cache-miss sound", "info");
		},
	});
}
