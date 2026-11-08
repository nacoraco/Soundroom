from __future__ import annotations

from dataclasses import dataclass


class InvalidRange(ValueError):
    pass


@dataclass(frozen=True)
class ByteRange:
    start: int
    end: int

    @property
    def length(self) -> int:
        return self.end - self.start + 1


def parse_range_header(header: str, file_size: int) -> ByteRange | None:
    if file_size <= 0:
        raise InvalidRange("File is empty")

    unit, separator, spec = header.partition("=")
    if not separator or unit.strip().lower() != "bytes":
        raise InvalidRange("Unsupported range unit")
    if "," in spec:
        raise InvalidRange("Multiple ranges are not supported")

    spec = spec.strip()
    start_text, dash, end_text = spec.partition("-")
    if not dash or not spec:
        raise InvalidRange("Malformed range")

    if not start_text:
        try:
            suffix_length = int(end_text)
        except ValueError as exc:
            raise InvalidRange("Malformed suffix range") from exc
        if suffix_length <= 0:
            raise InvalidRange("Invalid suffix range")
        start = max(file_size - suffix_length, 0)
        return ByteRange(start=start, end=file_size - 1)

    try:
        start = int(start_text)
    except ValueError as exc:
        raise InvalidRange("Malformed range start") from exc
    if start < 0 or start >= file_size:
        raise InvalidRange("Range start is outside the file")

    if not end_text:
        end = file_size - 1
    else:
        try:
            end = int(end_text)
        except ValueError as exc:
            raise InvalidRange("Malformed range end") from exc
        if end < start:
            raise InvalidRange("Range end precedes start")
        end = min(end, file_size - 1)

    return ByteRange(start=start, end=end)
