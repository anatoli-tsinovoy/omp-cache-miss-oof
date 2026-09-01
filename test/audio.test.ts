import { describe, expect, test } from "bun:test";
import { decodePcm16MonoWav } from "../src/audio";

function wav(samples: number[], sampleRate = 22_050): ArrayBuffer {
	const bytes = new ArrayBuffer(44 + samples.length * 2);
	const view = new DataView(bytes);
	for (const [offset, text] of [[0, "RIFF"], [8, "WAVE"], [12, "fmt "], [36, "data"]] as const) {
		for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
	}
	view.setUint32(4, bytes.byteLength - 8, true);
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, sampleRate, true);
	view.setUint32(28, sampleRate * 2, true);
	view.setUint16(32, 2, true);
	view.setUint16(34, 16, true);
	view.setUint32(40, samples.length * 2, true);
	for (let index = 0; index < samples.length; index += 1) view.setInt16(44 + index * 2, samples[index] ?? 0, true);
	return bytes;
}

describe("decodePcm16MonoWav", () => {
	test("decodes sample rate and normalized mono samples", () => {
		const sound = decodePcm16MonoWav("fixture.wav", wav([-32_768, 0, 16_384], 16_000));

		expect(sound.sampleRate).toBe(16_000);
		expect([...sound.pcm]).toEqual([-1, 0, 0.5]);
	});

	test("rejects non-WAV input", () => {
		expect(() => decodePcm16MonoWav("bad.wav", new ArrayBuffer(12))).toThrow("expected a RIFF/WAVE file");
	});
});
