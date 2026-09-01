import { describe, expect, test } from "bun:test";
import type { AssistantMessage, Usage } from "@oh-my-pi/pi-ai";
import { detectCacheInvalidation } from "@oh-my-pi/pi-coding-agent/modes/components/cache-invalidation-marker";
import type { ExtensionAPI, ExtensionContext, SessionMessageEntry } from "@oh-my-pi/pi-coding-agent";
import { decodePcm16MonoWav } from "../src/audio";
import { SoundCycle } from "../src/sound-cycle";
import cacheMissOof from "../src/index";

const SOUND_NAMES = ["unfa-oof.wav", "unfa-oof-filtered.wav"] as const;

function usage(values: Partial<Usage>): Usage {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		...values,
	};
}

function assistantMessage(messageUsage: Usage): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "done" }],
		api: "anthropic-messages",
		provider: "anthropic",
		model: "claude-test",
		usage: messageUsage,
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

describe("cache-miss sound behavior", () => {
	test("OMP's warm-to-cold transition advances through every bundled sound and wraps", async () => {
		const warm = usage({ cacheRead: 48_000 });
		const cold = usage({ cacheWrite: 48_500, input: 120 });
		expect(detectCacheInvalidation(warm, cold)).toEqual({ reprocessedTokens: 48_620 });

		const sounds = await Promise.all(
			SOUND_NAMES.map(async name =>
				decodePcm16MonoWav(name, await Bun.file(new URL(`../sounds/${name}`, import.meta.url)).arrayBuffer()),
			),
		);
		const cycle = new SoundCycle(sounds);
		const visited = [...sounds.map(() => cycle.next().name), cycle.next().name];

		expect(visited).toEqual([...SOUND_NAMES, SOUND_NAMES[0]]);
		expect(sounds.every(sound => sound.sampleRate === 24_000 && sound.pcm.length > 0)).toBe(true);
		expect(sounds[1]?.pcm).not.toEqual(sounds[0]?.pcm);
	});

	test("the first live miss after startup plays using the restored session baseline", async () => {
		const callbacks = new Map<string, unknown>();
		const api = {
			on: (event: string, handler: unknown) => callbacks.set(event, handler),
			registerCommand: () => {},
			logger: { warn: () => {} },
		} as unknown as ExtensionAPI;
		let playCount = 0;
		cacheMissOof(api, async () => {
			playCount++;
		});

		const warmEntry = {
			type: "message",
			id: "warm",
			parentId: null,
			timestamp: new Date().toISOString(),
			message: assistantMessage(usage({ cacheRead: 48_000 })),
		} satisfies SessionMessageEntry;
		const ctx = {
			sessionManager: { getBranch: () => [warmEntry] },
		} as unknown as ExtensionContext;
		const sessionStart = callbacks.get("session_start") as (
			event: { type: "session_start" },
			context: ExtensionContext,
		) => void;
		const messageEnd = callbacks.get("message_end") as (
			event: { type: "message_end"; message: AssistantMessage },
		) => void;

		sessionStart({ type: "session_start" }, ctx);
		messageEnd(
			{
				type: "message_end",
				message: assistantMessage(usage({ cacheRead: 0, cacheWrite: 48_500, input: 120 })),
			},
		);

		await Promise.resolve();
		expect(playCount).toBe(1);
	});
});
