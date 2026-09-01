import type { Usage } from "@oh-my-pi/pi-ai";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { detectCacheInvalidation } from "@oh-my-pi/pi-coding-agent/modes/components/cache-invalidation-marker";
import { StreamingAudioPlayer } from "@oh-my-pi/pi-coding-agent/tts/streaming-player";
import { decodePcm16MonoWav, type DecodedSound, startSound } from "./audio";
import { SoundCycle } from "./sound-cycle";

const SOUND_URLS = [
	new URL("../sounds/unfa-oof.wav", import.meta.url),
	new URL("../sounds/unfa-oof-filtered.wav", import.meta.url),
] as const;

interface UsageBaseline {
	usage: Usage;
	provider: string;
	model: string;
}

async function loadSounds(): Promise<DecodedSound[]> {
	return await Promise.all(
		SOUND_URLS.map(async url => decodePcm16MonoWav(url.pathname.split("/").at(-1) ?? url.pathname, await Bun.file(url).arrayBuffer())),
	);
}

export default function cacheMissOof(pi: ExtensionAPI): void {
	let baseline: UsageBaseline | undefined;
	let sounds: Promise<DecodedSound[]> | undefined;
	let cycle: SoundCycle<DecodedSound> | undefined;
	let playback: StreamingAudioPlayer | undefined;

	const resetBaseline = () => {
		baseline = undefined;
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
		void playNext().catch(error => {
			pi.logger.warn("Cache-miss sound playback failed", {
				error: error instanceof Error ? error.message : String(error),
			});
		});
	};

	pi.on("session_start", resetBaseline);
	pi.on("session_switch", resetBaseline);
	pi.on("session_branch", resetBaseline);
	pi.on("session_tree", resetBaseline);
	pi.on("session_compact", resetBaseline);
	pi.on("session_shutdown", () => {
		playback?.stop();
		playback = undefined;
	});

	pi.on("message_end", event => {
		if (event.message.role !== "assistant") return;

		const message = event.message;
		const usage = message.usage;
		if (usage.cacheRead + usage.cacheWrite + usage.input <= 0) return;

		const previousUsage =
			baseline?.provider === message.provider && baseline.model === message.model ? baseline.usage : undefined;
		const miss = detectCacheInvalidation(previousUsage, usage);
		baseline = { usage, provider: message.provider, model: message.model };

		if (miss) playNextDetached();
	});

	pi.registerCommand("cache-miss-oof", {
		description: "Play the next cache-miss sound",
		handler: async (_args, ctx) => {
			await playNext();
			ctx.ui.notify("Played the next cache-miss sound", "info");
		},
	});
}
