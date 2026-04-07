"""End-to-end test for MCP auto-retry on connection failure.

Starts a real MCP server via stdio, holds a persistent connection,
kills the server mid-session, and verifies the retry logic in
MCPServerLocalSession reconnects and completes the tool call.
"""

from __future__ import annotations

import asyncio
import os
import signal
import sys
import tempfile
from pathlib import Path

import pytest

# Minimal MCP server script that exposes one tool: "echo"
_MCP_SERVER_SCRIPT = """\
import asyncio
import os
from mcp.server import Server
from mcp.server.stdio import stdio_server

app = Server("test-echo-server")

@app.list_tools()
async def list_tools():
    from mcp.types import Tool
    return [
        Tool(
            name="echo",
            description="Echo back the input",
            inputSchema={
                "type": "object",
                "properties": {
                    "message": {"type": "string"},
                },
                "required": ["message"],
            },
        ),
        Tool(
            name="get_pid",
            description="Return the server PID",
            inputSchema={
                "type": "object",
                "properties": {},
            },
        ),
    ]

@app.call_tool()
async def call_tool(name, arguments):
    from mcp.types import TextContent
    if name == "echo":
        return [TextContent(type="text", text=arguments.get("message", ""))]
    elif name == "get_pid":
        return [TextContent(type="text", text=str(os.getpid()))]
    raise ValueError(f"Unknown tool: {name}")

async def main():
    async with stdio_server() as (read, write):
        await app.run(read, write, app.create_initialization_options())

asyncio.run(main())
"""


@pytest.mark.asyncio
async def test_mcp_auto_retry_on_server_crash():
    """Kill the MCP server mid-session and verify the retry reconnects."""
    from inspect_ai.tool._mcp._local import MCPServerLocal, create_server_stdio
    from inspect_ai.tool._mcp.connection import mcp_connection

    # Write the server script to a temp file
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".py", delete=False, encoding="utf-8"
    ) as f:
        f.write(_MCP_SERVER_SCRIPT)
        server_script = f.name

    try:
        server: MCPServerLocal = create_server_stdio(
            name="test-reconnect",
            command=sys.executable,
            args=[server_script],
        )

        async with mcp_connection(server):
            # Get tools — this uses the persistent session
            tools = await server.tools()
            tool_names = {t.name for t in tools}
            assert "echo" in tool_names, f"Expected 'echo' tool, got {tool_names}"
            assert "get_pid" in tool_names

            # Find the echo and get_pid tool functions
            echo_tool = next(t for t in tools if t.name == "echo")
            pid_tool = next(t for t in tools if t.name == "get_pid")

            # Call 1: should succeed
            result1 = await echo_tool.tool(message="hello")
            assert "hello" in str(result1), f"Expected 'hello' in result, got {result1}"

            # Get the server PID so we can kill it
            pid_result = await pid_tool.tool()
            server_pid = int(str(pid_result).strip())
            assert server_pid > 0, f"Expected valid PID, got {server_pid}"

            # Kill the server process
            os.kill(server_pid, signal.SIGKILL)
            # Give the OS a moment to reap
            await asyncio.sleep(0.5)

            # Call 2: should fail on first attempt, reconnect, and succeed
            # The retry logic in _local.py should:
            # 1. Catch BrokenPipeError/BrokenResourceError
            # 2. Call _reset_session() to clear dead session
            # 3. Retry via _client_session() which creates a new connection
            result2 = await echo_tool.tool(message="after crash")
            assert "after crash" in str(result2), (
                f"Expected 'after crash' in result, got {result2}"
            )

            # Verify it's a NEW server (different PID)
            new_pid_result = await pid_tool.tool()
            new_pid = int(str(new_pid_result).strip())
            assert new_pid != server_pid, (
                f"Expected different PID after reconnect, got same PID {new_pid}"
            )

    finally:
        os.unlink(server_script)
