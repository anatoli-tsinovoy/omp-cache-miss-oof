import type { AudioPlayback } from "@oh-my-pi/pi-natives";

export interface DecodedSound {
	name: string;
	pcm: Float32Array;
	sampleRate: number;
}

const RIFF_HEADER_BYTES = 12;
const CHUNK_HEADER_BYTES = 8;
const PCM_FORMAT = 1;
const MONO_CHANNELS = 1;
const PCM16_BITS = 16;
const INT16_SCALE = 32_768;

function ascii(view: DataView, offset: number, length: number): string {
	let value = "";
	for (let index = 0; index < length; index += 1) {
		value += String.fromCharCode(view.getUint8(offset + index));
	}
	return value;
}

/** Decode the canonical mono PCM16 WAV assets bundled with this extension. */
export function decodePcm16MonoWav(name: string, bytes: ArrayBuffer): DecodedSound {
	const view = new DataView(bytes);
	if (view.byteLength < RIFF_HEADER_BYTES || ascii(view, 0, 4) !== "RIFF" || ascii(view, 8, 4) !== "WAVE") {
		throw new Error(`${name}: expected a RIFF/WAVE file`);
	}

	let sampleRate: number | undefined;
	let dataOffset: number | undefined;
	let dataLength: number | undefined;
	let offset = RIFF_HEADER_BYTES;

	while (offset + CHUNK_HEADER_BYTES <= view.byteLength) {
		const chunkId = ascii(view, offset, 4);
		const chunkLength = view.getUint32(offset + 4, true);
		const bodyOffset = offset + CHUNK_HEADER_BYTES;
		if (bodyOffset + chunkLength > view.byteLength) throw new Error(`${name}: truncated ${chunkId} chunk`);

		if (chunkId === "fmt ") {
			if (chunkLength < 16) throw new Error(`${name}: invalid fmt chunk`);
			const format = view.getUint16(bodyOffset, true);
			const channels = view.getUint16(bodyOffset + 2, true);
			sampleRate = view.getUint32(bodyOffset + 4, true);
			const bitsPerSample = view.getUint16(bodyOffset + 14, true);
			if (format !== PCM_FORMAT || channels !== MONO_CHANNELS || bitsPerSample !== PCM16_BITS) {
				throw new Error(`${name}: expected mono PCM16 audio`);
			}
		} else if (chunkId === "data") {
			dataOffset = bodyOffset;
			dataLength = chunkLength;
		}

		offset = bodyOffset + chunkLength + (chunkLength & 1);
	}

	if (!sampleRate || dataOffset === undefined || dataLength === undefined) {
		throw new Error(`${name}: missing fmt or data chunk`);
	}
	if (dataLength % 2 !== 0) throw new Error(`${name}: odd PCM16 data length`);

	const pcm = new Float32Array(dataLength / 2);
	for (let index = 0; index < pcm.length; index += 1) {
		pcm[index] = view.getInt16(dataOffset + index * 2, true) / INT16_SCALE;
	}
	return { name, pcm, sampleRate };
}

export interface Playback {
	stop(): void;
}

interface StartedPlayback {
	player: Playback;
	done: Promise<void>;
}

interface TermuxProcess {
	exited: Promise<number>;
	stdout: ReadableStream<Uint8Array> | null | undefined;
	stderr: ReadableStream<Uint8Array> | null | undefined;
}

interface TermuxSpawnOptions {
	stdout: "ignore" | "pipe";
	stderr: "ignore" | "pipe";
}

type TermuxSpawn = (command: string[], options: TermuxSpawnOptions) => TermuxProcess;

const spawnTermuxProcess: TermuxSpawn = (command, options) => {
	const process = Bun.spawn(command, options);
	return {
		exited: process.exited,
		stdout: process.stdout as ReadableStream<Uint8Array> | null | undefined,
		stderr: process.stderr as ReadableStream<Uint8Array> | null | undefined,
	};
};

const readTermuxOutput = (stream: ReadableStream<Uint8Array> | null | undefined): Promise<string> =>
	stream ? new Response(stream).text() : Promise.resolve("");

const combinedTermuxOutput = (stdout: string, stderr: string): string => `${stdout}
${stderr}`.trim();

const isTermuxFailureDiagnostic = (output: string): boolean => /^(?:Error|Failed)\b/i.test(output);

/** Start playback through OMP's cross-platform native audio backend. */
export async function startSound(sound: DecodedSound, previous?: Playback): Promise<StartedPlayback> {
	previous?.stop();
	const { AudioPlayback: NativeAudioPlayback } = await import("@oh-my-pi/pi-natives");
	const player: AudioPlayback = new NativeAudioPlayback(sound.sampleRate);
	player.write(sound.pcm);
	return { player, done: player.end() };
}

/** Start playback through Termux's media-player command. */
export function startTermuxSound(
	wavPath: string,
	commandPath: string,
	durationMs: number,
	previous?: Playback,
	spawn: TermuxSpawn = spawnTermuxProcess,
	delay: (milliseconds: number) => Promise<void> = Bun.sleep,
): StartedPlayback {
	previous?.stop();
	const process = spawn([commandPath, "play", wavPath], { stdout: "pipe", stderr: "pipe" });
	// Drain both pipes before waiting for exit so a full service pipe cannot
	// deadlock completion.
	const stdout = readTermuxOutput(process.stdout);
	const stderr = readTermuxOutput(process.stderr);
	const done = Promise.all([process.exited, stdout, stderr]).then(async ([exitCode, stdoutText, stderrText]) => {
		const output = combinedTermuxOutput(stdoutText, stderrText);
		if (exitCode !== 0) {
			throw new Error(output || `${commandPath} play exited with code ${exitCode}`);
		}
		if (isTermuxFailureDiagnostic(output)) throw new Error(output);
		await delay(durationMs);
	});
	const player: Playback = {
		stop: () => {
			void spawn([commandPath, "stop"], { stdout: "ignore", stderr: "ignore" });
		},
	};
	return { player, done };
}
