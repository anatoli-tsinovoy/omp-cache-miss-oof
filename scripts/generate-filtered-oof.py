#!/usr/bin/env python3
"""Regenerate the filtered OOF variation from the vendored CC0 source."""

import math
import struct
import wave
from pathlib import Path

SAMPLE_RATE = 24_000
PITCH_RATIO = 1.12
ECHO_SECONDS = 0.018
SOURCE = Path(__file__).resolve().parent.parent / "sounds" / "unfa-oof.wav"
OUTPUT = SOURCE.with_name("unfa-oof-filtered.wav")


def read_wav() -> list[float]:
    with wave.open(str(SOURCE), "rb") as source:
        if (
            source.getnchannels() != 1
            or source.getsampwidth() != 2
            or source.getframerate() != SAMPLE_RATE
        ):
            raise ValueError("unfa-oof.wav must be mono 24 kHz PCM16")
        frames = source.readframes(source.getnframes())
    return [sample[0] / 32_768 for sample in struct.iter_unpack("<h", frames)]


def normalize(samples: list[float], target_peak: float = 0.86) -> list[float]:
    peak = max(max(abs(sample) for sample in samples), 1e-9)
    gain = target_peak / peak
    return [sample * gain for sample in samples]


def filter_oof(source: list[float]) -> list[float]:
    pitched_length = round(len(source) / PITCH_RATIO)
    echo_samples = round(ECHO_SECONDS * SAMPLE_RATE)
    output = [0.0] * (pitched_length + echo_samples)
    previous = 0.0

    for index in range(pitched_length):
        position = index * PITCH_RATIO
        left = min(math.floor(position), len(source) - 1)
        right = min(left + 1, len(source) - 1)
        fraction = position - left
        sample = source[left] * (1.0 - fraction) + source[right] * fraction
        bright = sample - previous * 0.48
        previous = sample
        saturated = math.tanh((sample * 0.86 + bright * 0.34) * 1.45) / math.tanh(1.45)
        crushed = round(saturated * 256) / 256
        output[index] += crushed
        output[index + echo_samples] += crushed * 0.2

    return normalize(output)


def write_wav(samples: list[float]) -> None:
    frames = b"".join(
        struct.pack("<h", round(max(-1.0, min(1.0, sample)) * 32_767))
        for sample in samples
    )
    with wave.open(str(OUTPUT), "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(SAMPLE_RATE)
        output.writeframes(frames)


if __name__ == "__main__":
    write_wav(filter_oof(read_wav()))
