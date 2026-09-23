# omp-cache-miss-oof

An [Oh My Pi](https://github.com/can1357/oh-my-pi) extension that plays a short sound whenever a live assistant request loses a previously warm explicit prompt cache.

By default, two OOF effects rotate in a fixed closed cycle:

1. the selected original OOF
2. a brighter, pitch-shifted, lightly crushed variation

Both are based on [“Oof” by unfa](https://freesound.org/people/unfa/sounds/719053/), released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

## Install

```sh
omp install github:anatoli-tsinovoy/omp-cache-miss-oof
```

Restart OMP after installation. This extension requires OMP 18.2.11 or newer.

On Android/Termux, use an OMP build that includes the shared PulseAudio backend. Install the Termux `pulseaudio` package and start its server before launching OMP (for example, `pkg install pulseaudio` followed by `pulseaudio --start --exit-idle-time=-1`). Set `PULSE_SERVER` only when the server is remote or uses a non-default address. This extension has no `termux-media-player` or Termux:API dependency. Android OMP builds that still use the earlier OpenSL backend must be updated; arbitrary older Android OMP builds are not guaranteed to work.

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

Each invocation plays the next effect and wraps through the current roster.

## Configure the audio roster

Point the extension at a directory inside OMP:

```text
/cache-miss-oof directory ~/Music/cache-miss-sounds
/cache-miss-oof status
/cache-miss-oof reset
```

`directory <path>` validates and loads the directory, then starts a new cycle at the first filename. Relative paths resolve against OMP's current working directory; `~` and paths with spaces (optionally quoted) are supported. Run `/cache-miss-oof` without arguments to play the next sound.

The roster includes regular files directly inside the directory, sorted by filename. Subdirectories, symlinks, and unrelated files are ignored. Supported extensions are `.wav`, `.mp3`, `.ogg`, `.flac`, `.m4a`, `.aac`, `.opus`, `.aiff`, `.aif`, and `.webm`, case-insensitively.

Mono PCM16 WAV files need no additional software. Other formats, including stereo or non-PCM16 WAV, require `ffmpeg` on `PATH` (for example, `brew install ffmpeg` on macOS or `pkg install ffmpeg` on Termux). Audio is decoded into memory, so use short sound effects rather than large music libraries.

An empty directory, unreadable directory, or undecodable supported file leaves the previous roster unchanged. Re-run the directory command to reload files after changing them.

The directory selection is saved with the current OMP session and follows its branch history; it is not a global preference. Resuming a session reloads its audio files from the saved path. `status` shows that path, and `reset` restores the bundled OOF sounds.

## Detection behavior

The extension subscribes to `message_end` and calls OMP's own `detectCacheInvalidation` implementation from `@oh-my-pi/pi-tui/chat/cache-invalidation-marker`.

A sound plays when:

- the previous request read at least 2,048 prompt tokens from an explicit cache;
- the current request reads zero cached tokens;
- the current request writes a replacement cache; and
- the rewritten plus uncached input contains at least 2,048 tokens.

Like OMP's marker, this intentionally excludes normal fluctuations from implicit best-effort caches. On startup and session navigation, the extension restores its baseline from the active branch so the first live miss matches OMP's marker. Rebuilding historical transcript markers does not replay sounds.
Sound playback uses OMP's `AudioPlayback` native backend on supported platforms: CoreAudio on macOS, shared-mode WASAPI on Windows, and PulseAudio on Linux and Android (with ALSA fallback on Linux). Android intentionally has no media-player fallback.

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
