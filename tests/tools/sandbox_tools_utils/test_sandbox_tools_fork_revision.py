from contextlib import asynccontextmanager
from io import BytesIO
from typing import Literal, overload
from unittest.mock import AsyncMock, patch

import pytest

from inspect_ai.tool._sandbox_tools_utils.sandbox import (
    SandboxInjectionError,
    _inject_container_tools_code,
)
from inspect_ai.util._sandbox.environment import (
    SandboxEnvironment,
    SandboxEnvironmentConfigType,
)
from inspect_ai.util._subprocess import ExecResult


class _ForkRevisionSandbox(SandboxEnvironment):
    def __init__(self, exec_results: list[ExecResult[str]]) -> None:
        super().__init__()
        self._exec_results = exec_results

    async def exec(
        self,
        cmd: list[str],
        input: str | bytes | None = None,
        cwd: str | None = None,
        env: dict[str, str] | None = None,
        user: str | None = None,
        timeout: int | None = None,
        timeout_retry: bool = True,
        concurrency: bool = True,
    ) -> ExecResult[str]:
        del cmd, input, cwd, env, user, timeout, timeout_retry, concurrency
        return self._exec_results.pop(0)

    async def write_file(self, file: str, contents: str | bytes) -> None:
        del file, contents

    @overload
    async def read_file(self, file: str, text: Literal[True] = True) -> str: ...

    @overload
    async def read_file(self, file: str, text: Literal[False]) -> bytes: ...

    async def read_file(self, file: str, text: bool = True) -> str | bytes:
        del file
        return "" if text else b""

    @classmethod
    async def sample_cleanup(
        cls,
        task_name: str,
        config: SandboxEnvironmentConfigType | None,
        environments: dict[str, SandboxEnvironment],
        interrupted: bool,
    ) -> None:
        del cls, task_name, config, environments, interrupted


@pytest.mark.anyio
async def test_injection_rejects_binary_with_wrong_fork_revision() -> None:
    @asynccontextmanager
    async def opened_executable(*_: object):
        yield "inspect-sandbox-tools-amd64-v23-tl1", BytesIO(b"artifact")

    sandbox = _ForkRevisionSandbox(
        [
            ExecResult(success=True, returncode=0, stdout="", stderr=""),
            ExecResult(success=True, returncode=0, stdout="", stderr=""),
            ExecResult(success=True, returncode=0, stdout="", stderr=""),
            ExecResult(
                success=True,
                returncode=0,
                stdout='{"jsonrpc":"2.0","result":"1.2.1+tl.999","id":1}',
                stderr="",
            ),
        ]
    )

    with (
        patch(
            "inspect_ai.tool._sandbox_tools_utils.sandbox.detect_sandbox_os",
            AsyncMock(return_value={"architecture": "amd64", "libc": "glibc"}),
        ),
        patch(
            "inspect_ai.tool._sandbox_tools_utils.sandbox._open_executable_for_arch",
            opened_executable,
        ),
        patch(
            "inspect_ai.tool._sandbox_tools_utils.sandbox._extract_tools_tree",
            AsyncMock(),
        ),
        pytest.raises(SandboxInjectionError, match="fork revision"),
    ):
        await _inject_container_tools_code(sandbox)
