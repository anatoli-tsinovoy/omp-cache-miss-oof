# omp-cache-miss-oof

An [Oh My Pi](https://github.com/can1357/oh-my-pi) extension that plays a short sound whenever a live assistant request loses a previously warm explicit prompt cache.

Two OOF effects rotate in a fixed closed cycle:

1. the selected original OOF
2. a brighter, pitch-shifted, lightly crushed variation

Both are based on [“Oof” by unfa](https://freesound.org/people/unfa/sounds/719053/), released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

## Install

```sh
omp install github:anatoli-tsinovoy/omp-cache-miss-oof
```

Restart OMP after installation.
On Android/Termux, install and configure the Termux:API package so `termux-media-player` is installed and on `PATH`. The extension uses that player only on Android when available; all other platforms retain OMP's native audio backend.

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

Each invocation plays the next effect and wraps after both sounds.

## Detection behavior

The extension subscribes to `message_end` and calls OMP's own `detectCacheInvalidation` implementation from `modes/components/cache-invalidation-marker`.

A sound plays when:

- the previous request read at least 2,048 prompt tokens from an explicit cache;
- the current request reads zero cached tokens;
- the current request writes a replacement cache; and
- the rewritten plus uncached input contains at least 2,048 tokens.

Like OMP's marker, this intentionally excludes normal fluctuations from implicit best-effort caches. On startup and session navigation, the extension restores its baseline from the active branch so the first live miss matches OMP's marker. Rebuilding historical transcript markers does not replay sounds.

Sound playback uses OMP's `AudioPlayback` native backend on supported non-Android platforms: CoreAudio on macOS, WASAPI on Windows, and PulseAudio with ALSA fallback on Linux. On Android, the extension uses `termux-media-player` when it is available on `PATH`.

## Sound assets

`sounds/unfa-oof.wav` is a mono 24 kHz PCM16 conversion of the public preview for [“Oof” by unfa](https://freesound.org/people/unfa/sounds/719053/), licensed CC0 1.0.

`sounds/unfa-oof-filtered.wav` is a derivative produced by `scripts/generate-filtered-oof.py`: 12% pitch increase, high-frequency emphasis, soft saturation, 8-bit-style amplitude quantization, and an 18 ms echo. Regenerate it with:

```sh
bun run generate:sounds
```

The sound assets retain the source sound's CC0 1.0 dedication. Extension code is released under the MIT license.

## Development

```sh
bun install
bun run check
bun test
```
