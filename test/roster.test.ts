import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { loadDirectorySounds } from "../src/roster";

function wav(samples: number[], sampleRate = 24_000): Uint8Array {
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
	return new Uint8Array(bytes);
}

describe("loadDirectorySounds", () => {
	test("loads supported files in filename order and ignores unrelated entries", async () => {
		const directory = await mkdtemp(join(tmpdir(), "cache-miss-oof-roster-"));
		try {
			await writeFile(join(directory, "z.WAV"), wav([1]));
			await writeFile(join(directory, "a.wav"), wav([2]));
			await writeFile(join(directory, "notes.txt"), "ignore");
			await mkdir(join(directory, "nested"));
			await writeFile(join(directory, "nested", "nested.wav"), wav([3]));

			const sounds = await loadDirectorySounds(directory);

			expect(sounds.map(sound => sound.name)).toEqual(["a.wav", "z.WAV"]);
			expect(sounds.map(sound => [...sound.pcm])).toEqual([[2 / 32_768], [1 / 32_768]]);
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test("rejects an empty directory", async () => {
		const directory = await mkdtemp(join(tmpdir(), "cache-miss-oof-roster-"));
		try {
			await expect(loadDirectorySounds(directory)).rejects.toThrow();
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});

	test("rejects a corrupt WAV file", async () => {
		const directory = await mkdtemp(join(tmpdir(), "cache-miss-oof-roster-"));
		try {
			await writeFile(join(directory, "corrupt.wav"), "not a WAV file");

			let error: unknown;
			try {
				await loadDirectorySounds(directory);
			} catch (caught) {
				error = caught;
			}
			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toContain("corrupt.wav");
		} finally {
			await rm(directory, { recursive: true, force: true });
		}
	});
});
