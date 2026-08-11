"""Validated manifest passed from an eval-set parent to one worker."""

from typing import Any, Literal

from pydantic import BaseModel, field_validator


class WorkerLimitsManifest(BaseModel):
    """Explicit concurrency configuration for one worker interpreter."""

    max_connections: int
    adaptive_connections: bool
    max_samples: int
    max_sandboxes: int | None
    max_subprocesses: int
    max_dataset_memory: int | None
    max_tasks: int


class ShardManifest(BaseModel):
    """Versioned contract for a worker's exact selected sample shard."""

    version: int
    mode: Literal["run", "resolve"]
    eval_set_id: str
    task_id: str
    worker_index: int
    worker_count: int
    task_spec: str
    task_args: dict[str, Any]
    model: str
    model_base_url: str | None
    model_args: dict[str, Any]
    model_roles: dict[str, str]
    sample_ids: list[int | str]
    epochs: int
    epochs_reducer: Any
    log_dir: str
    worker_limits: WorkerLimitsManifest
    eval_kwargs: dict[str, Any]

    @field_validator("version")
    @classmethod
    def validate_version(cls, value: int) -> int:
        if value != 1:
            raise ValueError(f"Unsupported worker manifest version: {value}")
        return value
