#!/usr/bin/env python3
"""Generate the extension's original, deterministic PCM16 sound effects."""

import math
import random
import struct
import wave
from pathlib import Path

SAMPLE_RATE = 24_000
OUTPUT_DIR = Path(__file__).resolve().parent.parent / "sounds"


def write_wav(name: str, samples: list[float]) -> None:
    peak = max(max(abs(sample) for sample in samples), 1e-9)
    gain = 0.86 / peak
    pcm = b"".join(
        struct.pack("<h", round(max(-1.0, min(1.0, sample * gain)) * 32_767))
        for sample in samples
    )
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with wave.open(str(OUTPUT_DIR / name), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        output.writeframes(pcm)


def envelope(t: float, duration: float, attack: float, decay_power: float) -> float:
    attack_gain = min(1.0, t / attack)
    return attack_gain * max(0.0, 1.0 - t / duration) ** decay_power


def block_hit(
    seed: int, duration: float, start_hz: float, end_hz: float
) -> list[float]:
    rng = random.Random(seed)
    count = round(duration * SAMPLE_RATE)
    phase = 0.0
    filtered_noise = 0.0
    samples: list[float] = []
    for index in range(count):
        t = index / SAMPLE_RATE
        progress = t / duration
        frequency = start_hz * (end_hz / start_hz) ** progress
        phase += frequency / SAMPLE_RATE
        square = 1.0 if phase % 1.0 < 0.47 else -1.0
        filtered_noise = filtered_noise * 0.55 + rng.uniform(-1.0, 1.0) * 0.45
        crunch = round((square * 0.58 + filtered_noise * 0.42) * 9.0) / 9.0
        samples.append(crunch * envelope(t, duration, 0.004, 2.1))
    return samples


def oof(seed: int, duration: float, fundamental: float, drop: float) -> list[float]:
    rng = random.Random(seed)
    count = round(duration * SAMPLE_RATE)
    phase = 0.0
    samples: list[float] = []
    for index in range(count):
        t = index / SAMPLE_RATE
        progress = t / duration
        frequency = fundamental * (1.0 - drop * progress)
        phase += frequency / SAMPLE_RATE
        voice = 0.0
        for harmonic in range(1, 13):
            harmonic_hz = frequency * harmonic
            resonance = (
                math.exp(-(((harmonic_hz - 430.0) / 180.0) ** 2))
                + 0.75 * math.exp(-(((harmonic_hz - 900.0) / 280.0) ** 2))
                + 0.22 * math.exp(-(((harmonic_hz - 2_300.0) / 500.0) ** 2))
            )
            voice += resonance * math.sin(2.0 * math.pi * phase * harmonic) / harmonic
        fricative_start = 0.72
        fricative = 0.0
        if progress > fricative_start:
            fricative = rng.uniform(-1.0, 1.0) * (
                (progress - fricative_start) / (1.0 - fricative_start)
            )
        body = (
            voice * (1.0 - 0.55 * max(0.0, progress - fricative_start))
            + fricative * 0.24
        )
        samples.append(body * envelope(t, duration, 0.018, 1.45))
    return samples


def main() -> None:
    write_wav("block-hit-1.wav", block_hit(1101, 0.24, 185.0, 82.0))
    write_wav("block-hit-2.wav", block_hit(1102, 0.29, 225.0, 96.0))
    write_wav("block-hit-3.wav", block_hit(1103, 0.21, 155.0, 68.0))
    write_wav("oof-1.wav", oof(2201, 0.38, 132.0, 0.24))
    write_wav("oof-2.wav", oof(2202, 0.46, 106.0, 0.18))
    write_wav("oof-3.wav", oof(2203, 0.33, 158.0, 0.31))


if __name__ == "__main__":
    main()
