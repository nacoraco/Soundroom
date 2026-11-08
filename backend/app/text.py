import re
import unicodedata


def normalize_text(value: str) -> str:
    """Normalize text for case- and diacritic-insensitive matching."""
    decomposed = unicodedata.normalize("NFKD", value)
    without_marks = "".join(
        character for character in decomposed if not unicodedata.combining(character)
    )
    cleaned = "".join(
        character if character.isalnum() else " "
        for character in without_marks.casefold()
    )
    return re.sub(r"\s+", " ", cleaned).strip()
