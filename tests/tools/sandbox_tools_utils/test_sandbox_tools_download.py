"""Resolution must fall through to the local build when the bucket is unusable.

A DNS failure on the (placeholder) distribution bucket used to escape
`_download_from_s3` as `httpx.ConnectError`, killing injection with
`SandboxInjectionError` before the local-build fallback could run.
"""

import httpx
import pytest

from inspect_ai.tool._sandbox_tools_utils import sandbox as sandbox_mod


async def test_placeholder_bucket_skips_download_without_network() -> None:
    """The unset-placeholder URL short-circuits to False (no network attempt)."""

    def _no_network(*args: object, **kwargs: object) -> None:
        raise AssertionError("network must not be touched for the placeholder URL")

    original_client = httpx.AsyncClient
    httpx.AsyncClient = _no_network  # type: ignore[assignment,misc]
    try:
        assert (
            await sandbox_mod._download_from_s3("inspect-sandbox-tools-amd64-v26-tl1")
            is False
        )
    finally:
        httpx.AsyncClient = original_client  # type: ignore[misc]


async def test_unreachable_bucket_returns_false(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Transport errors (DNS, refused, timeout) mean 'not available', not fatal."""
    monkeypatch.setattr(
        sandbox_mod,
        "_BUCKET_BASE_URL",
        "https://definitely-not-resolvable.invalid",
    )
    assert (
        await sandbox_mod._download_from_s3("inspect-sandbox-tools-amd64-v26-tl1")
        is False
    )


async def test_http_500_still_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    """Non-404/403 HTTP errors keep raising: the bucket exists but is broken."""

    class _FakeResponse:
        status_code = 500
        content = b""

        def raise_for_status(self) -> None:
            raise httpx.HTTPStatusError(
                "boom",
                request=httpx.Request("GET", "https://x"),
                response=httpx.Response(500),
            )

    class _FakeClient:
        def __init__(self, *args: object, **kwargs: object) -> None: ...
        async def __aenter__(self) -> "_FakeClient":
            return self

        async def __aexit__(self, *args: object) -> None: ...
        async def get(self, url: str) -> _FakeResponse:
            return _FakeResponse()

    monkeypatch.setattr(sandbox_mod, "_BUCKET_BASE_URL", "https://bucket.example")
    monkeypatch.setattr(sandbox_mod.httpx, "AsyncClient", _FakeClient)
    with pytest.raises(httpx.HTTPStatusError):
        await sandbox_mod._download_from_s3("inspect-sandbox-tools-amd64-v26-tl1")
