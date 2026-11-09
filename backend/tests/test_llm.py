import json
from urllib.error import URLError

from app import llm_review
from app.config import get_settings
from app.importer import Candidate
from app.llm_review import check_llm_availability, review_candidates_with_llm


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def read(self):
        return json.dumps(self.payload).encode("utf-8")


def test_llm_uses_one_based_candidate_numbers(monkeypatch):
    candidates = [
        Candidate("https://example.com/a", "First", "Artist A", 120),
        Candidate("https://example.com/b", "Second", "Artist B", 130),
    ]
    monkeypatch.setattr(
        llm_review,
        "urlopen",
        lambda request, timeout: FakeResponse(
            {
                "answers": {
                    "best_candidate": {
                        "type": "choice",
                        "choice": "2",
                        "probabilities": {
                            "1": 0.05,
                            "2": 0.92,
                        },
                        "confidence": 0.92,
                    }
                }
            }
        ),
    )

    decision = review_candidates_with_llm(
        "Second",
        candidates,
        get_settings(),
    )

    assert decision is not None
    assert decision.candidate_index == 1
    assert decision.confidence == 0.92


def test_llm_rejects_out_of_range(monkeypatch):
    candidates = [
        Candidate("https://example.com/a", "First", "Artist A", 120),
    ]
    monkeypatch.setattr(
        llm_review,
        "urlopen",
        lambda request, timeout: FakeResponse(
            {
                "answers": {
                    "best_candidate": {
                        "type": "choice",
                        "choice": "3",
                        "probabilities": {
                            "3": 0.95,
                        },
                        "confidence": 0.95,
                    }
                }
            }
        ),
    )
    assert (
        review_candidates_with_llm("First", candidates, get_settings()) is None
    )


def test_llm_availability_reports_installed_model(monkeypatch):
    monkeypatch.setattr(
        llm_review,
        "urlopen",
        lambda request, timeout: FakeResponse(
            {"models": [{"name": "laya:latest"}]}
        ),
    )

    status = check_llm_availability(get_settings())

    assert status.available is True
    assert status.model == "laya"
    assert status.detail is None


def test_llm_availability_reports_missing_model(monkeypatch):
    monkeypatch.setattr(
        llm_review,
        "urlopen",
        lambda request, timeout: FakeResponse(
            {"models": [{"name": "llama3:latest"}]}
        ),
    )

    status = check_llm_availability(get_settings())

    assert status.available is False
    assert "not installed" in (status.detail or "")
    assert "llama3:latest" in (status.detail or "")


def test_llm_availability_handles_unreachable_ollama(monkeypatch):
    def fail(request, timeout):
        raise URLError("connection refused")

    monkeypatch.setattr(llm_review, "urlopen", fail)

    status = check_llm_availability(get_settings())

    assert status.available is False
    assert "not reachable" in (status.detail or "")


def test_llm_takes_highest_probability_even_when_low(monkeypatch):
    candidates = [
        Candidate("https://example.com/a", "First", "Artist A", 120),
        Candidate("https://example.com/b", "Second", "Artist B", 130),
    ]
    monkeypatch.setattr(
        llm_review,
        "urlopen",
        lambda request, timeout: FakeResponse(
            {
                "answers": {
                    "best_candidate": {
                        "type": "choice",
                        "choice": "1",
                        "probabilities": {
                            "1": 0.3,
                            "2": 0.6,
                        },
                        "confidence": 0.4,
                    }
                }
            }
        ),
    )

    decision = review_candidates_with_llm(
        "First",
        candidates,
        get_settings(),
    )

    assert decision is not None
    assert decision.candidate_index == 1
    assert decision.confidence == 0.6
