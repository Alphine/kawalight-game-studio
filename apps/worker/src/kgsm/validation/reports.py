"""Structured validation reports (FR-016)."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Issue:
    level: str  # "error" | "warning"
    code: str
    message: str
    path: str = ""


@dataclass
class Report:
    issues: list[Issue] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not any(i.level == "error" for i in self.issues)

    def error(self, code: str, message: str, path: str = "") -> None:
        self.issues.append(Issue("error", code, message, path))

    def warning(self, code: str, message: str, path: str = "") -> None:
        self.issues.append(Issue("warning", code, message, path))

    def errors(self) -> list[Issue]:
        return [i for i in self.issues if i.level == "error"]

    def warnings(self) -> list[Issue]:
        return [i for i in self.issues if i.level == "warning"]

    def to_dict(self) -> dict:
        return {
            "ok": self.ok,
            "errors": [vars(i) for i in self.errors()],
            "warnings": [vars(i) for i in self.warnings()],
        }

    def summary(self) -> str:
        return f"{len(self.errors())} error(s), {len(self.warnings())} warning(s)"
