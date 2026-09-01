import { describe, expect, test } from "bun:test";
import { SoundCycle } from "../src/sound-cycle";

describe("SoundCycle", () => {
	test("visits every sound in order before wrapping", () => {
		const cycle = new SoundCycle(["hit", "oof", "bonk"] as const);

		expect([cycle.next(), cycle.next(), cycle.next(), cycle.next()]).toEqual(["hit", "oof", "bonk", "hit"]);
	});

	test("rejects an empty closed set", () => {
		expect(() => new SoundCycle([])).toThrow("Sound cycle cannot be empty");
	});
});
