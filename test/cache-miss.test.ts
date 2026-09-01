import { describe, expect, test } from "bun:test";
import type { Usage } from "@oh-my-pi/pi-ai";
import { detectCacheInvalidation } from "@oh-my-pi/pi-coding-agent/modes/components/cache-invalidation-marker";
import { decodePcm16MonoWav } from "../src/audio";
import { SoundCycle } from "../src/sound-cycle";

const SOUND_NAMES = [
	"block-hit-1.wav",
	"oof-1.wav",
	"block-hit-2.wav",
	"oof-2.wav",
	"block-hit-3.wav",
	"oof-3.wav",
] as const;

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
	});
});
