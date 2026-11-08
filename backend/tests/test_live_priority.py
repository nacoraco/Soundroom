from app.importer import (
    Candidate,
    choose_candidate,
    is_live_performance,
    rank_candidates,
)


def candidate(
    url: str,
    title: str,
    artist: str = "Test Artist",
    *,
    uploader: str = "Test Artist - Topic",
    views: int = 100_000,
) -> Candidate:
    return Candidate(
        url=url,
        title=title,
        artist=artist,
        duration_seconds=120,
        uploader=uploader,
        view_count=views,
    )


def test_live_performances_rank_last_globally():
    query = "Test Artist - Test Song"
    studio = candidate(
        "https://example.com/studio",
        "Test Artist - Test Song",
        views=1_000,
    )
    live = candidate(
        "https://example.com/live",
        "Other Artist - Another Song (Live at Wembley)",
        artist="Other Artist",
        uploader="Other Artist",
        views=50_000_000,
    )

    ranked = rank_candidates(query, [live, studio], None)

    assert [item[1] for item in ranked] == [studio, live]
    assert choose_candidate(query, [live, studio], 300)[0] is studio


def test_live_performance_detection():
    assert is_live_performance(
        candidate("https://example.com/a", "Test Song (Live)")
    )
    assert is_live_performance(
        candidate("https://example.com/b", "Test Song - Live at Wembley")
    )
    assert is_live_performance(
        candidate("https://example.com/c", "Test Song (Official Live Video)")
    )
    assert is_live_performance(
        candidate("https://example.com/d", "MTV Unplugged")
    )
    assert not is_live_performance(
        candidate("https://example.com/e", "Live Forever")
    )
    assert not is_live_performance(
        candidate("https://example.com/f", "Test Song (Official Video)")
    )


def test_only_live_candidates_remain_eligible():
    query = "Test Artist - Test Song"
    live = candidate(
        "https://example.com/live",
        "Test Artist - Test Song (Live)",
    )

    chosen, ambiguous = choose_candidate(query, [live], 300)

    assert chosen is live
    assert ambiguous is False
