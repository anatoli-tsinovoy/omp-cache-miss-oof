import { describe, expect, test } from "bun:test";
import { decodePcm16MonoWav, startTermuxSound, type Playback } from "../src/audio";

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

type FakeProcess = {
	exited: Promise<number>;
	stdout: ReadableStream<Uint8Array> | null;
	stderr: ReadableStream<Uint8Array> | null;
};
type FakeSpawnOptions = {
	stdout: "ignore" | "pipe";
	stderr: "ignore" | "pipe";
};

type FakeSpawn = (argv: string[], options: FakeSpawnOptions) => FakeProcess;
type Delay = (milliseconds: number) => Promise<void>;

function outputStream(text: string): ReadableStream<Uint8Array> | null {
	return text ? new Response(text).body : null;
}

function fakeProcess(exitCode: number, stdoutText = "", stderrText = ""): FakeProcess {
	return {
		exited: Promise.resolve(exitCode),
		stdout: outputStream(stdoutText),
		stderr: outputStream(stderrText),
	};
}

const noDelay: Delay = async (_milliseconds) => {};

describe("startTermuxSound", () => {
	test("stops prior playback before launching the exact play argv and resolves on success", async () => {
		const commandPath = "/data/data/com.termux/files/usr/bin/termux-media-player";
		const wavPath = "/tmp/cache-miss-oof.wav";
		const durationMs = 375;
		const events: string[] = [];
		const calls: string[][] = [];
		const options: FakeSpawnOptions[] = [];
		const delays: number[] = [];
		let delayStarted!: () => void;
		let releaseDelay!: () => void;
		const delayCalled = new Promise<void>(resolve => {
			delayStarted = resolve;
		});
		const delay: Delay = milliseconds => {
			delays.push(milliseconds);
			delayStarted();
			return new Promise<void>(resolve => {
				releaseDelay = resolve;
			});
		};
		const spawn: FakeSpawn = (argv, spawnOptions) => {
			events.push("spawn");
			calls.push([...argv]);
			options.push({ ...spawnOptions });
			return fakeProcess(0);
		};
		const previous: Playback = { stop: () => events.push("previous.stop") };

		const started = startTermuxSound(wavPath, commandPath, durationMs, previous, spawn, delay);

		expect(events).toEqual(["previous.stop", "spawn"]);
		expect(calls).toEqual([[commandPath, "play", wavPath]]);
		expect(options).toEqual([{ stdout: "pipe", stderr: "pipe" }]);
		await delayCalled;
		expect(delays).toEqual([durationMs]);
		let resolved = false;
		void started.done.then(() => {
			resolved = true;
		});
		await Promise.resolve();
		expect(resolved).toBe(false);
		releaseDelay();
		await expect(started.done).resolves.toBeUndefined();
	});

	test("rejects done with combined process output when playback exits nonzero", async () => {
		const stdout = "termux-media-player: service unavailable";
		const stderr = "permission denied";
		const process = fakeProcess(23, stdout, stderr);
		const spawn: FakeSpawn = (_argv, _options) => process;

		const started = startTermuxSound(
			"/tmp/cache-miss-oof.wav",
			"/data/data/com.termux/files/usr/bin/termux-media-player",
			1_250,
			undefined,
			spawn,
			noDelay,
		);

		await expect(started.done).rejects.toThrow(`${stdout}\n${stderr}`);
	});

	test("rejects a zero-exit service Error reported on stdout", async () => {
		const stdout = "Error: media service unavailable";
		const process = fakeProcess(0, stdout);
		const spawn: FakeSpawn = (_argv, _options) => process;

		const started = startTermuxSound(
			"/tmp/cache-miss-oof.wav",
			"/data/data/com.termux/files/usr/bin/termux-media-player",
			800,
			undefined,
			spawn,
			noDelay,
		);

		await expect(started.done).rejects.toThrow(stdout);
	});

	test("rejects a zero-exit service Failed diagnostic reported on stdout", async () => {
		const stdout = "Failed to start media service";
		const process = fakeProcess(0, stdout);
		const spawn: FakeSpawn = (_argv, _options) => process;

		const started = startTermuxSound(
			"/tmp/cache-miss-oof.wav",
			"/data/data/com.termux/files/usr/bin/termux-media-player",
			800,
			undefined,
			spawn,
			noDelay,
		);

		await expect(started.done).rejects.toThrow(stdout);
	});

	test("resolves for successful Now Playing output on stdout", async () => {
		const durationMs = 500;
		const delays: number[] = [];
		const process = fakeProcess(0, "Now Playing: /tmp/cache-miss-oof.wav");
		const spawn: FakeSpawn = (_argv, _options) => process;
		const delay: Delay = async milliseconds => {
			delays.push(milliseconds);
		};

		const started = startTermuxSound(
			"/tmp/cache-miss-oof.wav",
			"/data/data/com.termux/files/usr/bin/termux-media-player",
			durationMs,
			undefined,
			spawn,
			delay,
		);

		await expect(started.done).resolves.toBeUndefined();
		expect(delays).toEqual([durationMs]);
	});

	test("dispatches the termux-media-player stop argv", async () => {
		const commandPath = "/data/data/com.termux/files/usr/bin/termux-media-player";
		const calls: string[][] = [];
		const options: FakeSpawnOptions[] = [];
		const spawn: FakeSpawn = (argv, spawnOptions) => {
			calls.push([...argv]);
			options.push({ ...spawnOptions });
			return fakeProcess(0);
		};

		const started = startTermuxSound("/tmp/cache-miss-oof.wav", commandPath, 1, undefined, spawn, noDelay);
		await started.done;
		started.player.stop();

		expect(calls).toEqual([
			[commandPath, "play", "/tmp/cache-miss-oof.wav"],
			[commandPath, "stop"],
		]);
		expect(options).toEqual([
			{ stdout: "pipe", stderr: "pipe" },
			{ stdout: "ignore", stderr: "ignore" },
		]);
	});
});


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
