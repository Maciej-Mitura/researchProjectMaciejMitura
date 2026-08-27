from app.reference.slug import (
    InvalidTechniqueNameError,
    is_safe_slug,
    normalize_display_name,
    slugify_technique_name,
)
import pytest


def test_display_name_is_trimmed_but_not_rewritten() -> None:
    assert normalize_display_name("  Rear Roundhouse Kick  ") == "Rear Roundhouse Kick"


def test_slugify_lowercases_and_hyphenates() -> None:
    assert slugify_technique_name("Rear Roundhouse Kick") == "rear-roundhouse-kick"


def test_slugify_strips_accents() -> None:
    assert slugify_technique_name("Épée Jab") == "epee-jab"


def test_slugify_rejects_empty_and_symbols_only() -> None:
    with pytest.raises(InvalidTechniqueNameError):
        slugify_technique_name("   ")
    with pytest.raises(InvalidTechniqueNameError):
        slugify_technique_name("...")
    with pytest.raises(InvalidTechniqueNameError):
        slugify_technique_name("../")


def test_path_traversal_cannot_survive_slugify() -> None:
    slug = slugify_technique_name("../../../Etc/Passwd")
    assert slug == "etc-passwd"
    assert ".." not in slug
    assert "/" not in slug
    assert "\\" not in slug
    assert is_safe_slug(slug)


def test_unsafe_slugs_are_rejected() -> None:
    assert is_safe_slug("") is False
    assert is_safe_slug("..") is False
    assert is_safe_slug("../foo") is False
    assert is_safe_slug("foo/bar") is False
    assert is_safe_slug("foo\\bar") is False
    assert is_safe_slug(".hidden") is False
    assert is_safe_slug("con") is False
    assert is_safe_slug("rear-roundhouse-kick") is True


def test_slug_from_max_length_name_stays_safe() -> None:
    name = "A" * 80
    slug = slugify_technique_name(name)
    assert len(slug) <= 80
    assert is_safe_slug(slug)


def test_display_name_rejects_overlong() -> None:
    with pytest.raises(InvalidTechniqueNameError):
        normalize_display_name("A" * 81)
