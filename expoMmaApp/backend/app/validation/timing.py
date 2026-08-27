"""Simple wall-clock stage timing for research documentation."""

from __future__ import annotations

import time
from collections.abc import Iterator
from contextlib import contextmanager


class StageTimer:
    def __init__(self) -> None:
        self._started = time.perf_counter()
        self.marks: dict[str, int] = {}

    @contextmanager
    def measure(self, name: str) -> Iterator[None]:
        started = time.perf_counter()
        try:
            yield
        finally:
            self.marks[name] = int(round((time.perf_counter() - started) * 1000))

    def elapsed_ms(self) -> int:
        return int(round((time.perf_counter() - self._started) * 1000))

    def get(self, name: str) -> int | None:
        return self.marks.get(name)
