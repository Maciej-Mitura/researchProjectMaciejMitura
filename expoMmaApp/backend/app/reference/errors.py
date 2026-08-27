"""Typed failures for the reference-technique library."""

from __future__ import annotations


class ReferenceError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class DuplicateTechniqueError(ReferenceError):
    def __init__(self, slug: str, *, reserved: bool = False) -> None:
        super().__init__(
            "duplicate_technique",
            (
                "This name is reserved for a built-in catalog technique. Choose a different name."
                if reserved
                else "A technique with this name already exists. Choose a different name."
            ),
            status_code=409,
        )
        self.slug = slug


class DraftNotFoundError(ReferenceError):
    def __init__(self) -> None:
        super().__init__("draft_not_found", "Reference draft not found.", status_code=404)


class DraftNotConfirmableError(ReferenceError):
    def __init__(self, message: str) -> None:
        super().__init__("draft_not_confirmable", message, status_code=400)


class TechniqueNotFoundError(ReferenceError):
    def __init__(self) -> None:
        super().__init__(
            "technique_not_found",
            "Recorded reference technique not found.",
            status_code=404,
        )


class IncompleteReferenceError(ReferenceError):
    def __init__(self, message: str) -> None:
        super().__init__("incomplete_reference", message, status_code=422)


class BuiltinTechniqueProtectedError(ReferenceError):
    def __init__(self) -> None:
        super().__init__(
            "builtin_protected",
            "Built-in techniques cannot be deleted.",
            status_code=403,
        )


class TechniqueDeleteError(ReferenceError):
    def __init__(self, message: str | None = None) -> None:
        super().__init__(
            "delete_failed",
            message or "The technique could not be deleted. Please try again.",
            status_code=500,
        )
