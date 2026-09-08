import { readdir } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { extname, isAbsolute, join } from "node:path";
import { decodePcm16MonoWav, type DecodedSound } from "./audio";

const SUPPORTED_EXTENSIONS: Record<string, true> = {
	".wav": true,
	".mp3": true,
	".ogg": true,
	".flac": true,
	".m4a": true,
	".aac": true,
	".opus": true,
	".aiff": true,
	".aif": true,
	".webm": true,
};
const FFMPEG_DIAGNOSTIC_LIMIT = 4096;
const FFMPEG_SAMPLE_RATE = 24_000;
const INT16_SCALE = 32_768;

interface SoundFile {
	name: string;
	path: string;
	extension: string;
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function readBoundedDiagnostics(stream: ReadableStream<Uint8Array>): Promise<string> {
	const bytes = new Uint8Array(FFMPEG_DIAGNOSTIC_LIMIT);
	let length = 0;
	let truncated = false;
	const reader = stream.getReader();
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (length >= bytes.length) {
				truncated = true;
				continue;
			}
			const remaining = bytes.length - length;
			const chunk = value.subarray(0, remaining);
			bytes.set(chunk, length);
			length += chunk.byteLength;
			if (value.byteLength > remaining) truncated = true;
		}
	} finally {
		reader.releaseLock();
	}
	const text = new TextDecoder().decode(bytes.subarray(0, length)).trim();
	return truncated ? `${text}${text ? " " : ""}(diagnostics truncated)` : text;
}

function decodeRawPcm16Mono(name: string, bytes: ArrayBuffer): DecodedSound {
	if (bytes.byteLength === 0) throw new Error(`${name}: FFmpeg produced empty audio`);
	if (bytes.byteLength % 2 !== 0) throw new Error(`${name}: FFmpeg produced invalid PCM16 data`);

	const view = new DataView(bytes);
	const pcm = new Float32Array(bytes.byteLength / 2);
	for (let index = 0; index < pcm.length; index += 1) {
		pcm[index] = view.getInt16(index * 2, true) / INT16_SCALE;
	}
	return { name, pcm, sampleRate: FFMPEG_SAMPLE_RATE };
}

async function decodeWithFfmpeg(file: SoundFile): Promise<DecodedSound> {
	let process: Bun.Subprocess<"ignore", "pipe", "pipe">;
	try {
		process = Bun.spawn<"ignore", "pipe", "pipe">(
			[
				"ffmpeg",
				"-nostdin",
				"-hide_banner",
				"-loglevel",
				"error",
				"-i",
				file.path,
				"-f",
				"s16le",
				"-acodec",
				"pcm_s16le",
				"-ac",
				"1",
				"-ar",
				String(FFMPEG_SAMPLE_RATE),
				"pipe:1",
			],
			{ stdin: "ignore", stdout: "pipe", stderr: "pipe" },
		);
	} catch (error) {
		throw new Error(`${file.name}: FFmpeg is unavailable; install FFmpeg to decode this file (${errorMessage(error)})`);
	}

	try {
		const [output, diagnostics, exitCode] = await Promise.all([
			new Response(process.stdout).arrayBuffer(),
			readBoundedDiagnostics(process.stderr),
			process.exited,
		]);
		if (exitCode !== 0) {
			const detail = diagnostics ? `: ${diagnostics}` : "";
			throw new Error(`${file.name}: FFmpeg could not decode the file${detail}`);
		}
		return decodeRawPcm16Mono(file.name, output);
	} catch (error) {
		if (error instanceof Error && error.message.startsWith(`${file.name}:`)) throw error;
		throw new Error(`${file.name}: FFmpeg failed while decoding the file (${errorMessage(error)})`);
	}
}

async function decodeFile(file: SoundFile): Promise<DecodedSound> {
	if (file.extension === ".wav") {
		const bytes = await Bun.file(file.path).arrayBuffer();
		let sound: DecodedSound;
		try {
			sound = decodePcm16MonoWav(file.name, bytes);
		} catch {
			return await decodeWithFfmpeg(file);
		}
		if (sound.pcm.length === 0) throw new Error(`${file.name}: decoded audio is empty`);
		return sound;
	}
	return await decodeWithFfmpeg(file);
}


/** Load and validate all supported audio files directly inside an absolute directory. */
export async function loadDirectorySounds(directory: string): Promise<DecodedSound[]> {
	if (!isAbsolute(directory)) throw new Error(`Sound directory must be an absolute path: ${directory}`);

	let entries: Dirent<string>[];
	try {
		entries = await readdir(directory, { withFileTypes: true });
	} catch (error) {
		throw new Error(`Unable to read sound directory ${directory}: ${errorMessage(error)}`);
	}

	const files: SoundFile[] = [];
	for (const entry of entries) {
		if (!entry.isFile()) continue;
		const extension = extname(entry.name).toLowerCase();
		if (!SUPPORTED_EXTENSIONS[extension]) continue;
		files.push({ name: entry.name, path: join(directory, entry.name), extension });
	}
	files.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
	if (files.length === 0) throw new Error(`No supported audio files found in sound directory: ${directory}`);

	const sounds: DecodedSound[] = [];
	for (const file of files) sounds.push(await decodeFile(file));
	return sounds;
}

