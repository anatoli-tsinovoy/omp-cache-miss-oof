# omp-cache-miss-oof

An [Oh My Pi](https://github.com/can1357/oh-my-pi) extension that plays a short sound whenever a live assistant request loses a previously warm explicit prompt cache.

Six bundled effects rotate in a fixed closed cycle:

1. blocky hit 1
2. oof 1
3. blocky hit 2
4. oof 2
5. blocky hit 3
6. oof 3

The sounds are original, procedurally synthesized effects. They do not contain audio copied from Minecraft, Roblox, or any other game.

## Install

```sh
omp install github:anatoli-tsinovoy/omp-cache-miss-oof
```

Restart OMP after installation.

For local development:

```sh
git clone https://github.com/anatoli-tsinovoy/omp-cache-miss-oof.git
omp plugin link ./omp-cache-miss-oof
```

## Test the speaker

Run this slash command inside OMP:

```text
/cache-miss-oof
```

Each invocation plays the next effect and wraps after all six sounds.

## Detection behavior

The extension subscribes to `message_end` and calls OMP's own `detectCacheInvalidation` implementation from `modes/components/cache-invalidation-marker`.

A sound plays when:

- the previous request read at least 2,048 prompt tokens from an explicit cache;
- the current request reads zero cached tokens;
- the current request writes a replacement cache; and
- the rewritten plus uncached input contains at least 2,048 tokens.

Like OMP's marker, this intentionally excludes normal fluctuations from implicit best-effort caches. The extension resets its baseline on session navigation, compaction, and model changes. It reacts to live assistant responses; rebuilding historical transcript markers does not replay sounds.

Sound playback uses OMP's `StreamingAudioPlayer`, the same gapless native speaker path used by `omp say`: CoreAudio on macOS, WASAPI on Windows, and PulseAudio with ALSA fallback on Linux.

## Sound assets

The checked-in WAV files are deterministic output from `scripts/generate-sounds.py`. Regenerate them with:

```sh
bun run generate:sounds
```

All sounds are mono 24 kHz PCM16 WAV files. Code and generated sound assets are released under the MIT license.

## Development

```sh
bun install
bun run check
bun test
```
