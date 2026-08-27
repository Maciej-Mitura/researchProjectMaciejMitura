"""Safe technique slugs for filesystem directories.

Display names stay as the user typed them (after trim). Slugs are derived,
never taken as a raw path from the client.
"""

from __future__ import annotations

import re
import unicodedata

MAX_DISPLAY_NAME_LENGTH = 80
MAX_DESCRIPTION_LENGTH = 280
MAX_SLUG_LENGTH = 80

_UNSAFE = re.compile(r"[^a-z0-9]+")
_SAFE_SLUG = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")

# Windows device names cannot be used as a path segment.
_WINDOWS_RESERVED = frozenset(
    {
        "con",
        "prn",
        "aux",
        "nul",
        *(f"com{i}" for i in range(1, 10)),
        *(f"lpt{i}" for i in range(1, 10)),
    }
)


class InvalidTechniqueNameError(ValueError):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


def normalize_display_name(name: str) -> str:
    """Trim surrounding whitespace. Preserve internal spacing exactly."""
    if not isinstance(name, str):
        raise InvalidTechniqueNameError("Technique name is required.")
    trimmed = name.strip()
    if not trimmed:
        raise InvalidTechniqueNameError("Technique name is required.")
    if len(trimmed) > MAX_DISPLAY_NAME_LENGTH:
        raise InvalidTechniqueNameError(
            f"Technique name must be at most {MAX_DISPLAY_NAME_LENGTH} characters."
        )
    if "\x00" in trimmed or "\n" in trimmed or "\r" in trimmed:
        raise InvalidTechniqueNameError("Technique name contains invalid characters.")
    return trimmed


def normalize_description(description: str | None) -> str | None:
    if description is None:
        return None
    if not isinstance(description, str):
        raise InvalidTechniqueNameError("Description must be text.")
    trimmed = description.strip()
    if not trimmed:
        return None
    if len(trimmed) > MAX_DESCRIPTION_LENGTH:
        raise InvalidTechniqueNameError(
            f"Description must be at most {MAX_DESCRIPTION_LENGTH} characters."
        )
    if "\x00" in trimmed:
        raise InvalidTechniqueNameError("Description contains invalid characters.")
    return trimmed


def slugify_technique_name(name: str) -> str:
    """Lowercase, hyphenated, path-safe slug from a display name.

    Accents are stripped (é → e). Spaces and other separators become hyphens.
    Path traversal characters cannot survive: they are not alphanumeric.
    """
    trimmed = normalize_display_name(name)
    decomposed = unicodedata.normalize("NFKD", trimmed)
    ascii_text = decomposed.encode("ascii", "ignore").decode("ascii")
    slug = _UNSAFE.sub("-", ascii_text.lower()).strip("-")
    if len(slug) > MAX_SLUG_LENGTH:
        slug = slug[:MAX_SLUG_LENGTH].rstrip("-")
    if not is_safe_slug(slug):
        raise InvalidTechniqueNameError(
            "This name could not be used. Choose a name with letters or numbers."
        )
    return slug


def is_safe_slug(slug: str) -> bool:
    if not slug or not isinstance(slug, str):
        return False
    if len(slug) > MAX_SLUG_LENGTH:
        return False
    if slug != slug.strip():
        return False
    if ".." in slug or "/" in slug or "\\" in slug or slug.startswith("."):
        return False
    if slug in _WINDOWS_RESERVED:
        return False
    return bool(_SAFE_SLUG.fullmatch(slug))
