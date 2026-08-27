"""Failures while building synchronized comparison videos."""

from __future__ import annotations


class VideoCompositeError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class VideoStateError(VideoCompositeError):
    """A function received a video in the wrong processing stage."""


class VideoInvariantError(VideoCompositeError):
    """An encoded clip failed duration/FPS/identity checks."""
