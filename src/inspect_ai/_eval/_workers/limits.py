"""Effective concurrency limits for eval-set worker processes."""

from collections.abc import Mapping
from dataclasses import dataclass
from math import ceil

from inspect_ai.util._concurrency import (
    AdaptiveConcurrency,
    adaptive_active,
    resolve_adaptive,
)


@dataclass(frozen=True)
class WorkerLimits:
    """Explicit limits supplied to one worker process."""

    max_connections: int
    adaptive_connections: bool
    max_samples: int
    max_sandboxes: int | None
    max_subprocesses: int
    max_dataset_memory: int | None
    max_tasks: int = 1


def resolve_worker_limits(
    *,
    workers: int,
    max_connections: int | None,
    adaptive_connections: bool | int | AdaptiveConcurrency | None,
    batch: bool,
    model_max_connections: int,
    max_samples: int | None,
    max_sandboxes: int | None,
    sandbox_default_concurrency: int | None,
    max_subprocesses: int | None,
    default_max_subprocesses: int,
    max_dataset_memory: int | None,
) -> WorkerLimits:
    """Resolve the parent's effective caps and divide them across workers."""
    if workers < 1:
        raise ValueError(f"workers must be positive (got {workers})")

    adaptive = adaptive_active(adaptive_connections, max_connections, batch)
    effective_connections = (
        resolve_adaptive(adaptive_connections).max
        if adaptive
        else max_connections
        if max_connections is not None
        else model_max_connections
    )
    effective_samples = (
        max_samples if max_samples is not None else effective_connections
    )
    effective_sandboxes = (
        max_sandboxes if max_sandboxes is not None else sandbox_default_concurrency
    )
    effective_subprocesses = (
        max_subprocesses if max_subprocesses is not None else default_max_subprocesses
    )
    return WorkerLimits(
        max_connections=_divide_limit(effective_connections, workers),
        adaptive_connections=False,
        max_samples=_divide_limit(effective_samples, workers),
        max_sandboxes=(
            _divide_limit(effective_sandboxes, workers)
            if effective_sandboxes is not None
            else None
        ),
        max_subprocesses=_divide_limit(effective_subprocesses, workers),
        max_dataset_memory=(
            _divide_limit(max_dataset_memory, workers)
            if max_dataset_memory is not None
            else None
        ),
    )


def _divide_limit(limit: int, workers: int) -> int:
    return max(1, ceil(limit / workers))


def resolve_worker_environment_limits(
    environment: Mapping[str, str], *, workers: int, cpu_count: int | None
) -> dict[str, str]:
    """Return explicit divided values for known per-process deployment pools."""
    defaults = {
        "INSPECT_MAX_POD_OPS": (cpu_count or 1) * 4,
        "INSPECT_MAX_HELM_INSTALL": 8,
        "INSPECT_MAX_HELM_UNINSTALL": 8,
    }
    return {
        name: str(_divide_limit(int(environment.get(name, default)), workers))
        for name, default in defaults.items()
    }
