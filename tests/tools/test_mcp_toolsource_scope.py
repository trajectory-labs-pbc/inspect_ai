"""A ToolSource must not hand one caller another caller's tools.

Each Tool returned by an MCP server closes over the MCPServerLocalSession that
produced it, and those sessions are scoped per async task. A ToolSource is
shared -- inspect eval builds one per Task and every sample uses it -- so
caching the resolved list on the instance handed later samples tools bound to
the FIRST sample's session, and their tool calls then executed in that sample's
sandbox while their own sandbox was never touched.
"""

from __future__ import annotations

from typing import Any

import anyio

from inspect_ai.tool._mcp.tools import MCPToolSourceLocal


class _FakeServer:
    """Returns a distinct tool object per call, standing in for a per-task session."""

    def __init__(self) -> None:
        self.calls = 0

    async def tools(self) -> list[Any]:
        self.calls += 1
        marker = self.calls

        async def tool_a() -> int:
            return marker

        return [tool_a]


def test_tools_are_reresolved_when_the_scope_changes() -> None:
    """Two async tasks must not share a resolved tool list."""
    server = _FakeServer()
    source = MCPToolSourceLocal(server, "all")  # type: ignore[arg-type]
    seen: list[int] = []

    async def caller() -> None:
        tools = await source.tools()
        seen.append(await tools[0]())  # type: ignore[operator]

    async def main() -> None:
        await caller()
        async with anyio.create_task_group() as tg:
            tg.start_soon(caller)

    anyio.run(main)

    assert server.calls == 2, (
        f"expected one resolution per scope, got {server.calls}; a shared cache "
        "hands the second caller tools bound to the first caller's session"
    )
    assert seen[0] != seen[1], "second caller received the first caller's tool object"


def test_tools_are_cached_within_one_scope() -> None:
    """The cache must still work inside a single scope -- that is its purpose."""
    server = _FakeServer()
    source = MCPToolSourceLocal(server, "all")  # type: ignore[arg-type]

    async def main() -> None:
        await source.tools()
        await source.tools()
        await source.tools()

    anyio.run(main)

    assert server.calls == 1, (
        f"expected a single resolution per scope, got {server.calls}"
    )
